import { localParts } from '../strategy/config'

export function marketDayStart(now = new Date(), timezone = 'Asia/Kolkata'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const day = (time: number) => {
    const parts = formatter.formatToParts(time)
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-')
  }
  const currentTime = now.getTime()
  const currentDay = day(currentTime)
  // Find the first instant of this civil day. Using today's current offset would
  // be wrong on DST transition days; some zones also skip or repeat midnight.
  let lower = currentTime - 72 * 3_600_000, upper = currentTime
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2)
    if (day(middle) < currentDay) lower = middle
    else upper = middle
  }
  return new Date(upper).toISOString()
}

export function isWithinSession(now: Date, start: string, end: string, timezone = 'Asia/Kolkata'): boolean {
  const clock = localParts(now.getTime(), timezone).clock
  const first = start.slice(0, 5), last = end.slice(0, 5)
  return first === last || (first < last ? clock >= first && clock < last : clock >= first || clock < last)
}

export function timeframeMilliseconds(timeframe = '1m'): number {
  const match = /^(\d+)(s|m|h|d|w)?$/i.exec(timeframe)
  if (!match || Number(match[1]) <= 0) return 0
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return Number(match[1]) * units[(match[2] ?? 'm').toLowerCase()]
}
