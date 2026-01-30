/**
 * Mock forex price stream: emits ticks in EURUSD-style range for live chart updates.
 * No React or chart code—pure generator/subscription.
 * EURUSD: 5 decimal places, 1 pip = 0.0001, realistic per-tick and per-candle movement.
 */

export type ForexTick = { time: number; price: number };

/** EURUSD quote precision (5 decimal places, e.g. 1.08543). */
export const EURUSD_PRECISION = 5;
const PRICE_SCALE = 10 ** EURUSD_PRECISION;

function roundToPrecision(price: number): number {
  return Math.round(price * PRICE_SCALE) / PRICE_SCALE;
}

export type MockForexStreamOptions = {
  /** Base price (e.g. EURUSD ~1.08). */
  basePrice?: number;
  /** First tick price (e.g. last bar close from initial data to avoid jump). */
  initialPrice?: number;
  /** Min price clamp. */
  min?: number;
  /** Max price clamp. */
  max?: number;
  /** Step size per tick (~0.1 pip = 0.00001). */
  step?: number;
  /** Max absolute move per tick in price (1 pip = 0.0001 for EURUSD). */
  maxMovePerTick?: number;
  /** Emit interval in ms (e.g. 200–500). */
  intervalMs?: number;
  /** Simulated seconds advanced per tick (e.g. 1 → 60 ticks ≈ 1 minute). */
  timeStepSeconds?: number;
  /** 0–1; pull price toward base each tick to avoid drift. */
  meanReversion?: number;
};

/** Realistic EURUSD: 0.1 pip step, max 1 pip per tick, tight range per candle. */
const DEFAULTS = {
  basePrice: 1.08,
  min: 1.05,
  max: 1.15,
  step: 0.00001,
  maxMovePerTick: 0.0001,
  intervalMs: 300,
  timeStepSeconds: 1,
  meanReversion: 0.03,
};

type ResolvedOptions = typeof DEFAULTS & { initialPrice?: number };

function nextPrice(price: number, opts: ResolvedOptions): number {
  const { basePrice, min, max, step, maxMovePerTick, meanReversion } = opts;
  const delta = (Math.random() - 0.5) * 2 * step;
  const clampedDelta = Math.max(
    -maxMovePerTick,
    Math.min(maxMovePerTick, delta),
  );
  let next = price + clampedDelta;
  next = next + (basePrice - next) * meanReversion;
  return roundToPrecision(Math.min(max, Math.max(min, next)));
}

export type CandlestickBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const M5_PERIOD_SECONDS = 300;

/**
 * Generate initial M5 (5-minute) bars using the same price process so the live
 * stream continues seamlessly. Bars are in the past ending before "now".
 */
export function generateInitialM5Bars(
  barCount: number,
  options: MockForexStreamOptions = {},
): CandlestickBar[] {
  const opts: ResolvedOptions = { ...DEFAULTS, ...options };
  const nowSec = Math.floor(Date.now() / 1000);
  const startBarTime =
    Math.floor(nowSec / M5_PERIOD_SECONDS) * M5_PERIOD_SECONDS -
    barCount * M5_PERIOD_SECONDS;
  const bars: CandlestickBar[] = [];
  let price = opts.basePrice;

  for (let i = 0; i < barCount; i++) {
    const barTime = startBarTime + i * M5_PERIOD_SECONDS;
    const open = price;
    let high = price;
    let low = price;
    for (let t = 0; t < M5_PERIOD_SECONDS; t++) {
      price = nextPrice(price, opts);
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
    bars.push({
      time: barTime,
      open: roundToPrecision(open),
      high: roundToPrecision(high),
      low: roundToPrecision(low),
      close: roundToPrecision(price),
    });
  }

  return bars;
}

export type MockForexStreamSubscription = {
  subscribe: (onTick: (tick: ForexTick) => void) => void;
  stop: () => void;
};

/**
 * Creates a mock forex stream that emits ticks at a configurable interval.
 * Time advances by timeStepSeconds per tick so 60 ticks ≈ 1 minute (M1 bars).
 * Returns subscribe/stop for the chart to use in useEffect.
 */
export function createMockForexStream(
  _symbol: string,
  options: MockForexStreamOptions = {},
): MockForexStreamSubscription {
  const opts: ResolvedOptions = { ...DEFAULTS, ...options };
  let price = opts.initialPrice ?? opts.basePrice;
  let timeSec = Math.floor(Date.now() / 1000);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let onTick: ((tick: ForexTick) => void) | null = null;

  return {
    subscribe(callback: (tick: ForexTick) => void) {
      onTick = callback;
      intervalId = setInterval(() => {
        price = nextPrice(price, opts);
        timeSec += opts.timeStepSeconds;
        onTick?.({ time: timeSec, price });
      }, opts.intervalMs);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      onTick = null;
    },
  };
}
