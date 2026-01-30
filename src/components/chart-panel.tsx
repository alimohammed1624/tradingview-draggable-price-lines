import { createM5Aggregator } from "@/lib/aggregate-ticks";
import {
  createMockForexStream,
  generateInitialM5Bars,
} from "@/lib/mock-forex-stream";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

/** lightweight-charts only accepts rgb/rgba/hex, not oklch. Use hex so it always parses. */
function getChartColors(): {
  backgroundColor: string;
  textColor: string;
  upColor: string;
  downColor: string;
} {
  const isDark =
    document.documentElement.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDark
    ? {
        backgroundColor: "#1c1c1c",
        textColor: "#fafafa",
        upColor: "#26a69a",
        downColor: "#ef5350",
      }
    : {
        backgroundColor: "#ffffff",
        textColor: "#191919",
        upColor: "#26a69a",
        downColor: "#ef5350",
      };
}

export type ChartPanelProps = {
  /** Called with the chart's current live price on each tick (and with initial last close when ready). */
  onPriceChange?: (price: number) => void;
};

export function ChartPanel({ onPriceChange }: ChartPanelProps = {}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const { backgroundColor, textColor, upColor, downColor } = getChartColors();

    const chart = createChart(container, {
      layout: {
        background: {
          type: ColorType.Solid,
          color: backgroundColor,
        },
        textColor,
      },
      width: container.clientWidth,
      height: container.clientHeight,
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(0,0,0,0.06)" },
      },
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });
    const initialBars = generateInitialM5Bars(24, {});
    candlestickSeries.setData(initialBars as CandlestickData<Time>[]);
    seriesRef.current = candlestickSeries;

    const lastClose = initialBars[initialBars.length - 1].close;
    onPriceChangeRef.current?.(lastClose);

    const stream = createMockForexStream("EURUSD", { initialPrice: lastClose });
    const aggregator = createM5Aggregator();
    stream.subscribe((tick) => {
      onPriceChangeRef.current?.(tick.price);
      const bar = aggregator.applyTick(tick);
      seriesRef.current?.update(bar as CandlestickData<Time>);
      chartRef.current?.timeScale().scrollToRealTime();
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
        chartRef.current.applyOptions({
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResize);

    return () => {
      stream.stop();
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  return <div ref={chartContainerRef} className="h-full w-full" />;
}
