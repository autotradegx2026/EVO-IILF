/** Return zero when the budget cannot fund one lot. Never round risk upward. */
export function calculatePositionSize(
  accountBalance: number, riskPercent: number, entryPrice: number,
  stopLoss: number, lotSize = 1, pointValue = 1
): number {
  if (![accountBalance, riskPercent, entryPrice, stopLoss, lotSize, pointValue]
    .every(v => Number.isFinite(v) && v > 0) || riskPercent > 100 || !Number.isInteger(lotSize)) return 0
  const distance = Math.abs(entryPrice - stopLoss)
  if (distance === 0) return 0
  const quantity = Math.floor((accountBalance * riskPercent / 100) / (distance * pointValue * lotSize)) * lotSize
  return Number.isSafeInteger(quantity) ? quantity : 0
}

/** Cash equities only; derivative lot sizes must come from the instrument master. */
export function getLotSize(symbol: string): number {
  return /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX)$/i.test(symbol) ? 0 : 1
}
