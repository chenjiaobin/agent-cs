# agent-cs

「从 0 到 1 做一个能收钱的 Agent」系列仓库。

参考产品：面向中小商家的 AI 客服 / 售前 Agent。多租户、按对话量计费。
这一版是 **v0.2**——能连续对话、消息落库、刷新不丢、断流可识别。
一篇对应一个 git tag，`git checkout v0.1` 可以回到第 1 篇的状态。

## 环境要求

| 项目 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22** | AI SDK v7 已不支持 18/20，这条是硬门槛 |
| npm | 随 Node | 仓库里放了 `.npmrc` 指向官方源；公司内网 nexus 源会 403，别用 pnpm 的全局配置 |
| Docker | **不需要** | v0.2 起用 PGlite（WASM 版 Postgres），零安装 |

## 快速开始

```bash
cp .env.example .env.local     # 填上 DEEPSEEK_API_KEY
npm install
node scripts/smoke.mjs         # 先验接口，别等页面渲染完才发现 Key 不对
npm run dev                    # http://localhost:3000
```

另开一个终端跑端到端验收：

```bash
node scripts/verify-v02.mjs    # 或 npm run verify
```

`smoke.mjs` 用「关思考」和「开思考」各跑一轮，对比首字延迟与 token 用量；
`verify-v02.mjs` 打自己的 Next 接口，验证一轮对话确实落了两条消息、刷新后还在。

## v0.2 做了什么

| 问题 | 解法 |
|---|---|
| 本机没 Docker / 5432 不通 | PGlite，WASM 版 Postgres，SQL 与线上一致，零安装 |
| 刷新页面消息全丢 | 会话 id 放 URL `?c=` + localStorage，挂载前先拉历史 |
| SSE 断流卡在「正在输入」 | 15 秒内容心跳 + 重载按钮；服务端半截照存并标 `aborted` |
| 多标签页消息串 | BroadcastChannel 只广播「变了」，各自回数据库重读 |
| 第 3 篇带 tools 会 400 | 消息表第一天就留 `reasoning_content` / `tool_calls` / `usage` |

**数据库边界**：PGlite 是单进程嵌入式，只适合本地开发和单机；上线必须换真 Postgres。
所有 SQL 收在 `db/` 目录里，届时只改 `db/client.ts`，业务代码不动。

**安全边界**：会话 id 明文放在 URL 里，拿到链接就能看对话。第 9 篇上 RLS 和鉴权之前，不要接真实客户数据。

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
  api/chat/route.ts     流式接口 + 消息落库（GET 拉历史 / POST 对话）
  page.tsx              聊天界面：会话 id、断流提示、多标签页同步
lib/ai/
  model.ts              全项目唯一模型出口，业务代码只 import 这里
  prompt.ts             系统提示词（第 4 篇拆成分层文件）
db/
  client.ts             唯一数据库出口（PGlite 单例）
  messages.ts           消息读写，route.ts 不写 SQL
  schema.sql            conversations / messages 建表
  init.sql              pgvector 扩展 + 维度自检表（第 5 篇用）
scripts/
  smoke.mjs             接口连通与首字延迟实测
  verify-v02.mjs        v0.2 端到端落库验收
docs/
  acceptance.md         验收清单
```

## AI SDK v7 与网上教程的差异

这个仓库用的是 v7，网上大量教程还停在 v4/v5，直接抄会编译不过：

| v5 / v6 写法 | v7 写法 |
|---|---|
| `result.toDataStreamResponse()` | `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` |
| `system: '...'` | `instructions: '...'`（v7 默认拒绝 messages 里的 system 消息） |
| `stopWhen: stepCountIs(8)` | `stopWhen: isStepCount(8)` |
| `usage.reasoningTokens` | `usage.outputTokenDetails.reasoningTokens` |
| `onFinish` | `onEnd` |

另外 v7 **只发 ESM**，`package.json` 必须有 `"type": "module"`。
落库用 `toUIMessageStream` 的 `onEnd` 回调，它直接给出拼好的 `responseMessage`，不用自己拼流式片段。

## 验收

见 `docs/acceptance.md`。

```bash
npm run typecheck              # TypeScript 零错误
npm run build                  # 生产构建通过
node scripts/smoke.mjs         # 接口通，且关思考确实更省
node scripts/verify-v02.mjs    # 落库链路全绿（需要 dev 正在运行）
```

`docker-compose.yml` 留着给第 5 篇的 pgvector 用，本地开发不需要启动它。

## 和「手搓 Agent」的关系

手搓是为了知道里面有什么，用框架是为了把东西交出去。这两件事不冲突，但不能互相替代。

这个仓库做的是第二件事：组装成整机，再处理整机的毛病——记忆、并发、权限、计费、评测。
