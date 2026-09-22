import { loadEnvConfig } from '@next/env'
import { executionDB } from '../lib/execution/service'
import { runExecutionWorker } from '../lib/execution/worker'
loadEnvConfig(process.cwd())
let stopping=false
process.on('SIGTERM',()=>{stopping=true})
process.on('SIGINT',()=>{stopping=true})
async function main(){
  if(process.env.DEMO_MODE==='true'||process.env.NEXT_PUBLIC_DEMO_MODE==='true')throw new Error('DEMO_WORKER_FORBIDDEN')
  const db=executionDB()
  while(!stopping){
    try{const result=await runExecutionWorker(db);if(result.error||result.processed||result.queued)console.info(JSON.stringify({at:new Date().toISOString(),...result}))}
    catch{console.error('EXECUTION_WORKER_UNAVAILABLE')}
    if(process.argv.includes('--once'))break
    await new Promise(resolve=>setTimeout(resolve,2000))
  }
}
main().catch(()=>{console.error('EXECUTION_WORKER_START_FAILED');process.exitCode=1})
