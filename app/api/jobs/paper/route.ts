import { createServiceClient } from '@/lib/supabase/server'
import { tokenDigest, verifyDeliveryToken } from '@/lib/strategy/delivery'
import { runPaperWorker } from '@/lib/paper/worker'
export const runtime='nodejs'
export const maxDuration=60
export const dynamic='force-dynamic'
export async function POST(request: Request) {
  const fail=(code:string,status:number)=>Response.json({error:code,code},{status})
  const secret=process.env.CRON_SECRET
  if (!secret) return fail('CRON_NOT_CONFIGURED',503)
  if (!verifyDeliveryToken(request.headers.get('authorization')??'',tokenDigest(`Bearer ${secret}`))) return fail('UNAUTHORIZED',401)
  if (process.env.DEMO_MODE==='true'||process.env.NEXT_PUBLIC_DEMO_MODE==='true') return fail('DEMO_READ_ONLY',403)
  try { const data=await runPaperWorker(createServiceClient()); return Response.json({data},{status:data.status==='FAILED'?503:200}) }
  catch { return fail('PAPER_WORKER_FAILED',503) }
}
export const GET=POST
