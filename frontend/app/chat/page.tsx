'use client'

export const dynamic = 'force-dynamic'

import Shell from '@/components/layout/Shell'
import { ChatFeed } from '@/components/chat/ChatFeed'
import { CallbackRequestForm } from '@/components/chat/CallbackRequestForm'

export default function ChatPage() {
  return (
    <Shell>
      <div className="max-w-4xl mx-auto py-8">
        <h2 className="text-3xl font-bold text-cyber-text mb-6">DTD Store Chat</h2>
        <p className="text-cyber-muted mb-6">Live chat feed mirrored with Telegram auth. Request phone/video callbacks.</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ChatFeed />
          </div>
          <div className="flex flex-col">
            <CallbackRequestForm />
          </div>
        </div>
      </div>
    </Shell>
  )
}
