'use client'

import { DefaultChatTransport, type UIMessage } from 'ai'
import { useChat } from '@ai-sdk/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * v0.2（第 2 篇）：会话落库 + 断流 + 多标签页同步
 *
 * 三个「看起来很简单」的问题，各对应一处代码：
 *   坑② 刷新丢消息  → 会话 id 持久化到 URL + localStorage，挂载前先拉历史
 *   坑③ 多标签页串  → 同一个会话 id 用 BroadcastChannel 广播变更，收到就重拉
 *   坑① 断流卡死    → 15 秒没有任何新内容就提示「可能中断」，给一个重载按钮
 */

const STORAGE_KEY = 'agent-cs:conversation-id'
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

async function fetchHistory(conversationId: string): Promise<UIMessage[]> {
  const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
  if (!res.ok) throw new Error(`读取历史失败：HTTP ${res.status}`)
  const data = (await res.json()) as { messages: UIMessage[] }
  return data.messages
}

export default function ChatPage() {
  const [session, setSession] = useState<{
    conversationId: string
    initialMessages: UIMessage[]
  } | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    // 会话 id 优先取 URL 上的 ?c=，这样把地址复制到另一个标签页
    // 就是同一个会话，而不是两个各聊各的。
    const fromUrl = new URLSearchParams(window.location.search).get('c')
    let id = fromUrl && ID_RE.test(fromUrl) ? fromUrl : ''
    if (!id) {
      id = localStorage.getItem(STORAGE_KEY) || `c_${crypto.randomUUID()}`
    }
    localStorage.setItem(STORAGE_KEY, id)

    const url = new URL(window.location.href)
    url.searchParams.set('c', id)
    window.history.replaceState(null, '', url)

    // 先拉完历史再挂载 useChat。
    // 因为 useChat 的 messages 是初始值，异步回来再塞会不生效。
    fetchHistory(id)
      .then((initialMessages) => setSession({ conversationId: id, initialMessages }))
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  if (loadError) {
    return <Shell><p style={{ color: '#c0392b' }}>{loadError}</p></Shell>
  }
  if (!session) {
    return <Shell><p style={{ color: '#888', fontSize: 14 }}>正在读取会话…</p></Shell>
  }

  return (
    <ChatRoom
      key={session.conversationId}
      conversationId={session.conversationId}
      initialMessages={session.initialMessages}
    />
  )
}

function ChatRoom({
  conversationId,
  initialMessages,
}: {
  conversationId: string
  initialMessages: UIMessage[]
}) {
  const [input, setInput] = useState('')
  const [stalled, setStalled] = useState(false)
  const [notice, setNotice] = useState('')

  // 每个标签页一个身份，广播时用来忽略自己发的那条。
  const senderId = useRef(`tab_${crypto.randomUUID()}`)
  const statusRef = useRef<string>('ready')
  const channelRef = useRef<BroadcastChannel | null>(null)

  // transport 只建一次。每次渲染都 new 会让 useChat 以为换了通道。
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { conversationId } }),
    [conversationId]
  )

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    clearError,
  } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onError: (e) => {
      // useChat 的 error 只会显示一行红字，用户不知道能做什么。
      // 这里把它翻译成一个有动作的提示。
      setNotice(`连接中断：${e.message}。可以点「重新加载」取回已经生成的内容。`)
    },
    onFinish: () => {
      // 一轮结束（含被中止）就通知其他标签页来同步。
      // 不广播完整消息内容，避免两个标签页各写一份造成冲突——
      // 让它们统一从数据库读，数据库才是唯一的事实来源。
      channelRef.current?.postMessage({ conversationId, senderId: senderId.current })
    },
  })

  statusRef.current = status

  useEffect(() => {
    const channel = new BroadcastChannel('agent-cs-chat')
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { conversationId?: string; senderId?: string }
      if (data?.conversationId !== conversationId) return
      if (data?.senderId === senderId.current) return
      // 自己正在流式输出时不要覆盖，等这一轮结束由自己的 onFinish 收口。
      if (statusRef.current !== 'ready') return
      fetchHistory(conversationId).then(setMessages).catch(() => {})
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [conversationId, setMessages])

  // 断流检测：SSE 被中间层悄悄掐断时，既没有 error 也没有 finish，
  // status 会一直停在 streaming，界面永远是「正在输入…」。
  // 用「最后一次内容变化的时间」做心跳，比猜网络状态可靠。
  const lastLenRef = useRef(0)
  const lastChangeAtRef = useRef(Date.now())
  useEffect(() => {
    const len = JSON.stringify(messages).length
    if (len !== lastLenRef.current) {
      lastLenRef.current = len
      lastChangeAtRef.current = Date.now()
      setStalled(false)
    }
  }, [messages])

  useEffect(() => {
    if (status !== 'streaming') {
      setStalled(false)
      return
    }
    const timer = setInterval(() => {
      if (Date.now() - lastChangeAtRef.current > 15_000) setStalled(true)
    }, 2_000)
    return () => clearInterval(timer)
  }, [status])

  const busy = status === 'streaming' || status === 'submitted'

  async function reload() {
    try {
      const fresh = await fetchHistory(conversationId)
      setMessages(fresh)
      setNotice('')
      setStalled(false)
      clearError()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 8px' }}>
        客服 Agent · v0.2
      </h1>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 32px' }}>
        消息已落库 · 刷新不丢 · 会话 <code>{conversationId}</code>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((message) => {
          const meta = message.metadata as { status?: string } | undefined
          return (
            <div key={message.id}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>
                {message.role === 'user' ? '我' : '客服'}
                {meta?.status === 'aborted' && (
                  <span style={{ color: '#C2601C', marginLeft: 8 }}>
                    · 上次回答中断，只保留了已生成的部分
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  background: message.role === 'user' ? '#F5F6F7' : 'transparent',
                  padding: message.role === 'user' ? '12px 14px' : 0,
                  borderRadius: 8,
                }}
              >
                {message.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null
                )}
              </div>
            </div>
          )
        })}

        {busy && !stalled && (
          <div style={{ fontSize: 13, color: '#999' }}>
            正在输入…
            <button onClick={() => stop()} style={btnStyle}>停止</button>
          </div>
        )}

        {(stalled || notice || error) && (
          <div
            style={{
              fontSize: 13,
              color: '#8A5A20',
              background: '#FDF6EA',
              border: '1px solid #F0DCC0',
              borderRadius: 6,
              padding: '10px 12px',
              lineHeight: 1.7,
            }}
          >
            {stalled ? '超过 15 秒没有新内容，连接可能已经断了。' : notice || error?.message}
            <button onClick={reload} style={{ ...btnStyle, marginLeft: 8 }}>
              重新加载
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!input.trim() || busy) return
          setNotice('')
          sendMessage({ text: input })
          setInput('')
        }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: '#fff', borderTop: '1px solid #eee', padding: '14px 20px',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="问点什么，比如：我的订单到哪了"
            style={{
              flex: 1, fontSize: 15, padding: '10px 12px',
              border: '1px solid #ddd', borderRadius: 8, outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              fontSize: 14, padding: '10px 20px', border: 'none',
              borderRadius: 8, background: busy ? '#ccc' : '#0E7C4A',
              color: '#fff', cursor: busy ? 'default' : 'pointer',
            }}
          >
            发送
          </button>
        </div>
      </form>
    </Shell>
  )
}

const btnStyle: CSSProperties = {
  marginLeft: 12,
  fontSize: 12,
  color: '#666',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '40px 20px 140px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif',
        color: '#222',
      }}
    >
      {children}
    </main>
  )
}
