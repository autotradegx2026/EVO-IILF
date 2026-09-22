# Current broker readiness

Binance Spot testnet was selected as the second broker on 6 September 2026. The implementation and remaining operational acceptance requirements are documented in [Broker automation operations](../BROKER_AUTOMATION.md). The earlier MT5 plan below is retained for reference only.

# Live broker readiness

Reviewed 6 September 2026. Paper trading is operational; real-money execution remains disabled. No real orders were placed during verification.

## MT5 forex

The client must select the broker and provide its exact server and a demo account through secure configuration. The bridge needs an installed, logged-in MT5 terminal on a persistent host. The official Python integration communicates with that terminal; using a separate Windows bridge alongside Vercel is an architectural consequence of this dependency. See [Python integration](https://www.mql5.com/en/docs/python_metatrader5) and [terminal initialization](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py).

External Python trading must be enabled in the [terminal's permissions](https://www.metatrader5.com/en/terminal/help/algotrading/trade_robots_indicators). The adapter must discover the broker's actual symbol names, contract sizes, tick values, volume steps, minimum/maximum lots, stop distances and filling modes from [symbol properties](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfo_py). The app's paper quantities are base units; they cannot be sent as MT5 lots.

Remaining implementation: authenticated bridge protocol, idempotent commands, margin/request checks, execution return-code handling, reconnect recovery and position/order/deal reconciliation. A successful [order check](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py) does not guarantee an [order submission](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py) will execute. Recover actual fills from [deal history](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py). These are engineering requirements inferred from the terminal API, not completed capabilities.

## Angel One India

Angel One requires a registered static IP for API order execution from April 1, 2026. The Vercel deployment alone does not establish this prerequisite. Confirm eligible execution hosting and register its egress address before enabling live orders. See [Angel One's announcement](https://www.angelone.in/news/market-updates/what-s-changing-in-angel-one-s-smartapi-access-from-april-1-2026).

The adapter must persist broker order identifiers, actual filled quantities and prices; recover state from order status, order book and trade book; and handle postbacks or order-status WebSocket updates. See [SmartAPI documentation](https://smartapi.angelone.in/docs). Remaining engineering includes partial-fill protection, uncertain-submit reconciliation before retry, sibling-exit cancellation, session square-off and broker-confirmed final exposure. These requirements follow from asynchronous broker order states and still need broker demo/eligible-environment acceptance.

## Release boundary

Binance USDT scanning uses public spot candles and simulated positions. It does not connect a trading account. India/forex paper monitoring uses TradingView candle alerts, which the user must configure and keep running. Candle-close tests and compilation do not establish broker execution, exact Pine/TypeScript feed parity, execution costs or strategy profitability. See [historical research](RESULTS.md) and [paper deployment acceptance](../PAPER_AUTOMATION.md).
