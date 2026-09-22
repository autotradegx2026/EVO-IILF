import { handleWebhook } from '@/lib/webhook/handler'
export const runtime = 'nodejs'
export async function POST(request: Request) { return handleWebhook(request) }
