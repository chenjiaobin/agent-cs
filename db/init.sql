-- v0.1：不建业务表，只验证 pgvector 真的能用。
-- 第 2 篇才建 conversations / messages，第 5 篇建 chunks。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS smoke_check (
  id          serial PRIMARY KEY,
  note        text NOT NULL,
  embedding   vector(1024),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 维度锁死 1024：这一行写下去，换 embedding 模型就等于全量重建索引。
-- 第 5 篇会把"为什么是 1024"讲透，现在只要知道它不是随手写的。
CREATE INDEX IF NOT EXISTS smoke_check_embedding_idx
  ON smoke_check USING hnsw (embedding vector_cosine_ops);
