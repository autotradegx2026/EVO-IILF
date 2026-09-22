import { StrategyConfigSchema, STRATEGY_VERSION, validateStrategy, type StrategyConfig } from './config'

// Generate both exports from one calculation block so screener and strategy cannot drift.
// This emits Pine source; the hosted TradingView widget cannot execute Pine.
export function generatePine(input: StrategyConfig, kind: 'strategy' | 'indicator'): string {
  const c = StrategyConfigSchema.parse(input)
  const error = validateStrategy(c)
  if (error) throw new Error(error)
  const htf = { '1H': '60', '2H': '120', '4H': '240', '1D': '1D', '1W': '1W' }[c.htfTimeframe]
  const integer = (name: string, value: number, label: string, min: number, max: number) => `${name} = input.int(${value}, "${label}", minval=${min}, maxval=${max})`
  const decimal = (name: string, value: number, label: string, min: number, max: number) => `${name} = input.float(${String(value)}, "${label}", minval=${min}, maxval=${max})`
  const bool = (name: string, value: boolean, label: string) => `${name} = input.bool(${value}, "${label}")`
  // JSON.stringify emits Pine-compatible string literals without another manual
  // escape layer. Dynamic values remain JSON-escaped by the Pine helper below.
  const literal = (value: string) => JSON.stringify(value)
  const configExpressions: Record<keyof StrategyConfig,string> = {
    fastEmaLength:'str.tostring(fastLength)',trendEmaLength:'str.tostring(trendLength)',htfEmaLength:'str.tostring(htfLength)',
    htfTimeframe:'jsonQuote(htfTimeframe == "60" ? "1H" : htfTimeframe == "120" ? "2H" : htfTimeframe == "240" ? "4H" : htfTimeframe)',
    adxLength:'str.tostring(adxLength)',adxThreshold:'str.tostring(adxThreshold)',atrLength:'str.tostring(atrLength)',deltaLength:'str.tostring(deltaLength)',swingLookback:'str.tostring(swingLength)',
    volumeMultiplier:'str.tostring(volumeMultiplier)',atrMultiplier:'str.tostring(atrMultiplier)',minConfluenceScore:'str.tostring(minimumScore)',
    vwapEnabled:'jsonBool(useVWAP)',deltaEnabled:'jsonBool(useDelta)',fvgEnabled:'jsonBool(useFVG)',obEnabled:'jsonBool(useOB)',riskPct:'str.tostring(riskPercent)',rrRatio:'str.tostring(rrRatio)',cooldownBars:'str.tostring(cooldownBars)',
    sessionStart:'jsonQuote(str.substring(sessionHours,0,2) + ":" + str.substring(sessionHours,2,4))',sessionEnd:'jsonQuote(str.substring(sessionHours,5,7) + ":" + str.substring(sessionHours,7,9))',sessionTimezone:'jsonQuote(sessionZone)',
  }
  const configEnvelope=[literal('{'),...Object.entries(configExpressions).flatMap(([key,value],index)=>[literal(`${index?',':''}"${key}":`),value]),literal('}')].join(' + ')
  const entryEnvelope=[literal('{"token":"'),'jsonEscape(deliveryToken)',literal('","symbol":"'),'jsonEscape(ticker)',literal('","action":"'),'(isLong ? "LONG" : "SHORT")',literal('","price":'),'str.tostring(close, format.mintick)',literal(',"sl":'),'str.tostring(sl, format.mintick)',literal(',"tp":'),'str.tostring(tp, format.mintick)',literal(',"rr":'),'str.tostring(rrRatio)',literal(',"confluence":'),'str.tostring(score)',literal(',"tf":"'),'tf',literal('","timestamp":"'),"str.format_time(time_close, \"yyyy-MM-dd'T'HH:mm:ss'Z'\", \"UTC\")",literal(`","strategy_version":"${STRATEGY_VERSION}","strategy_config":`),'strategyConfig()',literal(',"factors":{'),'factors',literal('}}')].join(' + ')
  const barEnvelope = [
    literal('{"kind":"BAR","token":"'), 'jsonEscape(deliveryToken)',
    literal(`","strategy_version":"${STRATEGY_VERSION}","bar":{"symbol":"`), 'jsonEscape(ticker)',
    literal('","tf":"'), 'tf', literal('","time":"'), 'str.format_time(time, "yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", "UTC")',
    literal('","close_time":"'), 'str.format_time(time_close, "yyyy-MM-dd\'T\'HH:mm:ss\'Z\'", "UTC")',
    literal('","open":'), 'str.tostring(open, format.mintick)', literal(',"high":'), 'str.tostring(high, format.mintick)',
    literal(',"low":'), 'str.tostring(low, format.mintick)', literal(',"close":'), 'str.tostring(close, format.mintick)',
    literal('},"entry":'), 'entry', literal('}'),
  ].join(' + ')
  return `//@version=5
// EVO-IILF client PRD implementation. Version: ${STRATEGY_VERSION}
// Disabled factors score zero. ADX and volatility are gates, never points.
// Stops use signal low/high +/- ATR buffer. Cooldown starts at the entry signal.
// Delta is a candle-volume proxy, not bid/ask order flow. Tick volume depends on feed.
// Compile and forward-test in TradingView before use. KPI targets are not guarantees.
${kind === 'strategy' ? 'strategy("AutotradeX Institutional Hybrid PRO", overlay=true, pyramiding=0, initial_capital=100000, calc_on_every_tick=false, process_orders_on_close=true, max_labels_count=200)' : 'indicator("AutotradeX Screener", overlay=true, max_labels_count=200)'}

${integer('trendLength', c.trendEmaLength, 'Trend EMA', 2, 500)}
${integer('fastLength', c.fastEmaLength, 'Fast EMA', 1, 200)}
${integer('htfLength', c.htfEmaLength, 'HTF EMA', 1, 1000)}
// input.string also works in Pine Screener; input.timeframe overrides are ignored there.
htfTimeframe = input.string("${htf}", "HTF timeframe", options=["60", "120", "240", "1D", "1W"])
${integer('adxLength', c.adxLength, 'ADX length and smoothing', 2, 50)}
${decimal('adxThreshold', c.adxThreshold, 'ADX threshold', 0, 100)}
${integer('atrLength', c.atrLength, 'ATR length', 2, 50)}
${integer('deltaLength', c.deltaLength, 'Delta EMA length', 1, 50)}
${integer('swingLength', c.swingLookback, 'Swing lookback', 2, 100)}
${decimal('volumeMultiplier', c.volumeMultiplier, 'Volume multiplier', 0, 10)}
${decimal('atrMultiplier', c.atrMultiplier, 'ATR stop buffer', 0.000001, 10)}
${decimal('rrRatio', c.rrRatio, 'Reward / risk', 0.000001, 20)}
${decimal('riskPercent', c.riskPct, 'Risk percent', 0.000001, 10)}
${integer('minimumScore', c.minConfluenceScore, 'Minimum score', 1, 7)}
${integer('cooldownBars', c.cooldownBars, 'Cooldown bars from entry signal', 0, 100)}
${bool('useVWAP', c.vwapEnabled, 'Score VWAP')}
${bool('useDelta', c.deltaEnabled, 'Score delta')}
${bool('useFVG', c.fvgEnabled, 'Score FVG')}
${bool('useOB', c.obEnabled, 'Score order block')}
sessionHours = input.session("${c.sessionStart.replace(':', '')}-${c.sessionEnd.replace(':', '')}", "Entry session (equal times = all day)")
sessionZone = input.string("${c.sessionTimezone}", "Session and VWAP timezone", options=["Asia/Kolkata", "Etc/UTC", "America/New_York", "Europe/London"])
quantityStep = input.float(1.0, "Quantity step (chart units, not MT5 lots)", minval=0.000001)
${kind === 'indicator' ? 'paperEquity = input.float(100000.0, "Reference equity (symbol currency)", minval=1)' : ''}
// Delivery credential goes in a private alert configuration, never in published source.
deliveryToken = input.string("", "Private delivery token")
deliverySymbol = input.string("", "Execution symbol override (e.g. NSE:RELIANCE-EQ)")
sendPaperBars = input.bool(true, "Send candles for automatic paper exits")
showDashboard = input.bool(true, "Show chart dashboard")
if barstate.isfirst
    if fastLength >= trendLength
        runtime.error("Fast EMA must be shorter than trend EMA")
    if timeframe.in_seconds(htfTimeframe) < timeframe.in_seconds()
        runtime.error("HTF must be at least the chart timeframe")
    if minimumScore > 3 + (useVWAP ? 1 : 0) + (useDelta ? 1 : 0) + (useFVG ? 1 : 0) + (useOB ? 1 : 0)
        runtime.error("Minimum score exceeds the number of enabled factors")

// SMA-seeded EMA is explicit so TypeScript and Pine use the same finite history seed.
seededEMA(float source, int length) =>
    seed = ta.sma(source, length)
    k = 2.0 / (length + 1)
    var float result = na
    result := na(result[1]) ? seed : source * k + result[1] * (1 - k)
    result
trendEMA = seededEMA(close, trendLength)
fastEMA = seededEMA(close, fastLength)
priorHTF = request.security(syminfo.tickerid, htfTimeframe, seededEMA(close, htfLength)[1], lookahead=barmerge.lookahead_on)
htfEMA = timeframe.in_seconds(htfTimeframe) == timeframe.in_seconds() ? seededEMA(close, htfLength) : priorHTF
[plusDI, minusDI, adx] = ta.dmi(adxLength, adxLength)
atr = ta.rma(ta.tr(false), atrLength)
averageATR = ta.sma(atr, 20)
averageVolume = ta.sma(volume, 20)
highVolume = not na(volume) and volume > averageVolume * volumeMultiplier
deltaProxy = seededEMA(close > open ? volume : close < open ? -volume : 0.0, deltaLength)
// Explicit civil-day VWAP anchor, shared with the dashboard engine.
dayKey = year(time, sessionZone) * 10000 + month(time, sessionZone) * 100 + dayofmonth(time, sessionZone)
var float cumulativeVolume = 0.0
var float cumulativePV = 0.0
if na(dayKey[1]) or dayKey != dayKey[1]
    cumulativeVolume := 0.0
    cumulativePV := 0.0
cumulativeVolume += nz(volume)
cumulativePV += hlc3 * nz(volume)
vwap = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : na
priorHigh = ta.highest(high[1], swingLength)
priorLow = ta.lowest(low[1], swingLength)
sellSideSweep = low < priorLow and close > open
buySideSweep = high > priorHigh and close < open
displacementUp = close - open > atr * 0.8
displacementDown = open - close > atr * 0.8
warm = bar_index >= math.max(trendLength - 1, math.max(atrLength + 19, math.max(adxLength * 2 - 1, math.max(swingLength, useDelta ? deltaLength - 1 : 0)))) and not na(htfEMA) and (not useDelta or not na(deltaProxy))
trendUp = warm and close > trendEMA and fastEMA > trendEMA and close > htfEMA
trendDown = warm and close < trendEMA and fastEMA < trendEMA and close < htfEMA
vwapUp = useVWAP and not na(vwap) and close > vwap
vwapDown = useVWAP and not na(vwap) and close < vwap
deltaUp = useDelta and deltaProxy > 0
deltaDown = useDelta and deltaProxy < 0
fvgUp = useFVG and low > high[2] and displacementUp
fvgDown = useFVG and high < low[2] and displacementDown
obUp = useOB and close[1] < open[1] and close > high[1] and displacementUp and highVolume
obDown = useOB and close[1] > open[1] and close < low[1] and displacementDown and highVolume
longScore = (trendUp ? 1 : 0) + (vwapUp ? 1 : 0) + (deltaUp ? 1 : 0) + (highVolume ? 1 : 0) + (sellSideSweep ? 1 : 0) + (fvgUp ? 1 : 0) + (obUp ? 1 : 0)
shortScore = (trendDown ? 1 : 0) + (vwapDown ? 1 : 0) + (deltaDown ? 1 : 0) + (highVolume ? 1 : 0) + (buySideSweep ? 1 : 0) + (fvgDown ? 1 : 0) + (obDown ? 1 : 0)
// Test both bar open and last millisecond before close to exclude bars spanning session end.
startMinute = int(str.tonumber(str.substring(sessionHours, 0, 2))) * 60 + int(str.tonumber(str.substring(sessionHours, 2, 4)))
endMinute = int(str.tonumber(str.substring(sessionHours, 5, 7))) * 60 + int(str.tonumber(str.substring(sessionHours, 7, 9)))
inWindow(int t) =>
    m = hour(t, sessionZone) * 60 + minute(t, sessionZone)
    startMinute == endMinute or (startMinute < endMinute ? m >= startMinute and m < endMinute : m >= startMinute or m < endMinute)
insideSession = inWindow(time) and inWindow(time_close - 1)
var int lastEntryBar = na
cooldownReady = na(lastEntryBar) or bar_index - lastEntryBar >= cooldownBars
longSL = math.floor((low - atr * atrMultiplier) / syminfo.mintick) * syminfo.mintick
shortSL = math.ceil((high + atr * atrMultiplier) / syminfo.mintick) * syminfo.mintick
longRisk = close - longSL
shortRisk = shortSL - close
longTP = math.ceil((close + longRisk * rrRatio) / syminfo.mintick) * syminfo.mintick
shortTP = math.floor((close - shortRisk * rrRatio) / syminfo.mintick) * syminfo.mintick
accountEquity = ${kind === 'strategy' ? 'strategy.equity' : 'paperEquity'}
longQty = longRisk > 0 and syminfo.pointvalue > 0 ? math.floor(accountEquity * riskPercent / 100 / (longRisk * syminfo.pointvalue) / quantityStep) * quantityStep : 0.0
shortQty = shortRisk > 0 and syminfo.pointvalue > 0 ? math.floor(accountEquity * riskPercent / 100 / (shortRisk * syminfo.pointvalue) / quantityStep) * quantityStep : 0.0
gates = warm and barstate.isconfirmed and adx > adxThreshold and atr > averageATR and insideSession and cooldownReady
flat = ${kind === 'strategy' ? 'strategy.position_size == 0' : 'true'}
longSignal = gates and flat and trendUp and longScore >= minimumScore and longSL > 0 and longQty > 0
shortSignal = gates and flat and trendDown and shortScore >= minimumScore and shortTP > 0 and shortQty > 0

jsonBool(bool value) =>
    value ? "true" : "false"
jsonEscape(string value) =>
    str.replace_all(str.replace_all(value, "\\\\", "\\\\\\\\"), "\\\"", "\\\\\\\"")
jsonQuote(string value) =>
    ${literal('\"')} + jsonEscape(value) + ${literal('\"')}
strategyConfig() =>
    ${configEnvelope}
message(bool isLong) =>
    ticker = deliverySymbol == "" ? syminfo.tickerid : deliverySymbol
    tf = timeframe.isweekly ? str.tostring(timeframe.multiplier) + "w" : timeframe.isdaily ? str.tostring(timeframe.multiplier) + "d" : timeframe.isseconds ? str.tostring(timeframe.multiplier) + "s" : str.tostring(timeframe.multiplier) + "m"
    sl = isLong ? longSL : shortSL
    tp = isLong ? longTP : shortTP
    score = isLong ? longScore : shortScore
    factors = "\\\"trend\\\":true,\\\"vwap\\\":" + jsonBool(isLong ? vwapUp : vwapDown) + ",\\\"delta\\\":" + jsonBool(isLong ? deltaUp : deltaDown) + ",\\\"volume\\\":" + jsonBool(highVolume) + ",\\\"sweep\\\":" + jsonBool(isLong ? sellSideSweep : buySideSweep) + ",\\\"fvg\\\":" + jsonBool(isLong ? fvgUp : fvgDown) + ",\\\"ob\\\":" + jsonBool(isLong ? obUp : obDown)
    ${entryEnvelope}

barMessage() =>
    ticker = deliverySymbol == "" ? syminfo.tickerid : deliverySymbol
    tf = timeframe.isweekly ? str.tostring(timeframe.multiplier) + "w" : timeframe.isdaily ? str.tostring(timeframe.multiplier) + "d" : timeframe.isseconds ? str.tostring(timeframe.multiplier) + "s" : str.tostring(timeframe.multiplier) + "m"
    entry = longSignal ? message(true) : shortSignal ? message(false) : "null"
    ${barEnvelope}

if longSignal
    lastEntryBar := bar_index
${kind === 'strategy' ? '    strategy.entry("LONG", strategy.long, qty=longQty, disable_alert=true)\n    strategy.exit("LONG EXIT", "LONG", stop=longSL, limit=longTP, disable_alert=true)' : ''}
    if not sendPaperBars
        alert(message(true), alert.freq_once_per_bar_close)
if shortSignal
    lastEntryBar := bar_index
${kind === 'strategy' ? '    strategy.entry("SHORT", strategy.short, qty=shortQty, disable_alert=true)\n    strategy.exit("SHORT EXIT", "SHORT", stop=shortSL, limit=shortTP, disable_alert=true)' : ''}
    if not sendPaperBars
        alert(message(false), alert.freq_once_per_bar_close)

// Every confirmed bar is needed for exits, including outside the entry session.
// A single envelope carries any entry too, avoiding two competing alert calls.
if sendPaperBars and barstate.isconfirmed and deliveryToken != ""
    alert(barMessage(), alert.freq_once_per_bar_close)

${kind === 'indicator' ? 'alertcondition(longSignal, "LONG ALERT", "AutotradeX long setup. Use Any alert() function call for JSON delivery.")\nalertcondition(shortSignal, "SHORT ALERT", "AutotradeX short setup. Use Any alert() function call for JSON delivery.")' : '// Create alerts for alert() calls only. Broker-emulator fills are not live execution reports.'}
// First plots are the numeric screener columns. 1=long, -1=short, 0=no entry signal.
plot(longSignal ? 1 : shortSignal ? -1 : 0, "Signal", display=display.data_window)
plot(longScore, "Long score", display=display.data_window)
plot(shortScore, "Short score", display=display.data_window)
plot(adx, "ADX", display=display.data_window)
plot(atr, "ATR", display=display.data_window)
plot(trendUp ? 1 : trendDown ? -1 : 0, "Market bias", display=display.data_window)
plot(longSignal ? longSL : shortSignal ? shortSL : na, "Stop loss", display=display.data_window)
plot(longSignal ? longTP : shortSignal ? shortTP : na, "Take profit", display=display.data_window)
plot(cooldownReady ? 1 : 0, "Cooldown ready", display=display.data_window)
plot(volume / averageVolume, "Relative volume", display=display.data_window)
plot(trendEMA, "Trend EMA", color=color.orange)
plot(fastEMA, "Fast EMA", color=color.aqua)
plot(htfEMA, "Confirmed HTF EMA", color=color.purple)
plot(useVWAP ? vwap : na, "VWAP", color=color.yellow)
plotshape(longSignal, title="BUY", text="BUY", style=shape.labelup, location=location.belowbar, color=color.green, textcolor=color.white)
plotshape(shortSignal, title="SELL", text="SELL", style=shape.labeldown, location=location.abovebar, color=color.red, textcolor=color.white)
plotshape(sellSideSweep, title="Sell-side sweep", style=shape.triangleup, location=location.belowbar, color=color.lime, size=size.tiny)
plotshape(buySideSweep, title="Buy-side sweep", style=shape.triangledown, location=location.abovebar, color=color.orange, size=size.tiny)
bgcolor(trendUp ? color.new(color.green, 92) : trendDown ? color.new(color.red, 92) : na)
var table panel = table.new(position.top_right, 2, 12, bgcolor=color.new(color.black, 15), border_width=1)
row(int index, string title, string value) =>
    table.cell(panel, 0, index, title, text_color=color.silver)
    table.cell(panel, 1, index, value, text_color=color.white)
if barstate.islast and showDashboard
    row(0, "AutotradeX", "${STRATEGY_VERSION}")
    row(1, "Trend", trendUp ? "Bullish" : trendDown ? "Bearish" : "Neutral")
    row(2, "VWAP", not useVWAP ? "Disabled" : na(vwap) ? "Unavailable" : close > vwap ? "Above" : "Below")
    row(3, "Delta proxy", not useDelta ? "Disabled" : deltaProxy > 0 ? "Bullish" : "Bearish")
    row(4, "Volume", highVolume ? "High" : "Normal / unavailable")
    row(5, "Market regime", adx > adxThreshold ? "Trending" : "Ranging")
    row(6, "Sweep", sellSideSweep ? "Sell side" : buySideSweep ? "Buy side" : "None")
    row(7, "FVG", not useFVG ? "Disabled" : fvgUp ? "Bullish" : fvgDown ? "Bearish" : "None")
    row(8, "Order block", not useOB ? "Disabled" : obUp ? "Bullish" : obDown ? "Bearish" : "None")
    row(9, "ADX / ATR", str.tostring(adx, "#.##") + " / " + str.tostring(atr, format.mintick))
    row(10, "Market bias", trendUp ? "LONG" : trendDown ? "SHORT" : "NEUTRAL")
    row(11, "Long / short score", str.tostring(longScore) + " / " + str.tostring(shortScore))
`
}
