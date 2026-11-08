import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'
import { randomUUID } from 'node:crypto'
import { MODEL_ID, models, providerOptions } from '@/lib/ai/model'
import { SYSTEM_PROMPT } from '@/lib/ai/prompt'
import { ensureConversation, listMessages, saveMessage } from '@/db/messages'

export const maxDuration = 60
// PGlite 要读写本地数据目录，必须用 Node runtime，不能跑 Edge。
export const runtime = 'nodejs'

/**
 * AI SDK v7 的写法，和网上大量 v4/v5 教程不一样，注意三处：
 *   1. 返回用顶层的 createUIMessageStreamResponse + toUIMessageStream，
 *      result.toDataStreamResponse() 那套已经不用了
 *   2. 系统提示词走顶层 instructions，不要再往 messages 里塞 system 消息
 *   3. 用量在 usage.outputTokenDetails.reasoningTokens，不在 usage.reasoningTokens
 */

// 会话 id 来自客户端，直接拿去当主键前必须收紧格式。
// 这不是防 SQL 注入（参数化查询已经防了），是防有人塞一个 10MB 的字符串进来。
const CONVERSATION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

function readConversationId(value: unknown): string | null {
  return typeof value === 'string' && CONVERSATION_ID_RE.test(value) ? value : null
}

/** GET /api/chat?conversationId=xxx —— 刷新页面后把历史捞回来 */
export async function GET(req: Request) {
  const conversationId = readConversationId(
    new URL(req.url).searchParams.get('conversationId')
  )
  if (!conversationId) {
    return Response.json({ error: 'invalid conversationId' }, { status: 400 })
  }

  await ensureConversation(conversationId)
  const messages = await listMessages(conversationId)
  return Response.json({ conversationId, messages })
}

export async function POST(req: Request) {
  const body: { messages?: UIMessage[]; conversationId?: unknown } = await req.json()
  const conversationId = readConversationId(body.conversationId)
  if (!conversationId || !Array.isArray(body.messages)) {
    return Response.json({ error: 'invalid request' }, { status: 400 })
  }
  const messages = body.messages

  await ensureConversation(conversationId)

  // 只落最后一条用户消息。useChat 每次都把完整历史发过来，
  // 全量 INSERT 会重复写；靠 ON CONFLICT 兜底，但没必要发那么多遍。
  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    await saveMessage(conversationId, last)
  }

  const startedAt = Date.now()
  let firstTokenAt = 0
  // 先定好 assistant 消息的 id：流式开始时前端拿到的 id 和落库的必须是同一个，
  // 否则第 3 篇做「重试这条回答」时会对不上。
  const assistantId = `msg_${randomUUID()}`

  const result = streamText({
    model: models.fast,
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    providerOptions: providerOptions.thinkingOff,
    // 客户端断开（关页面、点停止）时把模型请求一起取消。
    // 不传这个，前端走了，后端还在继续生成，钱照烧。
    abortSignal: req.signal,
    onChunk: () => {
      if (firstTokenAt === 0) firstTokenAt = Date.now()
    },
    onEnd: ({ usage, finishReason }) => {
      // 第 10、11 篇可观测与成本核算的种子
      console.log(
        JSON.stringify({
          event: 'chat.turn',
          conversationId,
          model: MODEL_ID.fast,
          firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
          totalMs: Date.now() - startedAt,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
          finishReason,
        })
      )
    },
  })

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    generateMessageId: () => assistantId,
    /**
     * 落库放在流结束的回调里，而不是另起一个请求。
     * 这里能直接拿到 SDK 拼好的完整 responseMessage（含 parts），
     * 不用自己把流式片段再拼一遍，也就不会出现「拼错了」这种脏数据。
     *
     * isAborted / outcome 用来区分「说完了」和「断在半路」。
     * 断流时把半截文本照样存下来，标成 aborted——用户刷新能看到，
     * 而不是发现自己的问题凭空消失了。
     */
    onEnd: async ({ responseMessage, isAborted, outcome, finishReason }) => {
      const aborted = isAborted || outcome.status !== 'completed'
      let usage: unknown = undefined
      try {
        usage = await result.usage
      } catch {
        // 断流时 usage 可能拿不到，不影响消息落库
      }

      try {
        await saveMessage(conversationId, responseMessage, {
          usage,
          model: MODEL_ID.fast,
          finishReason: finishReason ?? (aborted ? 'aborted' : undefined),
          status: aborted ? 'aborted' : 'done',
        })
        console.log(
          JSON.stringify({
            event: 'chat.persisted',
            conversationId,
            messageId: responseMessage.id,
            status: aborted ? 'aborted' : 'done',
          })
        )
      } catch (err) {
        // 落库失败不能把已经流出去的回答变成一次 500。
        // 第 10 篇接了链路追踪之后，这里要改成告警。
        console.error('persist failed', err)
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}
