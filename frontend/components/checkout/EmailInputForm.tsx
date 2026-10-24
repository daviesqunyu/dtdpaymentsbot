import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { emailSchema } from '@/lib/validation'

export function EmailInputForm({ onSubmit }: { onSubmit: (email: string) => void }) {
  const form = useForm<{ email: string }>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })

  const handleSubmit = (values: { email: string }) => {
    onSubmit(values.email.toLowerCase().trim())
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-3">
      <div className="relative">
        <input
          {...form.register('email')}
          type="email"
          placeholder="you@example.com"
          className="w-full px-4 py-3 rounded-lg border border-cyber-border bg-cyber-surface text-cyber-text focus:border-cyber-neon focus:outline-none transition-colors"
        />
        {form.formState.errors.email && (
          <p className="absolute bottom-8 left-0 text-xs text-cyber-neonRed">{form.formState.errors.email.message}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={!form.formState.isValid}
        className="w-full px-4 py-3 rounded-lg bg-cyber-neon text-cyber-bg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Continue
      </button>
    </form>
  )
}
