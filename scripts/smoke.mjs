#!/usr/bin/env node
/**
 * v0.1 的验收脚本：不依赖 Next.js，直接打 DeepSeek 接口。
 *
 * 它回答三个问题：
 *   1. Key 到底通不通（不用等页面渲染完才发现）
 *   2. 思考模式开着和关着，用户第一次看到字要等多久
 *   3. 思维链占了多少输出 token（这部分是按输出价计费的）
 *
 * 用法：
 *   node scripts/smoke.mjs              # 默认跑关思考 + 开思考对比
 *   node scripts/smoke.mjs --off        # 只跑关思考
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const env = { ...loadEnv(resolve('.env.local')), ...process.env }
const apiKey = env.DEEPSEEK_API_KEY
const model = env.DEEPSEEK_MODEL_FAST || 'deepseek-flash'
const baseURL = 'https://api.deepseek.com/v1'

if (!apiKey) {
  console.error('\n缺少 DEEPSEEK_API_KEY。')
  console.error('把 .env.example 复制成 .env.local，填上 Key 再跑：')
  console.error('  cp .env.example .env.local\n')
  process.exit(1)
}

async function turn({ thinking, label }) {
  const body = {
    model,
    messages: [{ role: 'user', content: '用一句话介绍你自己，不超过 30 字。' }],
    stream: true,
    stream_options: { include_usage: true },
  }
  if (thinking) body.thinking = { type: thinking }

  const startedAt = Date.now()
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let ttftReasoning = null
  let ttftContent = null
  let content = ''
  let reasoningLen = 0
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      if (json.usage) usage = json.usage
      const delta = json.choices?.[0]?.delta
      if (!delta) continue

      if (delta.reasoning_content) {
        if (ttftReasoning === null) ttftReasoning = Date.now() - startedAt
        reasoningLen += delta.reasoning_content.length
      }
      if (delta.content) {
        if (ttftContent === null) ttftContent = Date.now() - startedAt
        content += delta.content
      }
    }
  }

  const totalMs = Date.now() - startedAt
  return { label, ttftReasoning, ttftContent, totalMs, content, reasoningLen, usage }
}

function report(r, priceIn = 1, priceOut = 4) {
  const inTok = r.usage?.prompt_tokens ?? 0
  const outTok = r.usage?.completion_tokens ?? 0
  const cost = (inTok / 1e6) * priceIn + (outTok / 1e6) * priceOut

  console.log(`\n── ${r.label} ──`)
  if (r.ttftReasoning !== null) {
    console.log(`  首个思考片段   ${r.ttftReasoning} ms（用户看不到）`)
  }
  if (r.ttftContent !== null) {
    console.log(`  首个可见字符   ${r.ttftContent} ms  ← 用户感知的是这个`)
  } else {
    console.log('  首个可见字符   —（没有正文输出）')
  }
  console.log(`  整轮耗时       ${r.totalMs} ms`)
  console.log(`  输入 token     ${inTok}`)
  console.log(`  输出 token     ${outTok}${r.reasoningLen ? `（其中思维链约 ${r.reasoningLen} 字）` : ''}`)
  console.log(`  本轮成本       ¥${cost.toFixed(6)}  （按闲时价估算）`)
  if (r.content) console.log(`  回答           ${r.content.trim().slice(0, 60)}`)
}

const onlyOff = process.argv.includes('--off')

console.log(`模型：${model}`)
console.log(`接口：${baseURL}`)

try {
  const off = await turn({ thinking: 'disabled', label: '思考模式：关闭' })
  report(off)

  if (!onlyOff) {
    const on = await turn({ thinking: 'enabled', label: '思考模式：开启（默认就是它）' })
    report(on)

    if (off.ttftContent !== null && on.ttftContent !== null) {
      const gap = on.ttftContent - off.ttftContent
      console.log(`\n结论：关掉思考，用户早 ${gap} ms 看到第一个字。`)
      if (on.usage && off.usage) {
        console.log(
          `      同一句话，开着思考多花 ${on.usage.completion_tokens - off.usage.completion_tokens} 个输出 token。`
        )
      }
    }
  }

  console.log('\n✅ v0.1 验收项「模型接口连通」通过。\n')
} catch (err) {
  console.error(`\n❌ 连通失败：${err.message}\n`)
  process.exit(1)
}
