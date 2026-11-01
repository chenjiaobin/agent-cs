# agent-cs

「从 0 到 1 做一个能收钱的 Agent」系列仓库。

参考产品：面向中小商家的 AI 客服 / 售前 Agent。多租户、按对话量计费。
这一版是 **v0.1 空壳**——只有立项、选型和一条能跑通的最小流式对话。

## 环境要求

| 项目 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22** | AI SDK v7 已不支持 18/20，这条是硬门槛 |
| pnpm | ≥ 8 | npm 也能跑，只是我这个仓库用 pnpm |
| Docker | 可选 | 起 Postgres + pgvector 用；没装 Docker 见下文替代方案 |

## 快速开始

```bash
cp .env.example .env.local     # 填上 DEEPSEEK_API_KEY
pnpm install
node scripts/smoke.mjs         # 先验接口，别等页面渲染完才发现 Key 不对
pnpm dev                       # http://localhost:3000
```

`scripts/smoke.mjs` 会分别用「关思考」和「开思考」各跑一轮，把首字延迟、token 用量、单轮成本打出来对比。这是本篇最值得亲眼看一次的数据。

## 技术选型：不是三选一，是叠着用

| 层 | 选型 | 管什么 | 不管什么 |
|---|---|---|---|
| 推理层 | Vercel AI SDK **v7** | 模型调用、流式、工具循环、结构化输出 | 持久状态、记忆、图 |
| 编排层 | Mastra 1.x（第 6 篇引入） | workflow、记忆、RAG、评测 | 多租户、计费、对外服务 |
| 业务层 | 自己写 | 租户隔离、计费、权限、审计 | 一切都得自己写 |

选型的三条判断：

- **换不掉的三件**：AI SDK、Postgres + pgvector、Zod
- **二选一**：Mastra / LangGraph.js（后者留到第 13 篇讲何时该换）
- **可以后补**：评测、链路追踪、队列、限流

## 模型

| 用途 | 模型 | 说明 |
|---|---|---|
| 对话 / 分类 / 摘要 | `deepseek-flash` | 默认关思考 |
| 攻坚（多步推理） | `deepseek-v4-pro` | 少数场景才用 |
| 向量化 | 阿里百炼 `text-embedding-v4` | DeepSeek 没有 embedding |
| 重排 | 阿里百炼 `gte-rerank-v2` | 同上 |

模型名走环境变量，不写死在代码里。`deepseek-chat` / `deepseek-reasoner` 已是兼容别名，新代码别再用。

## 目录结构

```
app/
  api/chat/route.ts     流式接口（AI SDK v7 写法）
  page.tsx              最小聊天界面
lib/ai/
  model.ts              全项目唯一模型出口，业务代码只 import 这里
  prompt.ts             系统提示词（第 4 篇拆成分层文件）
db/
  init.sql              pgvector 扩展 + 维度自检表
scripts/
  smoke.mjs             接口连通与首字延迟实测
docs/
  acceptance.md         验收清单
```

## AI SDK v7 与网上教程的差异

这个仓库用的是 v7，网上大量教程还停在 v4/v5，直接抄会编译不过。三处最容易踩：

| v5 / v6 写法 | v7 写法 |
|---|---|
| `result.toDataStreamResponse()` | `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` |
| `system: '...'` | `instructions: '...'`（v7 默认拒绝 messages 里的 system 消息） |
| `stopWhen: stepCountIs(8)` | `stopWhen: isStepCount(8)` |
| `usage.reasoningTokens` | `usage.outputTokenDetails.reasoningTokens` |

另外 v7 **只发 ESM**，`package.json` 必须有 `"type": "module"`。

## 没有 Docker 怎么办

`docker-compose.yml` 是给有 Docker 的机器用的。没有的话两条路：

1. **本地装 PostgreSQL + pgvector 扩展**（一次性折腾，之后最稳）
2. **用云库**：Supabase / Neon 免费层，把连接串填进 `DATABASE_URL`

v0.1 不需要数据库也能跑通对话。第 2 篇要落库时才必须解决。

## 验收

见 `docs/acceptance.md`。

v0.1 的五条：

```bash
pnpm build                     # 编译通过
node scripts/smoke.mjs         # 接口通，且关思考确实更快
docker compose up -d && psql "$DATABASE_URL" -c '\dx'   # 看得到 vector
```

## 和「手搓 Agent」的关系

手搓是为了知道里面有什么，用框架是为了把东西交出去。这两件事不冲突，但不能互相替代。

这个仓库做的是第二件事：组装成整机，再处理整机的毛病——记忆、并发、权限、计费、评测。
