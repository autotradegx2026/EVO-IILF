declare module 'smartapi-javascript' {
  export class SmartAPI {
    constructor(config: { api_key: string })
    generateSession(clientCode: string, password: string, totp: string): Promise<{
      status: boolean
      message: string
      data?: { jwtToken: string; refreshToken: string; feedToken: string }
    }>
    getRMS(): Promise<{ status: boolean; data?: { net: string } }>
    placeOrder(params: Record<string, string>): Promise<{
      status: boolean
      message: string
      data?: { orderid: string }
    }>
    cancelOrder(params: { variety: 'NORMAL' | 'STOPLOSS'; orderid: string }): Promise<{ status: boolean }>
    getOrderBook(): Promise<{
      status: boolean
      data?: Array<{
        orderid: string
        status: string
        orderstatus?: string
        filledshares?: string | number
        averageprice?: string | number
      }> | null
    }>
    getPosition(): Promise<{
      status: boolean
      data?: Array<{
        tradingsymbol: string
        exchange: string
        netqty: string
        averageprice: string
        ltp: string
        unrealisedpnl: string
        producttype: string
      }> | null
    }>
    // The SDK unwraps successful search results, but also returns caught errors.
    searchScrip(params: { exchange: string; searchscrip: string }): Promise<unknown>
    setAccessToken(token: string): void
  }
}
