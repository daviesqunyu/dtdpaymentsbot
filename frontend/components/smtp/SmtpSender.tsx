'use client'

import { useState } from 'react'
import { Mail, Smartphone, Clock } from 'lucide-react'
import { api } from '@/lib/api'

export function SmtpSender() {
  const [tab, setTab] = useState<'email' | 'sms' | 'otp'>('email')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [gwUser, setGwUser] = useState('')
  const [gwPass, setGwPass] = useState('')
  const [gwUrl, setGwUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    setResult(null)
    try {
      if (tab === 'email') {
        await api.smtpSendEmail({ to: [to], subject, text })
        setResult(`Email queued to ${to}`)
      } else if (tab === 'sms') {
        await api.smtpSendSms({ to: [to], text, gwUser, gwPass, gwUrl })
        setResult(`SMS queued to ${to}`)
      } else {
        await api.smtpOtp({ action: 'listen', gwUser, gwPass, gwUrl, phones: [to] })
        setResult('OTP listener started')
      }
    } catch (err: any) {
      setError(err.message || 'Send failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-cyber-card border border-cyber-border rounded-xl p-6 space-y-4">
      <div className="flex gap-2">
        {(['email', 'sms', 'otp'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded border text-sm transition-colors ${tab === t ? 'bg-cyber-neon text-cyber-bg border-cyber-neon' : 'border-cyber-border text-cyber-text hover:bg-cyber-card'}`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      <form onSubmit={handleSend} className="space-y-3">
        {tab === 'email' && (
          <>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To email address"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message body"
              rows={4}
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text font-mono text-xs"
            />
          </>
        )}
        {tab === 'sms' && (
          <>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Phone number (+254...)"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              value={gwUser}
              onChange={(e) => setGwUser(e.target.value)}
              placeholder="SMSGate username"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              type="password"
              value={gwPass}
              onChange={(e) => setGwPass(e.target.value)}
              placeholder="SMSGate password"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              value={gwUrl}
              onChange={(e) => setGwUrl(e.target.value)}
              placeholder="Gateway URL"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="SMS message"
              rows={3}
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text font-mono text-xs"
            />
          </>
        )}
        {tab === 'otp' && (
          <>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Phone to watch for OTPs"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              value={gwUser}
              onChange={(e) => setGwUser(e.target.value)}
              placeholder="SMSGate username"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
            <input
              type="password"
              value={gwPass}
              onChange={(e) => setGwPass(e.target.value)}
              placeholder="SMSGate password"
              className="w-full px-3 py-2 rounded border border-cyber-border bg-cyber-surface text-cyber-text"
            />
          </>
        )}
        <button
          type="submit"
          disabled={sending}
          className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {sending ? <span className="flex items-center gap-1">Sending…</span> : tab === 'email' ? <><Mail size={16} className="mr-1" /> Send Email</> : tab === 'sms' ? <><Smartphone size={16} className="mr-1" /> Send SMS</> : <><Clock size={16} className="mr-1" /> Start OTP Listener</>}
        </button>
        {result && <p className="text-xs text-cyber-neonGreen">{result}</p>}
        {error && <p className="text-xs text-cyber-neonRed">{error}</p>}
      </form>
    </div>
  )
}
