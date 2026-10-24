import { z } from 'zod'
import { cryptoTxHashSchema } from '@/lib/validation'

export const txHashSchema = cryptoTxHashSchema

export interface TxHashFormProps {
  onSubmit: (hash: string) => void
  loading?: boolean
  error?: string | null
}
