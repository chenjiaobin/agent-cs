import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * 全项目唯一的模型出口。
 *
 * 规则（第 1 篇定，后面 12 篇都不破）：
 *   业务代码只允许 import 这里的 models / embedding，
 *   任何地方都不许自己 new OpenAI() 或写 baseURL。
 *
 * 原因很实际：第 11 篇要加超时、重试、token 计量、峰谷路由，
 * 如果模型客户端散在 20 个文件里，这件事就做不成。
 */

const deepseek = createOpenAICompatible({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  includeUsage: true,
})

/**
 * 模型名走环境变量，不写死在代码里。
 * 官方文档已不推荐 deepseek-chat / deepseek-reasoner 这类旧名，
 * 统一用 deepseek-flash / deepseek-v4-pro，换名时改 .env 即可。
 */
export const MODEL_ID = {
  fast: process.env.DEEPSEEK_MODEL_FAST ?? 'deepseek-flash',
  pro: process.env.DEEPSEEK_MODEL_PRO ?? 'deepseek-v4-pro',
} as const

export const models = {
  fast: deepseek(MODEL_ID.fast),
  pro: deepseek(MODEL_ID.pro),
}

/**
 * DeepSeek 的思考模式默认是开的，而且强度默认 high。
 * 不显式关掉，首字延迟 1 秒变 5-10 秒，思维链还按输出 token 计费。
 *
 * 这里的 providerOptions 会被 AI SDK 原样塞进请求体，
 * 最终发出去的就是 {"thinking": {"type": "disabled"}}。
 */
export const providerOptions = {
  thinkingOff: {
    deepseek: { thinking: { type: 'disabled' as const } },
  },
  thinkingOn: {
    deepseek: { thinking: { type: 'enabled' as const } },
  },
} as const

/**
 * 向量化必须外挂：DeepSeek 没有 embedding / rerank 接口。
 * 第 5 篇启用。维度锁死 1024，写进 pgvector 的列类型后不可改。
 */
export const EMBEDDING_DIM = 1024

export const bailian = createOpenAICompatible({
  name: 'bailian',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY ?? '',
})

export const embedding = bailian.embeddingModel('text-embedding-v4')
