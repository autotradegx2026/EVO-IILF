// lib/brokers/index.ts
import type { BrokerAdapter } from '@/types/trading'
import type { BrokerAccount } from '@/types/database'
import { AngelOneAdapter } from './angelone'

export function getBrokerAdapter(account: BrokerAccount): BrokerAdapter {
  switch (account.broker_name) {
    case 'angelone':
      return new AngelOneAdapter(account)
    case 'zerodha':
      throw new Error('Zerodha adapter — Phase 2. Not yet implemented.')
    case 'upstox':
      throw new Error('Upstox adapter — Phase 2. Not yet implemented.')
    default:
      throw new Error(`Unsupported broker: ${account.broker_name}`)
  }
}

export type { BrokerAdapter }
