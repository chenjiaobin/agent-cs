import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '客服 Agent v0.1',
  description: '从 0 到 1 做一个能收钱的 Agent',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#fff' }}>{children}</body>
    </html>
  )
}
