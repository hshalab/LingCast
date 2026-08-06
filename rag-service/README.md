# rag-service（RAG 知识库微服务 · 零模型）

独立本地 RAG 知识库微服务（FastAPI + uvicorn + uv），**不依赖任何嵌入模型**：

- **检索引擎**：[zvec](https://zvec.org)（阿里进程内向量库/全文检索，零外部服务
  依赖），用内置 **Jieba 中文分词** + BM25 全文索引（cppjieba 词典随包自带，
  无需下载、无需联网）。
- **无模型**：不需要 sentence-transformers / torch / bge 等权重，镜像小、
  启动快、无 HF 下载。
- **数据持久化**：`./zvec_data`（Docker 里挂 volume）。
- **集合**：`avatar_knowledge`，schema 为 `avatar_id`(INT64，倒排索引) +
  `chunk_text`(STRING, FtsIndexParam jieba)。查询时**强制按 `avatar_id`
  标量过滤**，保证每个数字人的知识互相隔离。

> 取舍说明：全文检索是关键词/词法匹配（BM25），适合领域知识问答；与语义向量
> 检索相比，同义改写（如「咋泡」对「冲煮建议」）的召回会弱一些，但换来零模型
> 依赖、几十 MB 镜像和毫秒级启动。

## 本地运行

```bash
cd rag-service
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8001
```

启动即创建 `./zvec_data/avatar_knowledge` 集合，无需下载任何模型。

## API

### 健康检查

```bash
curl http://localhost:8001/healthz
# {"status":"ok","engine":"zvec-fts-jieba","collection":"avatar_knowledge","docs":123,"data_dir":"./zvec_data"}
```

### 知识入库 `POST /v1/knowledge/ingest`

请求：`{"avatar_id": 1, "text_content": "..."}`。服务按 **300 字 / 50 字重叠**
切块（优先在句子边界断句），写入 zvec 全文索引，并在响应返回后用
`BackgroundTasks` 触发 `optimize()`。

```bash
curl -X POST http://localhost:8001/v1/knowledge/ingest \
  -H 'Content-Type: application/json' \
  -d '{"avatar_id": 1, "text_content": "本店主打云南小粒咖啡……"}'
# {"status":"success","chunks_inserted":3}
```

可选字段 `"replace": true`：先删除该 `avatar_id` 的全部旧块再插入
（重新上传同一份知识时用，避免重复）。

### 知识检索 `POST /v1/knowledge/search`

请求：`{"avatar_id": 1, "query": "..."}`。查询经 jieba 分词后 BM25 检索，
带 `avatar_id = 1` 标量过滤，返回 Top 3 `chunk_text`。

```bash
curl -X POST http://localhost:8001/v1/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"avatar_id": 1, "query": "你们卖什么咖啡？"}'
# {"contexts":["...","...","..."],"scores":[1.23,0.87,0.54]}
```

## Docker

```bash
docker build -t rag-service .
docker run --rm -p 8001:8001 \
  -v rag-zvec-data:/app/zvec_data \
  rag-service
```

只需一个 volume 持久化知识数据，容器重建不丢知识。

## 环境变量

- `ZVEC_DATA_DIR`：数据目录，默认 `./zvec_data`（Docker 内 `/app/zvec_data`）
- `ZVEC_COLLECTION`：集合名，默认 `avatar_knowledge`
