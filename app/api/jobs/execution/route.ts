import { executionDB } from '@/lib/execution/service'
import { runExecutionWorker } from '@/lib/execution/worker'
import { tokenDigest,verifyDeliveryToken } from '@/lib/strategy/delivery'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function POST(request:Request){
  const secret=process.env.EXECUTION_WORKER_SECRET??process.env.CRON_SECRET
  if(!secret||!verifyDeliveryToken(request.headers.get('authorization')??'',tokenDigest(`Bearer ${secret}`)))return Response.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401})
  if(process.env.DEMO_MODE==='true'||process.env.NEXT_PUBLIC_DEMO_MODE==='true')return Response.json({error:'DEMO_READ_ONLY',code:'DEMO_READ_ONLY'},{status:403})
  // Shared Vercel egress is approved here only for Binance testnet recovery.
  // Real environments require the separately hosted worker and registered broker egress.
  try{return Response.json({data:await runExecutionWorker(executionDB(),['testnet'])})}
  catch{return Response.json({error:'EXECUTION_WORKER_FAILED',code:'EXECUTION_WORKER_FAILED'},{status:503})}
}
