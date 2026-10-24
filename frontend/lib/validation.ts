import { z } from 'zod'

export const emailSchema = z.string().email('Enter a valid email address.')

export const cryptoTxHashSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'Invalid transaction hash (64 hex characters).')

export const orderCreateSchema = z.object({
  customerName: z.string().min(1, 'Name is required.'),
  customerEmail: z.string().email('Enter a valid email address.'),
  paymentMethod: z.enum(['usdt', 'btc', 'paystack', 'telegram_stars']),
  totalUsd: z.number().positive('Amount must be greater than 0.'),
})

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number in E.164 format (e.g. +254712345678).')

export const otpSchema = z.string().min(4, 'OTP must be at least 4 digits.')

export type EmailInput = z.infer<typeof emailSchema>
export type CryptoTxHashInput = z.infer<typeof cryptoTxHashSchema>
export type OrderCreateInput = z.infer<typeof orderCreateSchema>
