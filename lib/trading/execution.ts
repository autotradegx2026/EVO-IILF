import { executionDB,queueExecution } from '../execution/service'
import type { ExecutionResult } from '../../types/trading'

// Manual confirmation and automatic dispatch reserve the same durable execution ledger.
export async function executeTrade(signalId:string,brokerAccountId:string,userId:string):Promise<ExecutionResult>{
  try{
    const execution=await queueExecution(executionDB(),userId,signalId,brokerAccountId,false)
    return {success:true,tradeId:execution.id}
  }catch(e){
    return {success:false,error:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'EXECUTION_QUEUE_FAILED'}
  }
}
