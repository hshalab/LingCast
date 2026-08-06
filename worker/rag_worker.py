"""RAG ingestion worker: per-avatar private knowledge base.

Listens to `talking_avatar:knowledge_ingest` (BLPOP) for
`{"type":"ingest_knowledge","avatarId":N,"knowledgeId":K,"s3Key":"knowledge/...","filename":...}`
tasks pushed by the Go API, then:

  1. Downloads the source file (.txt/.pdf) from S3.
  2. Extracts plain text (PDF via PyMuPDF / fitz, TXT via utf-8).
  3. Chunks the text by sentence boundaries (。！？!?；;\\n) into ~300-char
     chunks with a ~50-char overlap.
  4. Embeds each chunk with the LOCAL `sentence-transformers` model
     `BAAI/bge-small-zh-v1.5` (512-dim, no paid embedding APIs).
  5. Stores vectors in Redis via RediSearch (FT.CREATE idx:knowledge) with
     keys strictly isolated per avatar: `knowledge:{avatar_id}:{chunk_id}`.
  6. Reports back to the API webhook (`status: indexed|failed`).

The worker also serves a tiny FastAPI endpoint used by the Go chat API
(Sub-Task 3) for query embedding + per-avatar KNN retrieval:

    POST /embed   {"text": "..."}                         -> {"vector": [...]}
    POST /search  {"avatarId": N, "text": "..."}          -> {"chunks": [...]}

Run from the worker directory:
    uv run python -u rag_worker.py

Requires RediSearch (RedisStack): plain redis:8.2.2-alpine does NOT include
the FT.* module. Use `redis/redis-stack-server` for the redis service.
"""

import logging
import json
import os
import queue
import re
import threading
import time
from pathlib import Path

import redis
import requests
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from storage import S3Storage
from worker import _load_local_env, load_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("rag_worker")

EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-small-zh-v1.5")
EMBED_DIM = 512  # bge-small-zh-v1.5
INDEX_NAME = "idx:knowledge"
CHUNK_SIZE = int(os.environ.get("KNOWLEDGE_CHUNK_SIZE", "300"))
CHUNK_OVERLAP = int(os.environ.get("KNOWLEDGE_CHUNK_OVERLAP", "50"))
INGEST_QUEUE_KEY = os.environ.get(
    "KNOWLEDGE_INGEST_QUEUE_KEY", "talking_avatar:knowledge_ingest"
)
EMBED_SERVER_PORT = int(os.environ.get("EMBED_SERVER_PORT", "8090"))
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8080")

_SENT_RE = re.compile(r"([。！？!?；;\n]+)")
cfg = None
_redis_client: redis.Redis | None = None


# ------------------------------------------------------------------ #
# Text extraction & chunking
# ------------------------------------------------------------------ #
def extract_text(path: Path) -> str:
    """Extract plain text from a .pdf (PyMuPDF) or .txt file."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        import fitz  # PyMuPDF

        text = []
        with fitz.open(str(path)) as doc:
            for page in doc:
                text.append(page.get_text())
        return "\n".join(text)
    if ext == ".txt":
        return path.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"unsupported knowledge file type: {ext}")


def split_sentences(text: str) -> list[str]:
    """Split on Chinese/English sentence punctuation, keeping the delimiters."""
    parts = _SENT_RE.split(text)
    sents: list[str] = []
    for i in range(0, len(parts), 2):
        seg = parts[i].strip()
        delim = parts[i + 1].strip() if i + 1 < len(parts) else ""
        if seg:
            sents.append(seg + delim)
    return [s for s in sents if s.strip()]


def chunk_text(text: str, target: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Chunk text into ~target-char chunks with ~overlap-char overlap.

    Chunks are assembled from whole sentences (so they never cut mid-sentence);
    the next chunk starts at a sentence boundary inside the previous chunk's
    trailing `overlap` characters, so context carries across chunk boundaries.
    """
    sents = split_sentences(text)
    if not sents:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(sents):
        cur = ""
        i = start
        while i < len(sents) and len(cur) < target:
            cur += sents[i]
            i += 1
        chunks.append(cur.strip())
        if i >= len(sents):
            break
        # Find the sentence boundary whose end falls inside the overlap window.
        off = max(0, len(cur) - overlap)
        acc = 0
        new_start = i  # default: no overlap
        for j in range(start, i):
            acc += len(sents[j])
            if acc >= off:
                new_start = j + 1
                break
        start = new_start
    return [c for c in chunks if c]


# ------------------------------------------------------------------ #
# Embedding (local sentence-transformers)
# ------------------------------------------------------------------ #
_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer

            logger.info("loading local embedding model %s (first load downloads it)", EMBED_MODEL)
            _model = SentenceTransformer(EMBED_MODEL)
            dim = (
                _model.get_embedding_dimension()
                if hasattr(_model, "get_embedding_dimension")
                else _model.get_sentence_embedding_dimension()
            )
            logger.info("embedding model ready, dim=%s", dim)
    return _model


def embed_texts(texts: list[str]):
    vecs = get_model().encode(texts, normalize_embeddings=True)
    return [v.astype("float32") for v in vecs]


# ------------------------------------------------------------------ #
# RediSearch storage
# ------------------------------------------------------------------ #
def ensure_index(r: redis.Redis) -> None:
    try:
        existing = r.execute_command("FT._LIST")
    except redis.ResponseError:
        existing = []
    if INDEX_NAME.encode() in existing:
        return
    r.execute_command(
        "FT.CREATE", INDEX_NAME, "ON", "HASH", "PREFIX", "1", "knowledge:",
        "SCHEMA",
        "avatar_id", "NUMERIC",
        "knowledge_id", "NUMERIC",
        "content", "TEXT",
        "embedding", "VECTOR", "HNSW", "6",
        "TYPE", "FLOAT32", "DIM", str(EMBED_DIM), "DISTANCE_METRIC", "COSINE",
    )
    logger.info("RediSearch index %s created", INDEX_NAME)


def delete_document_chunks(r: redis.Redis, avatar_id: int, knowledge_id: int) -> None:
    """Remove previously stored chunks for one knowledge document (re-ingest)."""
    try:
        res = r.execute_command(
            "FT.SEARCH", INDEX_NAME,
            f"(@avatar_id:[{avatar_id} {avatar_id}] @knowledge_id:[{knowledge_id} {knowledge_id}])",
            "NOCONTENT",
        )
        if res and res[0] > 0:
            keys = res[1::2]
            if keys:
                r.delete(*keys)
                logger.info("removed %d old chunk(s) for knowledge %s", len(keys), knowledge_id)
    except redis.ResponseError as exc:
        logger.warning("failed to clean old chunks (index missing?): %s", exc)


def store_chunks(r: redis.Redis, avatar_id: int, knowledge_id: int, chunks: list[str]) -> None:
    vectors = embed_texts(chunks)
    pipe = r.pipeline(transaction=False)
    for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
        key = f"knowledge:{avatar_id}:{knowledge_id}:{i}"
        pipe.hset(
            key,
            mapping={
                "avatar_id": avatar_id,
                "knowledge_id": knowledge_id,
                "content": chunk,
                "embedding": vec.tobytes(),
            },
        )
    pipe.execute()
    logger.info(
        "stored %d chunks for avatar %s knowledge %s",
        len(chunks), avatar_id, knowledge_id,
    )


# ------------------------------------------------------------------ #
# HTTP server for the Go API (Sub-Task 3)
# ------------------------------------------------------------------ #
app = FastAPI(title="rag-worker", docs_url=None, redoc_url=None)


class EmbedRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    avatarId: int
    text: str
    topK: int = 3


@app.post("/embed")
def embed_endpoint(req: EmbedRequest):
    vec = embed_texts([req.text])[0]
    return {"vector": vec.tolist()}


@app.post("/search")
def search_endpoint(req: SearchRequest):
    if _redis_client is None:
        return {"chunks": []}
    r = _redis_client
    vec = embed_texts([req.text])[0]
    query = (
        f"(@avatar_id:[{req.avatarId} {req.avatarId}])=>"
        f"[KNN {max(1, req.topK)} @embedding $B AS score]"
    )
    res = r.execute_command(
        "FT.SEARCH", INDEX_NAME, query,
        "PARAMS", "2", "B", vec.tobytes(),
        "SORTBY", "score", "ASC",
        "RETURN", "2", "content", "score",
        "DIALECT", "2",
    )
    chunks = []
    if res and res[0] > 0:
        for i in range(1, len(res), 2):
            fields = res[i + 1]
            item = {}
            for j in range(0, len(fields), 2):
                item[fields[j]] = fields[j + 1]
            chunks.append({"content": item.get("content", ""), "score": item.get("score", "")})
    return {"chunks": chunks}


# ------------------------------------------------------------------ #
# Ingestion pipeline
# ------------------------------------------------------------------ #
def ingest_one(r: redis.Redis, storage: S3Storage, work_root: Path, payload: dict) -> None:
    avatar_id = int(payload["avatarId"])
    knowledge_id = int(payload["knowledgeId"])
    s3_key = payload["s3Key"]
    filename = payload.get("filename", Path(s3_key).name)

    def webhook(status: str, content: str = "") -> None:
        try:
            requests.post(
                f"{API_BASE_URL}/api/avatars/{avatar_id}/knowledge/{knowledge_id}/status",
                json={"status": status, "content": content},
                timeout=10,
            )
        except Exception:
            logger.exception("knowledge webhook failed for %s", knowledge_id)

    try:
        local = work_root / f"knowledge_{knowledge_id}_{Path(filename).name}"
        local.parent.mkdir(parents=True, exist_ok=True)
        storage.download(s3_key, local)
        text = extract_text(local)
        if not text.strip():
            raise ValueError("no extractable text")
        chunks = chunk_text(text)
        if not chunks:
            raise ValueError("text chunking produced no chunks")
        ensure_index(r)
        delete_document_chunks(r, avatar_id, knowledge_id)
        store_chunks(r, avatar_id, knowledge_id, chunks)
        webhook("indexed", text)
        logger.info("avatar %s knowledge %s indexed (%d chunks)", avatar_id, knowledge_id, len(chunks))
    except Exception:
        logger.exception("knowledge ingestion failed for %s", knowledge_id)
        webhook("failed")


def main() -> None:
    global cfg, _redis_client
    _load_local_env()
    cfg = load_config()
    work_root = Path(cfg["work_root"])

    r = redis.Redis(
        host=cfg["redis_host"],
        port=cfg["redis_port"],
        password=cfg["redis_password"] or None,
        db=cfg["redis_db"],
        decode_responses=True,
    )
    _redis_client = r
    storage = S3Storage()

    # RediSearch availability check (fail fast with a clear hint).
    try:
        ensure_index(r)
    except redis.ResponseError as exc:
        logger.error(
            "RediSearch not available (%s). The knowledge base needs RedisStack "
            "(set redis image to redis/redis-stack-server in docker-compose.yml). "
            "The /embed + /search endpoints still start for the chat API.",
            exc,
        )

    threading.Thread(
        target=lambda: uvicorn.run(app, host="127.0.0.1", port=EMBED_SERVER_PORT, log_level="warning"),
        daemon=True,
        name="embed-server",
    ).start()
    logger.info("embed server on 127.0.0.1:%s", EMBED_SERVER_PORT)

    logger.info("rag worker started: queue=%s model=%s", INGEST_QUEUE_KEY, EMBED_MODEL)
    while True:
        try:
            item = r.blpop(INGEST_QUEUE_KEY, timeout=1)
            if item is None:
                continue
            payload = json.loads(item[1])
            if payload.get("type") != "ingest_knowledge":
                logger.warning("ignoring unknown task: %s", payload)
                continue
            logger.info("ingesting knowledge: %s", payload)
            ingest_one(r, storage, work_root, payload)
        except Exception:
            logger.exception("rag worker loop error, continuing")
            time.sleep(1)


if __name__ == "__main__":
    main()
