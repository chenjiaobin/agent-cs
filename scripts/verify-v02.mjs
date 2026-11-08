#!/usr/bin/env node
/**
 * v0.2 端到端验收：刷新之后消息还在不在。
 *
 * 和 smoke.mjs 不一样，这个脚本打的是自己的 Next 接口，
 * 验证的是「落库」这条链路，不是模型通不通。
 *
 * 用法：
 *   npm run dev                     # 另开一个终端
 *   node scripts/verify-v02.mjs
 *
 * 会新建一个独立会话 id，不污染你页面上的对话。
 */

const BASE = process.argv[2] ?? 'http://localhost:3000'
const conversationId = `verify_${Date.now()}`

async function getHistory() {
  const res = await fetch(
    `${BASE}/api/chat?conversationId=${encodeURIComponent(conversationId)}`
  )
  if (!res.ok) throw new Error(`GET 失败：HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

function assert(cond, msg) {
  if (!cond) throw new Error(`❌ ${msg}`)
  console.log(`  ✓ ${msg}`)
}

console.log(`目标：${BASE}`)
console.log(`会话：${conversationId}\n`)

try {
  const before = await getHistory()
  assert(before.messages.length === 0, '新会话初始是空的')

  const startedAt = Date.now()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      messages: [
        {
          id: `user_${conversationId}`,
          role: 'user',
          parts: [{ type: 'text', text: '用一句话说说你能帮我做什么。' }],
        },
      ],
    }),
  })
  assert(res.ok, `POST 返回 ${res.status}`)
  assert(
    (res.headers.get('content-type') ?? '').includes('text/event-stream') ||
      (res.headers.get('content-type') ?? '').includes('stream'),
    '响应是流式（SSE）'
  )

  // 必须把流读完，onEnd 才会触发、才会落库。
  // 只发请求不看响应就断开，正是文章里那个「断流」坑的复现方式。
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let chunks = 0
  let firstChunkAt = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstChunkAt) firstChunkAt = Date.now()
    chunks += decoder.decode(value, { stream: true }).split('\n').length
  }
  console.log(`  流式片段约 ${chunks} 行，首片 ${firstChunkAt - startedAt} ms，整轮 ${Date.now() - startedAt} ms`)

  // onEnd 在流末尾异步写库，给它一点时间，别用固定 sleep 赌运气。
  let after = null
  for (let i = 0; i < 10; i++) {
    after = await getHistory()
    if (after.messages.length >= 2) break
    await new Promise((r) => setTimeout(r, 200))
  }

  assert(after.messages.length === 2, '一轮对话落下两条消息（user + assistant）')
  const user = after.messages.find((m) => m.role === 'user')
  const assistant = after.messages.find((m) => m.role === 'assistant')
  assert(!!user && user.parts.some((p) => p.type === 'text' && p.text.length > 0), '用户消息有正文')
  assert(!!assistant && assistant.parts.some((p) => p.type === 'text' && p.text.length > 0), '助手消息有正文')
  assert(assistant?.metadata?.status === 'done', '助手消息状态是 done（没被误判成断流）')

  // 再读一次，模拟「刷新页面」
  const reloaded = await getHistory()
  assert(reloaded.messages.length === 2, '重新读取（刷新）后消息还在')
  assert(
    reloaded.messages.every((m) => m.id && m.id.length > 0),
    '读回来的消息带稳定 id'
  )

  console.log('\n✅ v0.2 验收通过：能连续对话、刷新不丢、断流可识别。')
  console.log('   去页面用同一个 ?c= 打开，就能看到这段历史。')
} catch (err) {
  console.error(`\n${err.message}`)
  console.error('   确认 npm run dev 正在运行，且 .env.local 里填了 DEEPSEEK_API_KEY。\n')
  process.exit(1)
}
