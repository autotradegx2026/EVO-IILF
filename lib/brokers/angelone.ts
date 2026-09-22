import { decrypt } from '@/lib/crypto'
import type { SmartAPI } from 'smartapi-javascript'
import type { BrokerAdapter, BrokerOrder, OrderRequest, OrderResponse, BrokerPosition, OrderStatus } from '@/types/trading'
import type { BrokerAccount } from '@/types/database'

function numeric(value: string | number | undefined, field: string): number {
  if (value === undefined || value === '') throw new Error(`Broker response missing ${field}`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Broker response has invalid ${field}`)
  return parsed
}

function orderStatus(status: string): OrderStatus {
  switch (status.toUpperCase()) {
    case 'COMPLETE': return 'COMPLETE'
    case 'CANCELLED': return 'CANCELLED'
    case 'REJECTED': return 'REJECTED'
    case 'OPEN': return 'OPEN'
    case 'PENDING':
    case 'TRIGGER PENDING':
    case 'VALIDATION PENDING':
    case 'PUT ORDER REQ RECEIVED':
    case 'MODIFY PENDING':
    case 'CANCEL PENDING': return 'PENDING'
    default: return 'UNKNOWN'
  }
}

export class AngelOneAdapter implements BrokerAdapter {
  private client: SmartAPI | null = null
  private connecting: Promise<boolean> | null = null

  constructor(private account: BrokerAccount) {}

  async connect(): Promise<boolean> {
    if (this.client) return true
    if (this.connecting) return this.connecting
    this.connecting = this.createSession()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async createSession(): Promise<boolean> {
    try {
      const apiKey = decrypt(this.account.api_key_encrypted)
      const password = decrypt(this.account.api_secret_encrypted)
      const secret = this.account.access_token_encrypted
        ? decrypt(this.account.access_token_encrypted) : ''
      const clientCode = this.account.client_id ?? ''
      if (!apiKey || !password || !secret || !clientCode) return false
      const { SmartAPI } = await import('smartapi-javascript')
      const { TOTP } = await import('otpauth')
      const client = new SmartAPI({ api_key: apiKey })
      const session = await client.generateSession(clientCode, password, new TOTP({ secret }).generate())
      if (!session?.status || !session.data?.jwtToken) return false
      client.setAccessToken(session.data.jwtToken)
      this.client = client
      return true
    } catch {
      // SDK exceptions may contain credentials or authentication headers.
      return false
    }
  }

  private async connectedClient(): Promise<SmartAPI> {
    if (!(await this.connect()) || !this.client) throw new Error('Broker authentication failed')
    return this.client
  }

  async getBalance(): Promise<number> {
    const client = await this.connectedClient()
    const result = await client.getRMS()
    if (!result?.status || !result.data) throw new Error('Unable to retrieve broker balance')
    return numeric(result.data.net, 'balance')
  }

  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    let client: SmartAPI
    let params: Record<string, string>
    try {
      if (order.exchange !== 'NSE' && order.exchange !== 'BSE') {
        throw new Error('Only NSE and BSE cash equity orders are supported')
      }
      if (order.productType !== 'INTRADAY' && order.productType !== 'DELIVERY') {
        throw new Error('Only INTRADAY and DELIVERY products are supported')
      }
      if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) throw new Error('Invalid order quantity')
      if (!['BUY', 'SELL'].includes(order.transactionType)) throw new Error('Invalid transaction type')
      if (!['MARKET', 'LIMIT', 'SL', 'SL-M'].includes(order.orderType)) throw new Error('Unsupported order type')
      if ((order.orderType === 'LIMIT' || order.orderType === 'SL') && !(Number.isFinite(order.price) && order.price! > 0)) {
        throw new Error('A positive limit price is required')
      }
      if ((order.orderType === 'SL' || order.orderType === 'SL-M') && !(Number.isFinite(order.triggerPrice) && order.triggerPrice! > 0)) {
        throw new Error('A positive trigger price is required')
      }
      client = await this.connectedClient()
      const instrument = await this.getInstrument(client, order.symbol, order.exchange)
      params = {
        variety: order.orderType === 'SL' || order.orderType === 'SL-M' ? 'STOPLOSS' : 'NORMAL',
        tradingsymbol: instrument.tradingsymbol,
        symboltoken: instrument.symboltoken,
        transactiontype: order.transactionType,
        exchange: order.exchange,
        ordertype: order.orderType === 'SL' ? 'STOPLOSS_LIMIT' : order.orderType === 'SL-M' ? 'STOPLOSS_MARKET' : order.orderType,
        producttype: order.productType,
        duration: 'DAY',
        price: (order.price ?? 0).toString(),
        triggerprice: (order.triggerPrice ?? 0).toString(),
        quantity: order.quantity.toString(),
        squareoff: '0',
        stoploss: '0',
      }
    } catch {
      return { orderId: '', status: 'FAILED', message: 'Order validation, authentication, or exact cash equity lookup failed; no order submitted' }
    }

    try {
      const result = await client.placeOrder(params)
      if (result?.status === true && result.data?.orderid) {
        return { orderId: result.data.orderid, status: 'SUCCESS', message: 'Order accepted; execution must be confirmed' }
      }
      if (result?.status === false) {
        return { orderId: '', status: 'FAILED', message: 'Broker rejected order submission' }
      }
      return { orderId: '', status: 'PENDING', message: 'Broker returned an inconclusive response; reconcile before retrying' }
    } catch {
      // A timeout does not establish whether the broker accepted the order.
      return { orderId: '', status: 'PENDING', message: 'Order submission outcome unknown; reconcile before retrying' }
    }
  }

  async cancelOrder(orderId: string, variety: 'NORMAL' | 'STOPLOSS' = 'NORMAL'): Promise<boolean> {
    if (!orderId) return false
    try {
      const client = await this.connectedClient()
      const result = await client.cancelOrder({ variety, orderid: orderId })
      return result?.status === true
    } catch {
      return false
    }
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const client = await this.connectedClient()
    const result = await client.getOrderBook()
    if (!result?.status || !Array.isArray(result.data)) throw new Error('Unable to retrieve broker order book')
    const order = result.data.find(item => item.orderid === orderId)
    if (!order) throw new Error('Order not found in broker order book')
    const filledQuantity = numeric(order.filledshares, 'filled quantity')
    if (!Number.isSafeInteger(filledQuantity) || filledQuantity < 0) throw new Error('Invalid broker filled quantity')
    const price = order.averageprice === undefined || order.averageprice === '' ? null : numeric(order.averageprice, 'average price')
    return {
      orderId,
      status: orderStatus(order.orderstatus || order.status || ''),
      filledQuantity,
      averagePrice: price !== null && price > 0 ? price : null,
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    try {
      return (await this.getOrder(orderId)).status
    } catch {
      return 'UNKNOWN'
    }
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const client = await this.connectedClient()
    const result = await client.getPosition()
    if (!result?.status) throw new Error('Unable to retrieve broker positions')
    if (result.data === null) return []
    if (!Array.isArray(result.data)) throw new Error('Invalid broker positions response')
    return result.data.flatMap(position => {
      const quantity = numeric(position.netqty, 'position quantity')
      if (!Number.isSafeInteger(quantity)) throw new Error('Invalid broker position quantity')
      if (quantity === 0) return []
      return [{
        symbol: position.tradingsymbol,
        exchange: position.exchange,
        quantity: Math.abs(quantity),
        averagePrice: numeric(position.averageprice, 'position average price'),
        currentPrice: numeric(position.ltp, 'position current price'),
        unrealizedPnl: numeric(position.unrealisedpnl, 'position unrealized P&L'),
        productType: position.producttype,
        direction: quantity > 0 ? 'LONG' as const : 'SHORT' as const,
      }]
    })
  }

  async closePosition(
    symbol: string,
    exchange: import('@/types/trading').ExchangeType,
    quantity: number,
    direction: 'LONG' | 'SHORT'
  ): Promise<boolean> {
    const result = await this.placeOrder({
      symbol,
      exchange,
      transactionType: direction === 'LONG' ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      productType: 'INTRADAY',
      quantity,
    })
    return result.status === 'SUCCESS'
  }

  private async getInstrument(client: SmartAPI, symbol: string, exchange: string): Promise<{ tradingsymbol: string; symboltoken: string }> {
    const normalized = symbol.trim().toUpperCase()
    if (!/^[A-Z0-9&-]+$/.test(normalized)) throw new Error('Invalid cash equity symbol')
    const tradingSymbol = normalized.endsWith('-EQ') ? normalized : `${normalized}-EQ`
    // The installed SDK returns the array directly on success and an error value on failure.
    const result = await client.searchScrip({ exchange, searchscrip: tradingSymbol })
    if (!Array.isArray(result)) throw new Error('Instrument search failed')
    const matches = result.filter((item: unknown): item is { tradingsymbol: string; symboltoken: string; exchange: string } => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Record<string, unknown>
      return candidate.exchange === exchange && candidate.tradingsymbol === tradingSymbol
        && typeof candidate.symboltoken === 'string' && /^\d+$/.test(candidate.symboltoken) && Number(candidate.symboltoken) > 0
    })
    if (matches.length !== 1) throw new Error('Instrument search must return exactly one matching cash equity')
    return matches[0]
  }
}
