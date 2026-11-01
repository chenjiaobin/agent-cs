'use client'

import { useChat } from '@ai-sdk/react'
import { useState } from 'react'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const { messages, sendMessage, status, stop, error } = useChat()

  const busy = status === 'streaming' || status === 'submitted'

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
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 8px' }}>
        客服 Agent · v0.1
      </h1>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 32px' }}>
        最小闭环：流式对话。还没有落库、没有工具、没有知识库。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((message) => (
          <div key={message.id}>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>
              {message.role === 'user' ? '我' : '客服'}
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
        ))}

        {busy && (
          <div style={{ fontSize: 13, color: '#999' }}>
            正在输入…
            <button
              onClick={() => stop()}
              style={{
                marginLeft: 12,
                fontSize: 12,
                color: '#666',
                background: 'none',
                border: '1px solid #ddd',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
            >
              停止
            </button>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.7 }}>
            出错了：{error.message}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!input.trim() || busy) return
          sendMessage({ text: input })
          setInput('')
        }}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: '#fff',
          borderTop: '1px solid #eee',
          padding: '14px 20px',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="问点什么，比如：我的订单到哪了"
            style={{
              flex: 1,
              fontSize: 15,
              padding: '10px 12px',
              border: '1px solid #ddd',
              borderRadius: 8,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              fontSize: 14,
              padding: '10px 20px',
              border: 'none',
              borderRadius: 8,
              background: busy ? '#ccc' : '#09B83E',
              color: '#fff',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            发送
          </button>
        </div>
      </form>
    </main>
  )
}
