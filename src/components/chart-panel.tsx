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
function getChartColors(isDark?: boolean): {
  backgroundColor: string;
  textColor: string;
  upColor: string;
  downColor: string;
} {
  const dark =
    isDark !== undefined
      ? isDark
      : document.documentElement.classList.contains("dark") ||
        window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark
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
  onSlPriceDrag?: (price: number, levelIndex: number) => void;
  /** Callback when TP preview line is dragged */
  onTpPriceDrag?: (price: number, levelIndex: number) => void;
  /** Callback when placed trade SL/TP level is dragged */
  onTradePriceUpdate?: (
    tradeId: number,
    lineType: "sl" | "tp",
    levelId: string,
    newPrice: number,
    isDragging?: boolean,
  ) => void;
  /** Data source: simulated (default) or live EURUSD */
  dataSource?: "simulated" | "live";
  /** When true, use dark theme for chart colors */
  isDark?: boolean;
};

type DragTarget =
  | { type: "sl" | "tp"; tradeId: number; levelId: string }
  | { type: "sl" | "tp"; tradeId: "preview"; levelIndex: number }
  | null;

type TradeLines = {
  entry: IPriceLine;
  slLevels: Map<string, IPriceLine>;  // levelId -> price line
  tpLevels: Map<string, IPriceLine>;  // levelId -> price line
};

const formatLotsLabel = (lots: number) => ` [${lots.toFixed(2)} lots]`;
const shouldShowLotsLabel = (levelLots: number, totalLots: number): boolean => {
  const EPSILON = 0.0001;
  return totalLots > 0 && Math.abs(levelLots - totalLots) > EPSILON;
};
const formatLotsLabelForTotal = (levelLots: number, totalLots: number): string =>
  (shouldShowLotsLabel(levelLots, totalLots) ? formatLotsLabel(levelLots) : "");

const getLineWidthForLots = (
  levelLots: number,
  totalLots: number,
  locked: boolean,
): 1 | 2 | 3 | 4 => {
  if (totalLots <= 0 || levelLots <= 0) return locked ? 3 : 1;
  const ratio = Math.min(1, Math.max(0, levelLots / totalLots));
  const baseWidth = Math.round(1 + 3 * Math.sqrt(ratio));
  const width = locked ? Math.max(3, baseWidth + 1) : baseWidth;
  return Math.min(4, Math.max(1, width)) as 1 | 2 | 3 | 4;
};

export function ChartPanel({
  onPriceChange,
  trades = [],
  previewTrade = null,
  onSlPriceDrag,
  onTpPriceDrag,
  onTradePriceUpdate,
  dataSource = "simulated",
  isDark,
}: ChartPanelProps = {}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Map<number, TradeLines>>(new Map());
  const previewLinesRef = useRef<IPriceLine[]>([]);
  const previewLineMetaRef = useRef<Array<{ type: "sl" | "tp"; levelIndex: number }>>([]);
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;

  // Keep refs up to date
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  // Keep previewTrade ref up to date
  const previewTradeRef = useRef(previewTrade);
  useEffect(() => {
    previewTradeRef.current = previewTrade;
  }, [previewTrade]);

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
  const tradesRef = useRef(trades);
  const streamRef = useRef<{ stop: () => void } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  onSlPriceDragRef.current = onSlPriceDrag;
  onTpPriceDragRef.current = onTpPriceDrag;
  onTradePriceUpdateRef.current = onTradePriceUpdate;

  useEffect(() => {
    let cancelled = false;
    const container = chartContainerRef.current;
    if (!container) return;

    const { backgroundColor, textColor, upColor, downColor } =
      getChartColors(isDark);

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
          const metaIndex = previewLineMetaRef.current.findIndex(
            (meta) => meta.type === target.type && meta.levelIndex === target.levelIndex,
          );
          const line = metaIndex >= 0 ? previewLinesRef.current[metaIndex] : undefined;
          if (line) {
            const opts = line.options();
            dragOriginalStylesRef.current.set(line, {
              width: opts.lineWidth ?? 2,
              style: opts.lineStyle ?? LineStyle.Solid,
            });
            line.applyOptions({ lineWidth: 4, lineStyle: LineStyle.Solid });
          }
        } else if ('levelId' in target) {
          const tradeLines = priceLinesRef.current.get(target.tradeId);
          if (tradeLines) {
            const levelMap = target.type === "sl" ? tradeLines.slLevels : tradeLines.tpLevels;
            const draggedLine = levelMap.get(target.levelId);
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
            // Also highlight entry and other levels
            const opts = tradeLines.entry.options();
            dragOriginalStylesRef.current.set(tradeLines.entry, {
              width: opts.lineWidth ?? 2,
              style: opts.lineStyle ?? LineStyle.Dotted,
            });
            tradeLines.entry.applyOptions({ lineWidth: 3 });
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
          for (let i = 0; i < previewLines.length; i++) {
            const line = previewLines[i];
            const price = line?.options().price ?? null;
            if (price !== null && isNearPriceLine(mouseY, price)) {
              const meta = previewLineMetaRef.current[i];
              if (!meta) break;
              isDraggingRef.current = true;
              dragTargetRef.current = { type: meta.type, tradeId: "preview", levelIndex: meta.levelIndex };
              applyDragVisuals(dragTargetRef.current);
              setCursor("ns-resize");
              chart.applyOptions({ handleScroll: false, handleScale: false });
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        }

        for (const [tradeId, lines] of priceLinesRef.current.entries()) {
          const trade = tradesRef.current.find((t) => t.id === tradeId);
          if (!trade) continue;
          
          // Check SL levels
          for (const [levelId, slLine] of lines.slLevels.entries()) {
            const level = trade.stopLossLevels.find((l) => l.id === levelId);
            if (level?.locked) continue;
            
            const slPrice = slLine.options().price;
            if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
              isDraggingRef.current = true;
              dragTargetRef.current = { type: "sl", tradeId, levelId };
              applyDragVisuals(dragTargetRef.current);
              setCursor("ns-resize");
              chart.applyOptions({ handleScroll: false, handleScale: false });
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }

          // Check TP levels
          for (const [levelId, tpLine] of lines.tpLevels.entries()) {
            const level = trade.takeProfitLevels.find((l) => l.id === levelId);
            if (level?.locked) continue;
            
            const tpPrice = tpLine.options().price;
            if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
              isDraggingRef.current = true;
              dragTargetRef.current = { type: "tp", tradeId, levelId };
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
                onSlPriceDragRef.current?.(newPrice as number, target.levelIndex);
              } else {
                onTpPriceDragRef.current?.(newPrice as number, target.levelIndex);
              }
            } else {
              dragFinalPriceRef.current = newPrice as number;

              const lines = priceLinesRef.current.get(target.tradeId);
              if (lines && 'levelId' in target) {
                const levelMap = target.type === "sl" ? lines.slLevels : lines.tpLevels;
                const line = levelMap.get(target.levelId);
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
            for (let i = 0; i < previewLines.length; i++) {
              const line = previewLines[i];
              const price = line?.options().price ?? null;
              if (price !== null && isNearPriceLine(mouseY, price)) {
                isNearAnyLine = true;
                break;
              }
            }
          }

          if (!isNearAnyLine) {
            outer: for (const [tradeId, lines] of priceLinesRef.current.entries()) {
              const trade = tradesRef.current.find((t) => t.id === tradeId);
              if (!trade) continue;
              
              // Check SL levels
              for (const [levelId, slLine] of lines.slLevels.entries()) {
                const level = trade.stopLossLevels.find((l) => l.id === levelId);
                if (level?.locked) continue;
                const slPrice = slLine.options().price;
                if (slPrice !== null && isNearPriceLine(mouseY, slPrice)) {
                  isNearAnyLine = true;
                  break outer;
                }
              }
              
              // Check TP levels
              for (const [levelId, tpLine] of lines.tpLevels.entries()) {
                const level = trade.takeProfitLevels.find((l) => l.id === levelId);
                if (level?.locked) continue;
                const tpPrice = tpLine.options().price;
                if (tpPrice !== null && isNearPriceLine(mouseY, tpPrice)) {
                  isNearAnyLine = true;
                  break outer;
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
          if (target && target.tradeId !== "preview" && finalPrice !== null && 'levelId' in target) {
            // Pass isDragging: false to trigger toast notification
            onTradePriceUpdateRef.current?.(
              target.tradeId,
              target.type,
              target.levelId,
              finalPrice,
              false,
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
          lines.slLevels.forEach((line) => seriesRef.current?.removePriceLine(line));
          lines.tpLevels.forEach((line) => seriesRef.current?.removePriceLine(line));
        });
        priceLinesRef.current.clear();

        previewLinesRef.current.forEach((line) => {
          seriesRef.current?.removePriceLine(line);
        });
        previewLinesRef.current = [];
        previewLineMetaRef.current = [];

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

  // Update chart colors when theme (isDark) changes
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const { backgroundColor, textColor, upColor, downColor } =
      getChartColors(isDark);
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
    });
    series.applyOptions({
      upColor,
      downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
  }, [isDark]);

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
        lines.slLevels.forEach((line) => series.removePriceLine(line));
        lines.tpLevels.forEach((line) => series.removePriceLine(line));
        currentLines.delete(tradeId);
      }
    });

    // Add or update price lines for each trade
    trades.forEach((trade, arrayIndex) => {
      // Calculate the display index (reverse order like in the UI)
      const displayIndex = trades.length - arrayIndex;
      const existingLines = currentLines.get(trade.id);

      if (existingLines) {
        // Update entry line
        existingLines.entry.applyOptions({
          lineVisible: trade.visible,
          axisLabelVisible: trade.visible,
          title: `#${displayIndex} Entry`,
        });

        // Skip updating price if currently dragging this trade
        const isDraggingThisTrade =
          isDraggingRef.current && dragTargetRef.current?.tradeId === trade.id;
        const dragTarget = dragTargetRef.current;

        // Sync SL levels
        const currentSlIds = new Set(trade.stopLossLevels.map((l) => l.id));
        
        // Remove SL lines that no longer exist
        existingLines.slLevels.forEach((line, levelId) => {
          if (!currentSlIds.has(levelId)) {
            series.removePriceLine(line);
            existingLines.slLevels.delete(levelId);
          }
        });
        
        // Add or update SL lines
        trade.stopLossLevels.forEach((level, levelIndex) => {
          const existingLine = existingLines.slLevels.get(level.id);
          const isDraggingThisLevel = isDraggingThisTrade && 
            dragTarget?.type === "sl" && 
            'levelId' in dragTarget && 
            dragTarget.levelId === level.id;
          const lineWidth = getLineWidthForLots(level.lots, trade.lots, !!level.locked);
          
          if (existingLine) {
            const options: any = {
              lineVisible: trade.visible,
              axisLabelVisible: trade.visible,
              lineWidth,
              lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
              title: `#${displayIndex} SL${trade.stopLossLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
            };
            if (!isDraggingThisLevel) {
              options.price = level.price;
            }
            existingLine.applyOptions(options);
          } else {
            const newLine = series.createPriceLine({
              price: level.price,
              color: trade.color,
              lineWidth,
              lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
              lineVisible: trade.visible,
              axisLabelVisible: true,
              title: `#${displayIndex} SL${trade.stopLossLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
            });
            existingLines.slLevels.set(level.id, newLine);
          }
        });

        // Sync TP levels
        const currentTpIds = new Set(trade.takeProfitLevels.map((l) => l.id));
        
        // Remove TP lines that no longer exist
        existingLines.tpLevels.forEach((line, levelId) => {
          if (!currentTpIds.has(levelId)) {
            series.removePriceLine(line);
            existingLines.tpLevels.delete(levelId);
          }
        });
        
        // Add or update TP lines
        trade.takeProfitLevels.forEach((level, levelIndex) => {
          const existingLine = existingLines.tpLevels.get(level.id);
          const isDraggingThisLevel = isDraggingThisTrade && 
            dragTarget?.type === "tp" && 
            'levelId' in dragTarget && 
            dragTarget.levelId === level.id;
          const lineWidth = getLineWidthForLots(level.lots, trade.lots, !!level.locked);
          
          if (existingLine) {
            const options: any = {
              lineVisible: trade.visible,
              axisLabelVisible: trade.visible,
              lineWidth,
              lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
              title: `#${displayIndex} TP${trade.takeProfitLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
            };
            if (!isDraggingThisLevel) {
              options.price = level.price;
            }
            existingLine.applyOptions(options);
          } else {
            const newLine = series.createPriceLine({
              price: level.price,
              color: trade.color,
              lineWidth,
              lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
              lineVisible: trade.visible,
              axisLabelVisible: true,
              title: `#${displayIndex} TP${trade.takeProfitLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
            });
            existingLines.tpLevels.set(level.id, newLine);
          }
        });
      } else {
        // Create new price lines for this trade
        const entryLine = series.createPriceLine({
          price: trade.entryPrice,
          color: trade.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: trade.visible,
          axisLabelVisible: true,
          title: `#${displayIndex} Entry`,
        });

        const slLevels = new Map<string, IPriceLine>();
        trade.stopLossLevels.forEach((level, levelIndex) => {
          const lineWidth = getLineWidthForLots(level.lots, trade.lots, !!level.locked);
          const line = series.createPriceLine({
            price: level.price,
            color: trade.color,
            lineWidth,
            lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: `#${displayIndex} SL${trade.stopLossLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
          });
          slLevels.set(level.id, line);
        });

        const tpLevels = new Map<string, IPriceLine>();
        trade.takeProfitLevels.forEach((level, levelIndex) => {
          const lineWidth = getLineWidthForLots(level.lots, trade.lots, !!level.locked);
          const line = series.createPriceLine({
            price: level.price,
            color: trade.color,
            lineWidth,
            lineStyle: level.locked ? LineStyle.Dashed : LineStyle.Dotted,
            lineVisible: trade.visible,
            axisLabelVisible: true,
            title: `#${displayIndex} TP${trade.takeProfitLevels.length > 1 ? levelIndex + 1 : ""}${formatLotsLabelForTotal(level.lots, trade.lots)}`,
          });
          tpLevels.set(level.id, line);
        });

        currentLines.set(trade.id, {
          entry: entryLine,
          slLevels,
          tpLevels,
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
    previewLineMetaRef.current = [];

    // Add new preview lines if preview trade exists
    if (previewTrade) {
      const newLines: IPriceLine[] = [];
      const newMeta: Array<{ type: "sl" | "tp"; levelIndex: number }> = [];

      const previewTotalLots = previewTrade.stopLossLevels.reduce((sum, level) => sum + level.lots, 0)
        + previewTrade.takeProfitLevels.reduce((sum, level) => sum + level.lots, 0);

      // Stop loss lines - Red with level numbers
      previewTrade.stopLossLevels.forEach((level, index) => {
        const lineWidth = getLineWidthForLots(level.lots, previewTotalLots, !!level.locked);
        const slLine = series.createPriceLine({
          price: level.price,
          color: "#ef4444",
          lineWidth,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: previewTrade.stopLossLevels.length > 1
            ? `SL${index + 1}${formatLotsLabelForTotal(level.lots, previewTotalLots)} (Preview)`
            : `SL${formatLotsLabelForTotal(level.lots, previewTotalLots)} (Preview)`,
        });
        newLines.push(slLine);
        newMeta.push({ type: "sl", levelIndex: index });
      });

      // Take profit lines - Green with level numbers
      previewTrade.takeProfitLevels.forEach((level, index) => {
        const lineWidth = getLineWidthForLots(level.lots, previewTotalLots, !!level.locked);
        const tpLine = series.createPriceLine({
          price: level.price,
          color: "#10b981",
          lineWidth,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: previewTrade.takeProfitLevels.length > 1
            ? `TP${index + 1}${formatLotsLabelForTotal(level.lots, previewTotalLots)} (Preview)`
            : `TP${formatLotsLabelForTotal(level.lots, previewTotalLots)} (Preview)`,
        });
        newLines.push(tpLine);
        newMeta.push({ type: "tp", levelIndex: index });
      });

      previewLinesRef.current = newLines;
      previewLineMetaRef.current = newMeta;
    }
  }, [previewTrade]);

  return <div ref={chartContainerRef} className="h-full w-full" />;
}
