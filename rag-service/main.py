"""Local RAG knowledge-base microservice (Zvec FTS, zero-model).

Pure-lexical Chinese knowledge base backed by zvec's in-process full-text
search: no embedding model, no torch / sentence-transformers, no downloads.
Chinese text is segmented by zvec's bundled Jieba tokenizer, and results are
strictly isolated per knowledge scope with scalar filters.

Data model (two levels):
    avatar (robot) -> knowledge collection (知识库) -> documents (文档/chunks)
Each chunk row stores `avatar_id`, `collection_id` and `source_id`
(knowledge document ID) so queries can be scoped to an avatar (live chat),
one collection (management UI) or a single document (delete/rebuild).

Endpoints:
    GET  /healthz                          -> {"status": "ok", ...}
    POST /v1/knowledge/ingest
        {"avatar_id": 1, "collection_id": 1, "source_id": 1, "text_content": "..."}
                                            -> {"status": "success", "chunks_inserted": n}
    POST /v1/knowledge/search
        {"avatar_id": 1, "query": "..."}         -> {"contexts": ["...", ...], "scores": [0.9, ...]}
        {"collection_id": 1, "query": "..."}     -> same (scoped to one collection)
    POST /v1/knowledge/delete
        {"source_id": 1} | {"collection_id": 1} | {"avatar_id": 1}  -> {"deleted": true}
    POST /v1/knowledge/chunks
        {"source_id": 1}  -> {"chunks": [{"index": 0, "text": "..."}, ...]}

Run:
    uv run uvicorn main:app --host 0.0.0.0 --port 8001
"""

import logging
import os
import re
import threading
import uuid
from contextlib import asynccontextmanager

import zvec
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger("rag-service")
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DATA_DIR = os.environ.get("ZVEC_DATA_DIR", "./zvec_data")
COLLECTION_NAME = os.environ.get("ZVEC_COLLECTION", "avatar_knowledge")

CHUNK_SIZE = 300          # max chars per chunk
CHUNK_OVERLAP = 50        # overlap between consecutive chunks
SEARCH_TOPK = 3           # number of chunks returned per query

_collection: zvec.Collection | None = None
_startup_lock = threading.Lock()
_optimize_lock = threading.Lock()


def _collection_path() -> str:
    return os.path.join(DATA_DIR, COLLECTION_NAME)


def _open_or_create_collection() -> zvec.Collection:
    """Open the zvec collection if it exists, otherwise create it.

    zvec collections are locked while a read-write handle is open, so the
    service opens exactly one handle at startup and reuses it.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    path = _collection_path()
    if os.path.exists(path):
        try:
            collection = zvec.open(path=path)
            logger.info("opened existing zvec collection at %s", path)
            return collection
        except Exception as exc:
            raise RuntimeError(
                f"existing path {path} is not a valid zvec collection "
                f"(remove/rename it to re-initialize): {exc}"
            ) from exc

    schema = zvec.CollectionSchema(
        name=COLLECTION_NAME,
        fields=[
            zvec.FieldSchema(
                name="avatar_id",
                data_type=zvec.DataType.INT64,
                index_param=zvec.InvertIndexParam(enable_range_optimization=True),
            ),
            zvec.FieldSchema(
                name="collection_id",
                data_type=zvec.DataType.INT64,
                index_param=zvec.InvertIndexParam(enable_range_optimization=True),
            ),
            zvec.FieldSchema(
                name="source_id",
                data_type=zvec.DataType.INT64,
                index_param=zvec.InvertIndexParam(enable_range_optimization=True),
            ),
            zvec.FieldSchema(
                name="chunk_text",
                data_type=zvec.DataType.STRING,
                nullable=False,
                index_param=zvec.FtsIndexParam(
                    tokenizer_name="jieba", filters=["lowercase"]
                ),
            ),
        ],
    )
    collection = zvec.create_and_open(path=path, schema=schema)
    logger.info("created zvec collection %s at %s", COLLECTION_NAME, path)
    return collection


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _collection
    with _startup_lock:
        _collection = _open_or_create_collection()
    yield


app = FastAPI(
    title="rag-service",
    description=(
        "Local RAG knowledge base: zvec in-process full-text search "
        "(Jieba Chinese tokenizer) + FastAPI. No embedding model required."
    ),
    version="0.2.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class IngestRequest(BaseModel):
    avatar_id: int = Field(..., description="Avatar (bot) ID the knowledge belongs to.")
    collection_id: int = Field(..., description="Knowledge collection (知识库) ID.")
    source_id: int = Field(
        default=0,
        description=(
            "Knowledge document (文档) ID. Re-ingesting the same source_id with "
            "replace=true rebuilds only that document's chunks."
        ),
    )
    text_content: str = Field(..., description="Raw knowledge text to chunk and index.")
    replace: bool = Field(
        default=False,
        description=(
            "If true, delete existing chunks scoped to source_id (or collection_id "
            "when source_id is 0) before inserting."
        ),
    )

    @field_validator("avatar_id")
    @classmethod
    def _avatar_id_positive(cls, v: int) -> int:
        if v < 0:
            raise ValueError("avatar_id must be >= 0")
        return v

    @field_validator("text_content")
    @classmethod
    def _text_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("text_content must not be empty")
        return v


class SearchRequest(BaseModel):
    avatar_id: int | None = Field(
        default=None,
        description="Avatar (bot) ID to restrict the search to (live chat scope).",
    )
    collection_id: int | None = Field(
        default=None,
        description="Knowledge collection (知识库) ID to restrict the search to.",
    )
    query: str = Field(..., description="User question / query text.")

    @field_validator("avatar_id")
    @classmethod
    def _avatar_id_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("avatar_id must be >= 0")
        return v

    @field_validator("collection_id")
    @classmethod
    def _collection_id_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("collection_id must be >= 0")
        return v

    @field_validator("query")
    @classmethod
    def _query_nonempty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("query must not be empty")
        return v

    @model_validator(mode="after")
    def _scope_required(self) -> "SearchRequest":
        if self.avatar_id is None and self.collection_id is None:
            raise ValueError("provide at least one of avatar_id / collection_id")
        return self


class DeleteRequest(BaseModel):
    avatar_id: int | None = Field(default=None)
    collection_id: int | None = Field(default=None)
    source_id: int | None = Field(default=None)

    @model_validator(mode="after")
    def _scope_required(self) -> "DeleteRequest":
        if self.avatar_id is None and self.collection_id is None and self.source_id is None:
            raise ValueError("provide at least one of avatar_id / collection_id / source_id")
        return self


class ChunksRequest(BaseModel):
    source_id: int = Field(..., description="Knowledge document (文档) ID.")
    collection_id: int | None = Field(default=None)

    @field_validator("source_id")
    @classmethod
    def _source_id_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("source_id must be > 0")
        return v


def _scope_filter(
    avatar_id: int | None = None,
    collection_id: int | None = None,
    source_id: int | None = None,
) -> str:
    """Build a zvec scalar filter from the provided scope fields."""
    parts: list[str] = []
    if avatar_id is not None:
        parts.append(f"avatar_id = {avatar_id}")
    if collection_id is not None:
        parts.append(f"collection_id = {collection_id}")
    if source_id is not None:
        parts.append(f"source_id = {source_id}")
    if not parts:
        raise ValueError("at least one scope field is required")
    return " AND ".join(parts)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_SENT_BOUNDARY = re.compile(r"[。！？!?；;\n]")


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks (max `size` chars, `overlap` overlap).

    Chunk boundaries prefer sentence punctuation (。！？!?；;\n) inside the
    window so the retrieved pieces read naturally.
    """
    text = re.sub(r"\s+", " ", text.strip())
    if len(text) <= size:
        return [text] if text else []

    chunks: list[str] = []
    step = max(1, size - overlap)
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            # Prefer the last sentence boundary inside the window.
            window = text[start:end]
            for m in reversed(list(_SENT_BOUNDARY.finditer(window))):
                if m.end() >= size - overlap:  # keep overlap meaningful
                    end = start + m.end()
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = end - overlap if end - overlap > start else start + step
    return chunks


def _require_ready() -> zvec.Collection:
    if _collection is None:
        raise RuntimeError("service not ready yet")
    return _collection


def _optimize_safely() -> None:
    """Rebuild indexes in the background; guard against concurrent calls."""
    with _optimize_lock:
        try:
            _collection.optimize()  # type: ignore[union-attr]
        except Exception as exc:  # pragma: no cover - best-effort housekeeping
            logger.warning("zvec optimize failed (ignored): %s", exc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz() -> dict:
    if _collection is None:
        return {"status": "loading"}
    try:
        stats = _collection.stats
    except Exception:
        stats = None
    return {
        "status": "ok",
        "engine": "zvec-fts-jieba",
        "collection": COLLECTION_NAME,
        "docs": getattr(stats, "doc_count", None),
        "data_dir": DATA_DIR,
    }


@app.post("/v1/knowledge/ingest")
def ingest(req: IngestRequest, background_tasks: BackgroundTasks) -> dict:
    collection = _require_ready()

    chunks = chunk_text(req.text_content)
    if not chunks:
        raise HTTPException(status_code=400, detail="text_content produced no chunks")

    ingest_id = uuid.uuid4().hex[:12]
    docs = [
        zvec.Doc(
            id=f"{req.collection_id}_{req.source_id}_{ingest_id}_{i}",
            fields={
                "avatar_id": req.avatar_id,
                "collection_id": req.collection_id,
                "source_id": req.source_id,
                "chunk_text": chunk,
            },
        )
        for i, chunk in enumerate(chunks)
    ]

    try:
        if req.replace:
            # Rebuild one document (source_id) or one collection when no source
            # id is given; never wipe the whole avatar by accident.
            filter_expr = _scope_filter(
                avatar_id=req.avatar_id if req.source_id else None,
                collection_id=req.collection_id if not req.source_id else None,
                source_id=req.source_id or None,
            )
            collection.delete_by_filter(filter=filter_expr)
        collection.insert(docs)
    except Exception as exc:  # surface zvec errors (e.g. duplicate id) cleanly
        raise HTTPException(status_code=500, detail=f"zvec insert failed: {exc}") from exc

    background_tasks.add_task(_optimize_safely)

    logger.info(
        "ingested %d chunks for avatar_id=%d collection_id=%d source_id=%d (replace=%s)",
        len(docs),
        req.avatar_id,
        req.collection_id,
        req.source_id,
        req.replace,
    )
    return {"status": "success", "chunks_inserted": len(docs)}


@app.post("/v1/knowledge/search")
def search(req: SearchRequest) -> dict:
    collection = _require_ready()

    try:
        # MANDATORY scalar filter: results must belong to the requested scope
        # only (avatar for live chat, collection for the management UI).
        filter_expr = _scope_filter(
            avatar_id=req.avatar_id,
            collection_id=req.collection_id,
        )
        result = collection.query(
            queries=zvec.Query(
                field_name="chunk_text",
                fts=zvec.Fts(match_string=req.query),
            ),
            filter=filter_expr,
            topk=SEARCH_TOPK,
            output_fields=["chunk_text"],
            include_vector=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"zvec query failed: {exc}") from exc

    contexts: list[str] = []
    scores: list[float] = []
    for doc in result:
        text = doc.fields.get("chunk_text", "")
        if text:
            contexts.append(str(text))
            scores.append(float(doc.score))
    logger.info(
        "search avatar_id=%s collection_id=%s -> %d result(s)",
        req.avatar_id,
        req.collection_id,
        len(contexts),
    )
    return {"contexts": contexts, "scores": scores}


@app.post("/v1/knowledge/delete")
def delete_knowledge(req: DeleteRequest, background_tasks: BackgroundTasks) -> dict:
    """Delete chunks scoped to a source document, collection or avatar."""
    collection = _require_ready()
    filter_expr = _scope_filter(
        avatar_id=req.avatar_id,
        collection_id=req.collection_id,
        source_id=req.source_id,
    )
    try:
        collection.delete_by_filter(filter=filter_expr)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"zvec delete failed: {exc}") from exc
    background_tasks.add_task(_optimize_safely)
    logger.info("deleted knowledge scope: %s", filter_expr)
    return {"deleted": True}


@app.post("/v1/knowledge/chunks")
def list_chunks(req: ChunksRequest) -> dict:
    """List the actual indexed chunks of one knowledge document, in order."""
    collection = _require_ready()
    filter_expr = _scope_filter(
        collection_id=req.collection_id,
        source_id=req.source_id,
    )
    try:
        # Pure scalar-filter query (no vector / FTS) returns every document
        # matching the scope; topk is intentionally large for small docs.
        result = collection.query(
            filter=filter_expr,
            topk=10000,
            output_fields=["chunk_text"],
            include_vector=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"zvec query failed: {exc}") from exc

    # Doc ids look like "<collection>_<source>_<uuid>_<i>"; recover the chunk
    # order from the trailing index so the UI shows the original sequence.
    chunks: list[dict] = []
    for doc in result:
        text = doc.fields.get("chunk_text", "")
        if not text:
            continue
        try:
            idx = int(str(doc.id).rsplit("_", 1)[1])
        except (ValueError, IndexError):
            idx = len(chunks)
        chunks.append({"index": idx, "text": str(text)})
    chunks.sort(key=lambda c: c["index"])
    logger.info("chunks for source_id=%d -> %d chunk(s)", req.source_id, len(chunks))
    return {"chunks": chunks}
