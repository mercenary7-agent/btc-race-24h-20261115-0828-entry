// btc-race-24h-20261115-0828 entry v2: mean-reversion scalper on CBBTC.
// Buys when the close falls DEV_BPS below the K-bar SMA, sells at +TP_BPS
// vs the actual fill price or after MAX_HOLD bars. TP lowered 200->80 bps
// after walk-forward robustness sweep over 9 x 24h windows (BTC-USD proxy
// 11-11..11-15 + kit dev window): v2 never loses on any window (worst 0)
// while v1 lost on 2; mean window PnL 5.2 vs 3.7 USDC.
import { BPS, runBars } from './vendor/makefun-bars.ts';

const K = 60;
const DEV_BPS = 150;
const TP_BPS = 80;
const SL_BPS = 10_000;
const MAX_HOLD = 96;
const MAX_SLIPPAGE_BPS = 10_000;

const closes: bigint[] = [];
let heldBars = 0;
let entryPrice = 0n;

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    for (const f of batch.fills) {
      if (f.symbol === state.hello.symbols[0].symbol && f.status === 'filled' && f.side === 'buy') {
        entryPrice = BigInt(f.price);
        heldBars = 0;
      }
    }
    const sym = state.hello.symbols[0].symbol;
    const c = state.close(sym);
    if (c === null) return [];
    closes.push(c);
    if (closes.length > K) closes.shift();

    const pos = state.positions.get(sym);
    if (pos && pos.qty > 0n) {
      heldBars++;
      if (entryPrice > 0n &&
          (c * BPS >= entryPrice * (BPS + BigInt(TP_BPS)) ||
           c * BPS <= entryPrice * (BPS - BigInt(SL_BPS)) ||
           heldBars >= MAX_HOLD)) {
        return [{ side: 'sell', symbol: sym, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (closes.length < K) return [];
    let sum = 0n;
    for (const x of closes) sum += x;
    const sma = sum / BigInt(closes.length);
    if (c * BPS <= sma * (BPS - BigInt(DEV_BPS))) {
      const { caps, fees } = state.hello;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      const slice = state.cash < byWeight ? state.cash : byWeight;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
      return [{ side: 'buy', symbol: sym, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
