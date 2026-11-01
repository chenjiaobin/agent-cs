import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'
import { MODEL_ID, models, providerOptions } from '@/lib/ai/model'
import { SYSTEM_PROMPT } from '@/lib/ai/prompt'

export const maxDuration = 60

/**
 * AI SDK v7 的写法，和网上大量 v4/v5 教程不一样，注意三处：
 *   1. 返回用顶层的 createUIMessageStreamResponse + toUIMessageStream，
 *      result.toDataStreamResponse() 那套已经不用了
 *   2. 系统提示词走顶层 instructions，不要再往 messages 里塞 system 消息
 *      （v7 默认拒绝 messages 中的 system，除非显式开 allowSystemInMessages）
 *   3. 用量在 usage.outputTokenDetails.reasoningTokens，不在 usage.reasoningTokens
 */
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const startedAt = Date.now()
  let firstTokenAt = 0

  const result = streamText({
    model: models.fast,
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    providerOptions: providerOptions.thinkingOff,
    onChunk: () => {
      if (firstTokenAt === 0) firstTokenAt = Date.now()
    },
    onEnd: ({ usage, finishReason }) => {
      // 这一行是第 10、11 篇可观测与成本核算的种子，第 1 篇先只打日志
      console.log(
        JSON.stringify({
          event: 'chat.turn',
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

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
