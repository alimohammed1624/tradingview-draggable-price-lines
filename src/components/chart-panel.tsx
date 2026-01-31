import { createM5Aggregator } from "@/lib/aggregate-ticks";
import {
  createMockForexStream,
  generateInitialM5Bars,
} from "@/lib/mock-forex-stream";
import type { TradeLog, PreviewTrade } from "@/components/place-trades-card";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
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
  /** List of trades to display as price lines */
  trades?: TradeLog[];
  /** Preview trade to display with solid lines */
  previewTrade?: PreviewTrade | null;
  /** Callback when SL preview line is dragged */
  onSlPriceDrag?: (price: number) => void;
  /** Callback when TP preview line is dragged */
  onTpPriceDrag?: (price: number) => void;
};

export function ChartPanel({ onPriceChange, trades = [], previewTrade = null, onSlPriceDrag, onTpPriceDrag }: ChartPanelProps = {}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Map<number, IPriceLine[]>>(new Map());
  const previewLinesRef = useRef<IPriceLine[]>([]);
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;
  
  // Drag state refs
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<"sl" | "tp" | null>(null);
  const onSlPriceDragRef = useRef(onSlPriceDrag);
  const onTpPriceDragRef = useRef(onTpPriceDrag);
  onSlPriceDragRef.current = onSlPriceDrag;
  onTpPriceDragRef.current = onTpPriceDrag;

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
    });

    // Drag threshold in pixels
    const DRAG_THRESHOLD = 8;

    // Helper to set cursor on container and all inner elements
    const setCursor = (cursor: string) => {
      container.style.cursor = cursor;
      const innerElements = container.querySelectorAll('canvas, table, td');
      innerElements.forEach((el) => {
        (el as HTMLElement).style.cursor = cursor;
      });
    };

    // Helper to check if Y coordinate is near a price line
    const isNearPriceLine = (mouseY: number, price: number | null): boolean => {
      if (price === null || !seriesRef.current) return false;
      const lineY = seriesRef.current.priceToCoordinate(price);
      if (lineY === null) return false;
      return Math.abs(mouseY - lineY) <= DRAG_THRESHOLD;
    };

    // Mouse down handler to start dragging
    const handleMouseDown = (e: MouseEvent) => {
      if (!seriesRef.current || !chartContainerRef.current) return;
      
      const rect = chartContainerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      
      // Get current preview line prices from refs
      const previewLines = previewLinesRef.current;
      if (previewLines.length === 0) return;
      
      // Check SL line (index 0) and TP line (index 1)
      const slLine = previewLines[0];
      const tpLine = previewLines[1];
      
      const slPrice = slLine?.options().price ?? null;
      const tpPrice = tpLine?.options().price ?? null;
      
      if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
        isDraggingRef.current = true;
        dragTargetRef.current = "sl";
        setCursor("ns-resize");
        // Disable chart scroll/scale during drag
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        e.preventDefault();
        e.stopPropagation();
      } else if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
        isDraggingRef.current = true;
        dragTargetRef.current = "tp";
        setCursor("ns-resize");
        // Disable chart scroll/scale during drag
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Mouse move handler for dragging and hover cursor
    const handleMouseMove = (e: MouseEvent) => {
      if (!seriesRef.current || !chartContainerRef.current) return;
      
      const rect = chartContainerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      
      if (isDraggingRef.current && dragTargetRef.current) {
        // Convert Y coordinate to price
        const newPrice = seriesRef.current.coordinateToPrice(mouseY);
        if (newPrice !== null) {
          if (dragTargetRef.current === "sl") {
            onSlPriceDragRef.current?.(newPrice as number);
          } else if (dragTargetRef.current === "tp") {
            onTpPriceDragRef.current?.(newPrice as number);
          }
        }
      } else {
        // Update cursor based on hover
        const previewLines = previewLinesRef.current;
        if (previewLines.length === 0) {
          setCursor("");
          return;
        }
        
        const slLine = previewLines[0];
        const tpLine = previewLines[1];
        const slPrice = slLine?.options().price ?? null;
        const tpPrice = tpLine?.options().price ?? null;
        
        if (isNearPriceLine(mouseY, slPrice) || isNearPriceLine(mouseY, tpPrice)) {
          setCursor("ns-resize");
        } else {
          setCursor("");
        }
      }
    };

    // Mouse up handler to stop dragging
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragTargetRef.current = null;
        // Re-enable chart scroll/scale after drag
        chart.applyOptions({
          handleScroll: true,
          handleScale: true,
        });
        setCursor("");
      }
    };

    // Mouse leave handler to stop dragging when leaving chart
    const handleMouseLeave = () => {
      handleMouseUp();
      setCursor("");
    };

    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("mouseleave", handleMouseLeave);

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
      
      // Cleanup drag event listeners
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("mouseleave", handleMouseLeave);
      
      // Cleanup all price lines
      priceLinesRef.current.forEach((lines) => {
        lines.forEach((line) => {
          seriesRef.current?.removePriceLine(line);
        });
      });
      priceLinesRef.current.clear();
      
      // Cleanup preview lines
      previewLinesRef.current.forEach((line) => {
        seriesRef.current?.removePriceLine(line);
      });
      previewLinesRef.current = [];
      
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Sync price lines with trades
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const currentLines = priceLinesRef.current;
    const tradeIds = new Set(trades.map((t) => t.id));

    // Remove price lines for deleted trades
    currentLines.forEach((lines, tradeId) => {
      if (!tradeIds.has(tradeId)) {
        lines.forEach((line) => series.removePriceLine(line));
        currentLines.delete(tradeId);
      }
    });

    // Add or update price lines for each trade
    trades.forEach((trade) => {
      const existingLines = currentLines.get(trade.id);

      if (existingLines) {
        // Update existing price lines visibility
        const [entryLine, slLine, tpLine] = existingLines;
        entryLine.applyOptions({ lineVisible: trade.visible, axisLabelVisible: trade.visible });
        if (slLine) slLine.applyOptions({ lineVisible: trade.visible, axisLabelVisible: trade.visible });
        if (tpLine) tpLine.applyOptions({ lineVisible: trade.visible, axisLabelVisible: trade.visible });
      } else {
        // Create new price lines
        const lines: IPriceLine[] = [];

        // Entry line
        const entryLine = series.createPriceLine({
          price: trade.entryPrice,
          color: trade.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: trade.visible,
          axisLabelVisible: true,
          title: "Entry",
        });
        lines.push(entryLine);

        // Stop loss line
        if (trade.stopLoss !== null) {
          const slLine = series.createPriceLine({
            price: trade.stopLoss,
            color: trade.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: "SL",
          });
          lines.push(slLine);
        }

        // Take profit line
        if (trade.takeProfit !== null) {
          const tpLine = series.createPriceLine({
            price: trade.takeProfit,
            color: trade.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: "TP",
          });
          lines.push(tpLine);
        }

        currentLines.set(trade.id, lines);
      }
    });
  }, [trades]);

  // Sync preview trade lines
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const currentPreviewLines = previewLinesRef.current;
    
    // Remove existing preview lines
    currentPreviewLines.forEach((line) => {
      series.removePriceLine(line);
    });
    previewLinesRef.current = [];

    // Add new preview lines if preview trade exists
    if (previewTrade) {
      const newLines: IPriceLine[] = [];

      // Stop loss line (solid) - Green
      if (previewTrade.stopLoss !== null) {
        const slLine = series.createPriceLine({
          price: previewTrade.stopLoss,
          color: "#ef4444", // Red for TP
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: "SL (Preview)",
        });
        newLines.push(slLine);
      }
      
      // Take profit line (solid) - Red
      if (previewTrade.takeProfit !== null) {
        const tpLine = series.createPriceLine({
          price: previewTrade.takeProfit,
          color: "#10b981", // Green for SL
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: "TP (Preview)",
        });
        newLines.push(tpLine);
      }

      previewLinesRef.current = newLines;
    }
  }, [previewTrade]);

  return <div ref={chartContainerRef} className="h-full w-full" />;
}
