/**
 * Mock forex price stream: emits ticks in EURUSD-style range for live chart updates.
 * No React or chart code—pure generator/subscription.
 * EURUSD: 5 decimal places, 1 pip = 0.0001.
 * Price is the single source of truth; candles are derived via aggregate-ticks.
 * Deterministic if Math.random is seeded before starting.
 */

export type ForexTick = { time: number; price: number };

/** EURUSD quote precision (5 decimal places, e.g. 1.08543). */
export const EURUSD_PRECISION = 5;
const PRICE_SCALE = 10 ** EURUSD_PRECISION;

function roundToPrecision(price: number): number {
  return Math.round(price * PRICE_SCALE) / PRICE_SCALE;
}

// --- Regime state (internal) ---

type RegimeType = "RANGE" | "TREND" | "SPIKE";

interface RegimeState {
  type: RegimeType;
  drift: number;
  volatility: number;
  ticksRemaining: number;
}

// --- Normal random (Box-Muller, no deps) ---

function randomNormal(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  if (u1 <= 0) return mean;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// Regime sampling: fixed bounds for reproducibility (deterministic if RNG seeded)
const PIP = 0.0001;

function sampleRegime(): RegimeState {
  const r = Math.random();
  if (r < 0.7) {
    return {
      type: "RANGE",
      drift: 0,
      volatility: 0.00003 + Math.random() * 0.00003,
      ticksRemaining: 80 + Math.floor(Math.random() * 121),
    };
  }
  if (r < 0.95) {
    const sign = Math.random() < 0.5 ? -1 : 1;
    return {
      type: "TREND",
      drift: sign * (0.5 * PIP + Math.random() * 0.5 * PIP),
      volatility: 0.00005 + Math.random() * 0.00003,
      ticksRemaining: 20 + Math.floor(Math.random() * 41),
    };
  }
  return {
    type: "SPIKE",
    drift: 0,
    volatility: 0.00015 + Math.random() * 0.0001,
    ticksRemaining: 5 + Math.floor(Math.random() * 11),
  };
}

// --- Options ---

export type MockForexStreamOptions = {
  /** Base price (e.g. EURUSD ~1.08). */
  basePrice?: number;
  /** First tick price (e.g. last bar close from initial data to avoid jump). */
  initialPrice?: number;
  /** Min price clamp. */
  min?: number;
  /** Max price clamp. */
  max?: number;
  /** Emit interval in ms (e.g. 200–500). */
  intervalMs?: number;
  /** Simulated seconds advanced per tick (e.g. 1 → 60 ticks ≈ 1 minute). */
  timeStepSeconds?: number;
  /** 0–1; pull price toward base each tick in RANGE regime only. */
  meanReversion?: number;
};

const DEFAULTS = {
  basePrice: 1.08,
  min: 1.05,
  max: 1.15,
  intervalMs: 300,
  timeStepSeconds: 1,
  meanReversion: 0.03,
};

type ResolvedOptions = typeof DEFAULTS & { initialPrice?: number };

// --- Regime-aware next price ---

function nextPrice(
  price: number,
  regime: RegimeState,
  opts: ResolvedOptions,
): number {
  const { basePrice, min, max, meanReversion } = opts;
  const noise = randomNormal(0, regime.volatility);
  let next = price + regime.drift + noise;

  if (regime.type === "RANGE") {
    next += (basePrice - next) * meanReversion;
  }

  regime.volatility = 0.9 * regime.volatility + 0.1 * Math.abs(noise);

  return roundToPrecision(Math.min(max, Math.max(min, next)));
}

function evolveRegime(regime: RegimeState): void {
  regime.ticksRemaining -= 1;
  if (regime.ticksRemaining <= 0) {
    const next = sampleRegime();
    regime.type = next.type;
    regime.drift = next.drift;
    regime.volatility = next.volatility;
    regime.ticksRemaining = next.ticksRemaining;
  }
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
 * Same regime state machine and nextPrice as the live stream.
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
  const regime = sampleRegime();

  for (let i = 0; i < barCount; i++) {
    const barTime = startBarTime + i * M5_PERIOD_SECONDS;
    const open = price;
    let high = price;
    let low = price;
    for (let t = 0; t < M5_PERIOD_SECONDS; t++) {
      price = nextPrice(price, regime, opts);
      evolveRegime(regime);
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
  const regime = sampleRegime();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let onTick: ((tick: ForexTick) => void) | null = null;

  return {
    subscribe(callback: (tick: ForexTick) => void) {
      onTick = callback;
      intervalId = setInterval(() => {
        price = nextPrice(price, regime, opts);
        evolveRegime(regime);
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
