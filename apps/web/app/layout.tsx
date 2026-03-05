import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Code Review | AI Assistant',
  description: 'Local AI-powered code review',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
