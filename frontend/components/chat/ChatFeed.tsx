'use client'

import { useState } from 'react'
import { Send, Phone, Video } from 'lucide-react'
import { api } from '@/lib/api'

export function ChatFeed() {
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<any[]>([])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    try {
      await api.sendChatMessage({ message, contact: contact || undefined })
      setMessages((prev) => [...prev, { message, contact, type: 'sent' }])
      setMessage('')
    } catch {
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-cyber-surface border border-cyber-border rounded-xl">
      <div className="h-96 overflow-y-auto border-b border-cyber-border p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-cyber-muted text-sm">No messages yet. Start the conversation.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.type === 'sent' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg ${m.type === 'sent' ? 'bg-cyber-neon/10 text-cyber-neon border border-cyber-neon/30 ml-auto' : 'bg-cyber-card text-cyber-text border border-cyber-border'}`}>
              <p className="text-sm">{m.message}</p>
              {m.contact && <p className="text-[10px] text-cyber-muted mt-1">{m.contact}</p>}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message…"
            className="px-4 py-3 rounded-lg border border-cyber-border bg-cyber-surface text-cyber-text focus:border-cyber-neon focus:outline-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Phone or Telegram @"
            className="px-4 py-3 rounded-lg border border-cyber-border bg-cyber-surface text-cyber-text focus:border-cyber-neon focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {sending ? (
            <span className="flex items-center gap-1">
              <Loader2 size={14} className="animate-spin" />
              Sending…
            </span>
          ) : (
            <>
              <Send size={16} className="mr-1" />
              Send
            </>
          )}
        </button>
        <div className="flex gap-2 text-[10px] text-cyber-muted">
          <button type="button" className="flex items-center gap-1 text-cyber-neon">
            <Phone size={12} /> Request call
          </button>
          <button type="button" className="flex items-center gap-1 text-cyber-neon">
            <Video size={12} /> Video call
          </button>
        </div>
      </form>
    </div>
  )
}

import { Loader2 } from 'lucide-react'
