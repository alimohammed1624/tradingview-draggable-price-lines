/**
 * Live forex stream via Polygon.io WebSocket (aggregates per second).
 * REST fetch for historical 5m bars: https://polygon.io/docs/rest/forex/aggregates/custom-bars
 */

import type { OhlcBar } from "./aggregate-ticks";
import type { ForexTick } from "./mock-forex-stream";

const POLYGON_API_BASE = "https://api.polygon.io";
const POLYGON_FOREX_WS_URL = "wss://socket.polygon.io/forex";

/** Polygon REST aggregate result (t = Unix ms). */
type PolygonAggResult = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

/** Polygon REST aggregates response. */
type PolygonAggsResponse = {
  results?: PolygonAggResult[];
  status?: string;
};

/** Look back 7 days so we get bars even when market was closed (e.g. weekend). */
const FOREX_M5_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** 5-minute period in seconds; bar times are floored to this boundary (e.g. 19:45, 19:50). */
const M5_PERIOD_SECONDS = 300;

function alignToM5(unixSeconds: number): number {
  return Math.floor(unixSeconds / M5_PERIOD_SECONDS) * M5_PERIOD_SECONDS;
}

/**
 * Fetches the last available 5-minute OHLC bars for a forex pair.
 * Uses a wide time window (7 days) and sort=desc + limit so we get the most recent
 * bars that actually have data (avoids empty results when the last 2h had no quotes).
 * See: https://polygon.io/docs/rest/forex/aggregates/custom-bars
 */
export async function fetchPolygonForexM5Bars(
  forexTicker: string,
  barCount: number,
  apiKey: string,
): Promise<OhlcBar[]> {
  const toMs = Date.now();
  const fromMs = toMs - FOREX_M5_LOOKBACK_MS;
  const url = `${POLYGON_API_BASE}/v2/aggs/ticker/${encodeURIComponent(forexTicker)}/range/5/minute/${fromMs}/${toMs}?apiKey=${encodeURIComponent(apiKey)}&sort=desc&limit=${barCount}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polygon REST ${res.status}`);
  }
  const data = (await res.json()) as PolygonAggsResponse;
  const results = data.results ?? [];
  const chronological = [...results].reverse();
  return chronological.map((r) => {
    const unixSeconds = Math.floor(r.t / 1000);
    return {
      time: alignToM5(unixSeconds),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
    };
  });
}

/** Polygon aggregate-per-second message (ev = CAS). */
type PolygonCASMessage = {
  ev?: string;
  pair?: string;
  o: number;
  c: number;
  h: number;
  l: number;
  v: number;
  s: number;
  e: number;
};

export type PolygonForexStreamSubscription = {
  subscribe: (onTick: (tick: ForexTick) => void) => void;
  stop: () => void;
};

/**
 * Creates a live forex stream for the given pair (e.g. "EUR-USD").
 * Uses VITE_POLYGON_API_KEY. Same subscribe/stop interface as mock stream.
 * If API key is missing, returns a no-op stream (no ticks, stop is a no-op).
 */
export function createPolygonForexStream(
  pair: string,
): PolygonForexStreamSubscription {
  const apiKey = import.meta.env.VITE_POLYGON_API_KEY as string | undefined;
  let ws: WebSocket | null = null;
  let onTick: ((tick: ForexTick) => void) | null = null;
  let subscribed = false;

  function stop() {
    if (ws) {
      ws.close();
      ws = null;
    }
    onTick = null;
    subscribed = false;
  }

  function subscribe(callback: (tick: ForexTick) => void) {
    onTick = callback;
    if (!apiKey?.trim()) {
      return;
    }
    if (ws?.readyState === WebSocket.OPEN) {
      return;
    }

    ws = new WebSocket(POLYGON_FOREX_WS_URL);

    ws.onopen = () => {
      ws!.send(
        JSON.stringify({
          action: "auth",
          params: apiKey,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (Array.isArray(data)) {
          for (const msg of data) {
            handleMessage(msg);
          }
        } else {
          handleMessage(data);
        }
      } catch {
        // ignore parse errors
      }
    };

    function handleMessage(
      msg: PolygonCASMessage & { status?: string; message?: string },
    ) {
      if (msg.status === "auth_success" || msg.status === "connected") {
        if (msg.status === "auth_success" && !subscribed) {
          subscribed = true;
          ws!.send(
            JSON.stringify({
              action: "subscribe",
              params: `CAS.${pair}`,
            }),
          );
        }
        return;
      }
      if (msg.status === "auth_failed" || msg.ev === "status") {
        return;
      }
      if (
        msg.ev === "CAS" &&
        typeof msg.s === "number" &&
        typeof msg.c === "number"
      ) {
        const tick: ForexTick = {
          time: Math.floor(msg.s / 1000),
          price: msg.c,
        };
        onTick?.(tick);
      }
    }

    ws.onerror = () => {
      stop();
    };

    ws.onclose = () => {
      ws = null;
      subscribed = false;
    };
  }

  return { subscribe, stop };
}
