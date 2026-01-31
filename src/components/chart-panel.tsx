import type { PreviewTrade, TradeLog } from "@/components/place-trades-card";
import { createM5Aggregator } from "@/lib/aggregate-ticks";
import {
  createMockForexStream,
  generateInitialM5Bars,
  type MockForexStreamOptions,
} from "@/lib/mock-forex-stream";
import {
  createPolygonForexStream,
  deriveMockOptionsFromBars,
  fetchPolygonForexM5Bars,
} from "@/lib/polygon-forex-stream";
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

/** Number of 5m bars to load for history (288 = 24h). */
const M5_HISTORY_BAR_COUNT = 288;

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
  /** Callback when placed trade SL/TP is dragged */
  onTradePriceUpdate?: (
    tradeId: number,
    lineType: "sl" | "tp",
    newPrice: number,
  ) => void;
  /** Data source: simulated (default) or live EURUSD */
  dataSource?: "simulated" | "live";
};

type DragTarget =
  | { type: "sl" | "tp"; tradeId: number }
  | { type: "sl" | "tp"; tradeId: "preview" }
  | null;

type TradeLines = {
  entry: IPriceLine;
  sl: IPriceLine | null;
  tp: IPriceLine | null;
};

export function ChartPanel({
  onPriceChange,
  trades = [],
  previewTrade = null,
  onSlPriceDrag,
  onTpPriceDrag,
  onTradePriceUpdate,
  dataSource = "simulated",
}: ChartPanelProps = {}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Map<number, TradeLines>>(new Map());
  const previewLinesRef = useRef<IPriceLine[]>([]);
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;

  // Drag state refs
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<DragTarget>(null);
  const dragFinalPriceRef = useRef<number | null>(null);
  const dragOriginalStylesRef = useRef<
    Map<IPriceLine, { width: number; style: LineStyle }>
  >(new Map());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const onSlPriceDragRef = useRef(onSlPriceDrag);
  const onTpPriceDragRef = useRef(onTpPriceDrag);
  const onTradePriceUpdateRef = useRef(onTradePriceUpdate);
  const streamRef = useRef<{ stop: () => void } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  onSlPriceDragRef.current = onSlPriceDrag;
  onTpPriceDragRef.current = onTpPriceDrag;
  onTradePriceUpdateRef.current = onTradePriceUpdate;

  useEffect(() => {
    let cancelled = false;
    const container = chartContainerRef.current;
    if (!container) return;

    const { backgroundColor, textColor, upColor, downColor } = getChartColors();

    (async () => {
      let initialBars: {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
      }[];
      let lastClose: number;
      let mockOptions: MockForexStreamOptions = { initialPrice: 1.08 };

      const apiKey = import.meta.env.VITE_POLYGON_API_KEY as string | undefined;
      try {
        if (apiKey?.trim()) {
          const bars = await fetchPolygonForexM5Bars(
            "C:EURUSD",
            M5_HISTORY_BAR_COUNT,
            apiKey,
          );
          if (cancelled) return;
          if (bars.length > 0) {
            initialBars = bars;
            lastClose = bars[bars.length - 1].close;
            mockOptions = deriveMockOptionsFromBars(bars);
          } else {
            initialBars = generateInitialM5Bars(M5_HISTORY_BAR_COUNT, {});
            lastClose = initialBars[initialBars.length - 1].close;
            mockOptions = { initialPrice: lastClose };
          }
        } else {
          initialBars = generateInitialM5Bars(M5_HISTORY_BAR_COUNT, {});
          lastClose = initialBars[initialBars.length - 1].close;
          mockOptions = { initialPrice: lastClose };
        }
      } catch {
        if (cancelled) return;
        initialBars = generateInitialM5Bars(M5_HISTORY_BAR_COUNT, {});
        lastClose = initialBars[initialBars.length - 1].close;
        mockOptions = { initialPrice: lastClose };
      }

      if (cancelled) return;

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
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: number, tickMarkType: number) => {
            const d = new Date(time * 1000);
            const pad = (n: number) => String(n).padStart(2, "0");
            if (tickMarkType === 3 || tickMarkType === 4) {
              return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
            if (tickMarkType === 2) {
              return `${pad(d.getMonth() + 1)}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          },
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
      candlestickSeries.setData(initialBars as CandlestickData<Time>[]);
      seriesRef.current = candlestickSeries;

      onPriceChangeRef.current?.(lastClose);

      const stream =
        dataSource === "live"
          ? createPolygonForexStream("EUR-USD")
          : createMockForexStream("EURUSD", mockOptions);
      streamRef.current = stream;
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
        const innerElements = container.querySelectorAll("canvas, table, td");
        innerElements.forEach((el) => {
          (el as HTMLElement).style.cursor = cursor;
        });
      };

      // Helper to check if Y coordinate is near a price line
      const isNearPriceLine = (
        mouseY: number,
        price: number | null,
      ): boolean => {
        if (price === null || !seriesRef.current) return false;
        const lineY = seriesRef.current.priceToCoordinate(price);
        if (lineY === null) return false;
        return Math.abs(mouseY - lineY) <= DRAG_THRESHOLD;
      };

      // Helper to apply visual feedback when drag starts
      const applyDragVisuals = (target: DragTarget) => {
        if (!target) return;

        dragOriginalStylesRef.current.clear();

        if (target.tradeId === "preview") {
          const lineIndex = target.type === "sl" ? 0 : 1;
          const line = previewLinesRef.current[lineIndex];
          if (line) {
            const opts = line.options();
            dragOriginalStylesRef.current.set(line, {
              width: opts.lineWidth ?? 2,
              style: opts.lineStyle ?? LineStyle.Solid,
            });
            line.applyOptions({ lineWidth: 4, lineStyle: LineStyle.Solid });
          }
        } else {
          const tradeLines = priceLinesRef.current.get(target.tradeId);
          if (tradeLines) {
            const draggedLine =
              target.type === "sl" ? tradeLines.sl : tradeLines.tp;
            if (draggedLine) {
              const opts = draggedLine.options();
              dragOriginalStylesRef.current.set(draggedLine, {
                width: opts.lineWidth ?? 2,
                style: opts.lineStyle ?? LineStyle.Dotted,
              });
              draggedLine.applyOptions({
                lineWidth: 4,
                lineStyle: LineStyle.Solid,
              });
            }
            [
              tradeLines.entry,
              target.type === "sl" ? tradeLines.tp : tradeLines.sl,
            ].forEach((line) => {
              if (line) {
                const opts = line.options();
                dragOriginalStylesRef.current.set(line, {
                  width: opts.lineWidth ?? 2,
                  style: opts.lineStyle ?? LineStyle.Dotted,
                });
                line.applyOptions({ lineWidth: 3 });
              }
            });
          }
        }

        if (!tooltipRef.current && chartContainerRef.current) {
          const tooltip = document.createElement("div");
          tooltip.style.position = "absolute";
          tooltip.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
          tooltip.style.color = "white";
          tooltip.style.padding = "4px 8px";
          tooltip.style.borderRadius = "4px";
          tooltip.style.fontSize = "12px";
          tooltip.style.pointerEvents = "none";
          tooltip.style.zIndex = "1000";
          tooltip.style.fontFamily = "monospace";
          chartContainerRef.current.appendChild(tooltip);
          tooltipRef.current = tooltip;
        }
      };

      const removeDragVisuals = () => {
        dragOriginalStylesRef.current.forEach((original, line) => {
          line.applyOptions({
            lineWidth: original.width as 1 | 2 | 3 | 4,
            lineStyle: original.style,
          });
        });
        dragOriginalStylesRef.current.clear();

        if (tooltipRef.current && chartContainerRef.current) {
          chartContainerRef.current.removeChild(tooltipRef.current);
          tooltipRef.current = null;
        }
      };

      const handleMouseDown = (e: MouseEvent) => {
        if (!seriesRef.current || !chartContainerRef.current) return;

        const rect = chartContainerRef.current.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;

        const previewLines = previewLinesRef.current;
        if (previewLines.length > 0) {
          const slLine = previewLines[0];
          const tpLine = previewLines[1];
          const slPrice = slLine?.options().price ?? null;
          const tpPrice = tpLine?.options().price ?? null;

          if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
            isDraggingRef.current = true;
            dragTargetRef.current = { type: "sl", tradeId: "preview" };
            applyDragVisuals(dragTargetRef.current);
            setCursor("ns-resize");
            chart.applyOptions({ handleScroll: false, handleScale: false });
            e.preventDefault();
            e.stopPropagation();
            return;
          } else if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
            isDraggingRef.current = true;
            dragTargetRef.current = { type: "tp", tradeId: "preview" };
            applyDragVisuals(dragTargetRef.current);
            setCursor("ns-resize");
            chart.applyOptions({ handleScroll: false, handleScale: false });
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        for (const [tradeId, lines] of priceLinesRef.current.entries()) {
          if (lines.sl) {
            const slPrice = lines.sl.options().price;
            if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
              isDraggingRef.current = true;
              dragTargetRef.current = { type: "sl", tradeId };
              applyDragVisuals(dragTargetRef.current);
              setCursor("ns-resize");
              chart.applyOptions({ handleScroll: false, handleScale: false });
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }

          if (lines.tp) {
            const tpPrice = lines.tp.options().price;
            if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
              isDraggingRef.current = true;
              dragTargetRef.current = { type: "tp", tradeId };
              applyDragVisuals(dragTargetRef.current);
              setCursor("ns-resize");
              chart.applyOptions({ handleScroll: false, handleScale: false });
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!seriesRef.current || !chartContainerRef.current) return;

        const rect = chartContainerRef.current.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const mouseX = e.clientX - rect.left;

        if (isDraggingRef.current && dragTargetRef.current) {
          const newPrice = seriesRef.current.coordinateToPrice(mouseY);
          if (newPrice !== null) {
            const target = dragTargetRef.current;

            if (target.tradeId === "preview") {
              if (target.type === "sl") {
                onSlPriceDragRef.current?.(newPrice as number);
              } else {
                onTpPriceDragRef.current?.(newPrice as number);
              }
            } else {
              dragFinalPriceRef.current = newPrice as number;

              const lines = priceLinesRef.current.get(target.tradeId);
              if (lines) {
                const line = target.type === "sl" ? lines.sl : lines.tp;
                line?.applyOptions({ price: newPrice as number });
              }
            }

            if (tooltipRef.current) {
              tooltipRef.current.textContent = `${target.type.toUpperCase()}: ${(newPrice as number).toFixed(5)}`;
              tooltipRef.current.style.left = `${mouseX + 10}px`;
              tooltipRef.current.style.top = `${mouseY - 10}px`;
            }
          }
        } else {
          let isNearAnyLine = false;

          const previewLines = previewLinesRef.current;
          if (previewLines.length > 0) {
            const slLine = previewLines[0];
            const tpLine = previewLines[1];
            const slPrice = slLine?.options().price ?? null;
            const tpPrice = tpLine?.options().price ?? null;

            if (
              isNearPriceLine(mouseY, slPrice) ||
              isNearPriceLine(mouseY, tpPrice)
            ) {
              isNearAnyLine = true;
            }
          }

          if (!isNearAnyLine) {
            for (const lines of priceLinesRef.current.values()) {
              if (lines.sl) {
                const slPrice = lines.sl.options().price;
                if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
                  isNearAnyLine = true;
                  break;
                }
              }
              if (lines.tp) {
                const tpPrice = lines.tp.options().price;
                if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
                  isNearAnyLine = true;
                  break;
                }
              }
            }
          }

          setCursor(isNearAnyLine ? "ns-resize" : "");
        }
      };

      const handleMouseUp = () => {
        if (isDraggingRef.current) {
          const target = dragTargetRef.current;
          const finalPrice = dragFinalPriceRef.current;
          if (target && target.tradeId !== "preview" && finalPrice !== null) {
            onTradePriceUpdateRef.current?.(
              target.tradeId,
              target.type,
              finalPrice,
            );
          }

          removeDragVisuals();
          isDraggingRef.current = false;
          dragTargetRef.current = null;
          dragFinalPriceRef.current = null;
          chart.applyOptions({
            handleScroll: true,
            handleScale: true,
          });
          setCursor("");
        }
      };

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

      cleanupRef.current = () => {
        stream.stop();
        streamRef.current = null;
        resizeObserver.disconnect();
        window.removeEventListener("resize", handleResize);

        container.removeEventListener("mousedown", handleMouseDown);
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseup", handleMouseUp);
        container.removeEventListener("mouseleave", handleMouseLeave);

        if (tooltipRef.current && container) {
          container.removeChild(tooltipRef.current);
          tooltipRef.current = null;
        }

        priceLinesRef.current.forEach((lines) => {
          if (lines.entry) seriesRef.current?.removePriceLine(lines.entry);
          if (lines.sl) seriesRef.current?.removePriceLine(lines.sl);
          if (lines.tp) seriesRef.current?.removePriceLine(lines.tp);
        });
        priceLinesRef.current.clear();

        previewLinesRef.current.forEach((line) => {
          seriesRef.current?.removePriceLine(line);
        });
        previewLinesRef.current = [];

        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [dataSource]);

  // Sync price lines with trades
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Skip entire sync if currently dragging to prevent fighting with drag updates
    if (isDraggingRef.current) return;

    const currentLines = priceLinesRef.current;
    const tradeIds = new Set(trades.map((t) => t.id));

    // Remove price lines for deleted trades
    currentLines.forEach((lines, tradeId) => {
      if (!tradeIds.has(tradeId)) {
        if (lines.entry) series.removePriceLine(lines.entry);
        if (lines.sl) series.removePriceLine(lines.sl);
        if (lines.tp) series.removePriceLine(lines.tp);
        currentLines.delete(tradeId);
      }
    });

    // Add or update price lines for each trade
    trades.forEach((trade) => {
      const existingLines = currentLines.get(trade.id);

      if (existingLines) {
        // Update existing price lines visibility and prices
        existingLines.entry.applyOptions({
          lineVisible: trade.visible,
          axisLabelVisible: trade.visible,
        });

        // Skip updating price if currently dragging this line
        const isDraggingThisLine =
          isDraggingRef.current && dragTargetRef.current?.tradeId === trade.id;

        if (existingLines.sl) {
          const options: any = {
            lineVisible: trade.visible,
            axisLabelVisible: trade.visible,
          };
          // Only update price if not currently dragging this SL line
          if (!(isDraggingThisLine && dragTargetRef.current?.type === "sl")) {
            options.price = trade.stopLoss!;
          }
          existingLines.sl.applyOptions(options);
        }
        if (existingLines.tp) {
          const options: any = {
            lineVisible: trade.visible,
            axisLabelVisible: trade.visible,
          };
          // Only update price if not currently dragging this TP line
          if (!(isDraggingThisLine && dragTargetRef.current?.type === "tp")) {
            options.price = trade.takeProfit!;
          }
          existingLines.tp.applyOptions(options);
        }

        // Handle SL/TP addition or removal
        if (trade.stopLoss !== null && !existingLines.sl) {
          existingLines.sl = series.createPriceLine({
            price: trade.stopLoss,
            color: trade.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: "SL",
          });
        } else if (trade.stopLoss === null && existingLines.sl) {
          series.removePriceLine(existingLines.sl);
          existingLines.sl = null;
        }

        if (trade.takeProfit !== null && !existingLines.tp) {
          existingLines.tp = series.createPriceLine({
            price: trade.takeProfit,
            color: trade.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: "TP",
          });
        } else if (trade.takeProfit === null && existingLines.tp) {
          series.removePriceLine(existingLines.tp);
          existingLines.tp = null;
        }
      } else {
        // Create new price lines
        const entryLine = series.createPriceLine({
          price: trade.entryPrice,
          color: trade.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: trade.visible,
          axisLabelVisible: true,
          title: "Entry",
        });

        const slLine =
          trade.stopLoss !== null
            ? series.createPriceLine({
                price: trade.stopLoss,
                color: trade.color,
                lineWidth: 2,
                lineStyle: LineStyle.Dotted,
                lineVisible: trade.visible,
                axisLabelVisible: true,
                title: "SL",
              })
            : null;

        const tpLine =
          trade.takeProfit !== null
            ? series.createPriceLine({
                price: trade.takeProfit,
                color: trade.color,
                lineWidth: 2,
                lineStyle: LineStyle.Dotted,
                lineVisible: trade.visible,
                axisLabelVisible: true,
                title: "TP",
              })
            : null;

        currentLines.set(trade.id, {
          entry: entryLine,
          sl: slLine,
          tp: tpLine,
        });
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

      // Stop loss line (solid) - Red
      if (previewTrade.stopLoss !== null) {
        const slLine = series.createPriceLine({
          price: previewTrade.stopLoss,
          color: previewTrade.color ?? "#ef4444", // Use trade color in edit mode, otherwise red
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: "SL (Preview)",
        });
        newLines.push(slLine);
      }

      // Take profit line (solid) - Green
      if (previewTrade.takeProfit !== null) {
        const tpLine = series.createPriceLine({
          price: previewTrade.takeProfit,
          color: previewTrade.color ?? "#10b981", // Use trade color in edit mode, otherwise green
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
