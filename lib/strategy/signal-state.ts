export function signalFresh(timestamp: string | null | undefined, now = Date.now()) {
  const time = Date.parse(timestamp ?? '')
  return Number.isFinite(time) && now-time <= 300000 && time-now <= 30000
}
export function canonicalSymbol(symbol: string) {
  return /^(NSE|BSE):[A-Z0-9&.-]+$/.test(symbol) && !symbol.endsWith('-EQ') ? `${symbol}-EQ` : symbol
}
