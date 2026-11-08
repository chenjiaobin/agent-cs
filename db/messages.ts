import type { UIMessage } from 'ai'
import { getDb } from './client'

/**
 * 消息表的读写全部收在这里。
 * route.ts 不写 SQL，page.tsx 更不碰数据库——和模型出口同一个道理。
 */

type MessageRow = {
  id: string
  role: string
  content: string
  reasoning_content: string | null
  tool_calls: unknown | null
  usage: unknown | null
  model: string | null
  finish_reason: string | null
  status: 'done' | 'aborted' | 'error'
  created_at: Date
}

export type SaveMeta = {
  usage?: unknown
  model?: string
  finishReason?: string
  status?: 'done' | 'aborted' | 'error'
}

/** 会话不存在就建一个。幂等，刷新页面重复调也不会产生两条。 */
export async function ensureConversation(id: string): Promise<void> {
  const db = await getDb()
  await db.query(
    `INSERT INTO conversations (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [id]
  )
}

/**
 * 把一条 UIMessage 拆成表里的列。
 * v7 的 UIMessage 是「parts 数组」，不是 v4 那种扁平的 content 字符串，
 * 所以文本、思考、工具调用要分别取。
 */
function flatten(message: UIMessage) {
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('')

  const reasoning = message.parts
    .filter((p) => p.type === 'reasoning')
    .map((p) => (p as { type: 'reasoning'; text: string }).text)
    .join('')

  const tools = message.parts.filter(
    (p) => p.type.startsWith('tool-') || p.type === 'dynamic-tool'
  )

  return {
    text,
    reasoning: reasoning || null,
    toolCalls: tools.length ? JSON.stringify(tools) : null,
  }
}

/** 落一条消息。同一个 id 重复写就更新，避免重试产生重复行。 */
export async function saveMessage(
  conversationId: string,
  message: UIMessage,
  meta: SaveMeta = {}
): Promise<void> {
  const db = await getDb()
  const { text, reasoning, toolCalls } = flatten(message)

  await db.query(
    `INSERT INTO messages
       (id, conversation_id, role, content, reasoning_content,
        tool_calls, usage, model, finish_reason, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       content = EXCLUDED.content,
       reasoning_content = EXCLUDED.reasoning_content,
       tool_calls = EXCLUDED.tool_calls,
       usage = EXCLUDED.usage,
       model = EXCLUDED.model,
       finish_reason = EXCLUDED.finish_reason,
       status = EXCLUDED.status`,
    [
      message.id,
      conversationId,
      message.role,
      text,
      reasoning,
      toolCalls,
      meta.usage ? JSON.stringify(meta.usage) : null,
      meta.model ?? null,
      meta.finishReason ?? null,
      meta.status ?? 'done',
    ]
  )

  await db.query(
    `UPDATE conversations SET updated_at = now() WHERE id = $1`,
    [conversationId]
  )
}

/**
 * 读历史，还原成 useChat 能直接吃的 UIMessage[]。
 *
 * 注意 status：断流的半截回答也读出来，前端才知道「上次没说完」。
 * 这里不把它伪装成一条完整回答，那比丢消息更糟。
 */
export async function listMessages(conversationId: string): Promise<UIMessage[]> {
  const db = await getDb()
  const { rows } = await db.query<MessageRow>(
    `SELECT id, role, content, reasoning_content, tool_calls,
            usage, model, finish_reason, status, created_at
       FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC, id ASC`,
    [conversationId]
  )

  return rows.map((row) => {
    const parts: UIMessage['parts'] = []
    if (row.reasoning_content) {
      parts.push({ type: 'reasoning', text: row.reasoning_content })
    }
    if (row.content) {
      parts.push({ type: 'text', text: row.content })
    }
    // 第 3 篇再把 tool_calls 还原成 tool parts，现在只保留文本。
    // metadata.status 让前端能标出「这条是断流的半截回答」，
    // 不塞进正文，避免污染内容。
    return {
      id: row.id,
      role: row.role as UIMessage['role'],
      parts,
      metadata: { status: row.status },
    }
  })
}

/** 会话的计数，验收脚本和调试用。 */
export async function countMessages(conversationId: string): Promise<number> {
  const db = await getDb()
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`,
    [conversationId]
  )
  return rows[0]?.n ?? 0
}
