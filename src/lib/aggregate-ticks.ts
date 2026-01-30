/**
 * Aggregates ticks into candlestick bars for lightweight-charts.
 * M5 = 5-minute bars (bar time floor to 300 seconds).
 */

import type { ForexTick } from "./mock-forex-stream";

const M5_PERIOD_SECONDS = 300;

export type OhlcBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type BarState = {
  barTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Returns an aggregator that maintains the current 5-minute bar state.
 * Call applyTick(tick) on each tick; returns the bar to pass to series.update().
 */
export function createM5Aggregator(): {
  applyTick: (tick: ForexTick) => OhlcBar;
} {
  let state: BarState | null = null;

  function applyTick(tick: ForexTick): OhlcBar {
    const barTime =
      Math.floor(tick.time / M5_PERIOD_SECONDS) * M5_PERIOD_SECONDS;

    if (state === null || barTime > state.barTime) {
      state = {
        barTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      };
    } else {
      state.high = Math.max(state.high, tick.price);
      state.low = Math.min(state.low, tick.price);
      state.close = tick.price;
    }

    return {
      time: state.barTime,
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
    };
  }

  return { applyTick };
}
