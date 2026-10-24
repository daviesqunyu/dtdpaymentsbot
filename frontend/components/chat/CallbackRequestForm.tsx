'use client'

import { useState } from 'react'
import { Calendar, Smartphone, Send, Mail } from 'lucide-react'

export function CallbackRequestForm() {
  const [name, setName] = useState('')
  const [method, setMethod] = useState<'phone' | 'telegram' | 'email'>('phone')
  const [contact, setContact] = useState('')
  const [topic, setTopic] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      // POST to /api/callback-requests (implement on backend)
      await fetch('/api/callback-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, contactMethod: method, contact, topic, scheduledTime: scheduled }),
      })
      setSuccess(true)
    } catch {
      alert('Failed to request callback')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="bg-cyber-neonGreen/10 border border-cyber-neonGreen rounded-xl p-6 text-center">
        <Send size={32} className="mx-auto mb-3 text-cyber-neonGreen" />
        <h3 className="text-lg font-bold text-cyber-neonGreen">Callback requested</h3>
        <p className="text-cyber-text">We'll contact you shortly via {method}.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-cyber-card border border-cyber-border rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-bold text-cyber-text">Request a Call</h3>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as any)}
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
        >
          <option value="phone">Phone</option>
          <option value="telegram">Telegram</option>
          <option value="email">Email</option>
        </select>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Contact number / @username / email"
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
        />
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional)"
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
        />
        <input
          type="datetime-local"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
          className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting ? (
          <span className="flex items-center gap-1">Requesting…</span>
        ) : (
          <>
            <Send size={16} className="mr-1" />
            Request Callback
          </>
        )}
      </button>
    </form>
  )
}
