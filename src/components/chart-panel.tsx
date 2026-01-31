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
  /** Callback when placed trade SL/TP is dragged */
  onTradePriceUpdate?: (tradeId: number, lineType: "sl" | "tp", newPrice: number) => void;
  /** Callback when a trade should be highlighted */
  onTradeHighlight?: (tradeId: number | null) => void;
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

export function ChartPanel({ onPriceChange, trades = [], previewTrade = null, onSlPriceDrag, onTpPriceDrag, onTradePriceUpdate, onTradeHighlight }: ChartPanelProps = {}) {
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
  const dragOriginalStylesRef = useRef<Map<IPriceLine, { width: number; style: LineStyle }>>(new Map());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const onSlPriceDragRef = useRef(onSlPriceDrag);
  const onTpPriceDragRef = useRef(onTpPriceDrag);
  const onTradePriceUpdateRef = useRef(onTradePriceUpdate);
  const onTradeHighlightRef = useRef(onTradeHighlight);
  onSlPriceDragRef.current = onSlPriceDrag;
  onTpPriceDragRef.current = onTpPriceDrag;
  onTradePriceUpdateRef.current = onTradePriceUpdate;
  onTradeHighlightRef.current = onTradeHighlight;

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

    // Helper to apply visual feedback when drag starts
    const applyDragVisuals = (target: DragTarget) => {
      if (!target) return;
      
      dragOriginalStylesRef.current.clear();
      
      if (target.tradeId === "preview") {
        // For preview, highlight the dragged line
        const lineIndex = target.type === "sl" ? 0 : 1;
        const line = previewLinesRef.current[lineIndex];
        if (line) {
          const opts = line.options();
          dragOriginalStylesRef.current.set(line, { width: opts.lineWidth ?? 2, style: opts.lineStyle ?? LineStyle.Solid });
          line.applyOptions({ lineWidth: 4, lineStyle: LineStyle.Solid });
        }
      } else {
        // For placed trades, highlight all lines of the trade
        const tradeLines = priceLinesRef.current.get(target.tradeId);
        if (tradeLines) {
          // Highlight the dragged line more prominently
          const draggedLine = target.type === "sl" ? tradeLines.sl : tradeLines.tp;
          if (draggedLine) {
            const opts = draggedLine.options();
            dragOriginalStylesRef.current.set(draggedLine, { width: opts.lineWidth ?? 2, style: opts.lineStyle ?? LineStyle.Dotted });
            draggedLine.applyOptions({ lineWidth: 4, lineStyle: LineStyle.Solid });
          }
          
          // Highlight other lines of the same trade
          [tradeLines.entry, target.type === "sl" ? tradeLines.tp : tradeLines.sl].forEach(line => {
            if (line) {
              const opts = line.options();
              dragOriginalStylesRef.current.set(line, { width: opts.lineWidth ?? 2, style: opts.lineStyle ?? LineStyle.Dotted });
              line.applyOptions({ lineWidth: 3 });
            }
          });
        }
        
        // Highlight the trade in the card
        onTradeHighlightRef.current?.(target.tradeId);
      }
      
      // Create tooltip
      if (!tooltipRef.current && chartContainerRef.current) {
        const tooltip = document.createElement('div');
        tooltip.style.position = 'absolute';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '4px 8px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '12px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '1000';
        tooltip.style.fontFamily = 'monospace';
        chartContainerRef.current.appendChild(tooltip);
        tooltipRef.current = tooltip;
      }
    };
    
    // Helper to remove visual feedback when drag ends
    const removeDragVisuals = () => {
      // Restore original line styles
      dragOriginalStylesRef.current.forEach((original, line) => {
        line.applyOptions({ lineWidth: original.width, lineStyle: original.style });
      });
      dragOriginalStylesRef.current.clear();
      
      // Remove tooltip
      if (tooltipRef.current && chartContainerRef.current) {
        chartContainerRef.current.removeChild(tooltipRef.current);
        tooltipRef.current = null;
      }
      
      // Clear trade highlight
      onTradeHighlightRef.current?.(null);
    };

    // Mouse down handler to start dragging
    const handleMouseDown = (e: MouseEvent) => {
      if (!seriesRef.current || !chartContainerRef.current) return;
      
      const rect = chartContainerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      
      // Check preview lines first
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
      
      // Check all placed trade lines
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

    // Mouse move handler for dragging and hover cursor
    const handleMouseMove = (e: MouseEvent) => {
      if (!seriesRef.current || !chartContainerRef.current) return;
      
      const rect = chartContainerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const mouseX = e.clientX - rect.left;
      
      if (isDraggingRef.current && dragTargetRef.current) {
        // Convert Y coordinate to price
        const newPrice = seriesRef.current.coordinateToPrice(mouseY);
        if (newPrice !== null) {
          const target = dragTargetRef.current;
          
          if (target.tradeId === "preview") {
            // Update preview trade
            if (target.type === "sl") {
              onSlPriceDragRef.current?.(newPrice as number);
            } else {
              onTpPriceDragRef.current?.(newPrice as number);
            }
          } else {
            // Update placed trade
            onTradePriceUpdateRef.current?.(target.tradeId, target.type, newPrice as number);
            
            // Update the line immediately for visual feedback
            const lines = priceLinesRef.current.get(target.tradeId);
            if (lines) {
              const line = target.type === "sl" ? lines.sl : lines.tp;
              line?.applyOptions({ price: newPrice as number });
            }
          }
          
          // Update tooltip
          if (tooltipRef.current) {
            tooltipRef.current.textContent = `${target.type.toUpperCase()}: ${(newPrice as number).toFixed(5)}`;
            tooltipRef.current.style.left = `${mouseX + 10}px`;
            tooltipRef.current.style.top = `${mouseY - 10}px`;
          }
        }
      } else {
        // Update cursor based on hover
        let isNearAnyLine = false;
        
        // Check preview lines
        const previewLines = previewLinesRef.current;
        if (previewLines.length > 0) {
          const slLine = previewLines[0];
          const tpLine = previewLines[1];
          const slPrice = slLine?.options().price ?? null;
          const tpPrice = tpLine?.options().price ?? null;
          
          if (isNearPriceLine(mouseY, slPrice) || isNearPriceLine(mouseY, tpPrice)) {
            isNearAnyLine = true;
          }
        }
        
        // Check all placed trade lines
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

    // Mouse up handler to stop dragging
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        removeDragVisuals();
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
      
      // Cleanup tooltip if exists
      if (tooltipRef.current && container) {
        container.removeChild(tooltipRef.current);
        tooltipRef.current = null;
      }
      
      // Cleanup all price lines
      priceLinesRef.current.forEach((lines) => {
        if (lines.entry) seriesRef.current?.removePriceLine(lines.entry);
        if (lines.sl) seriesRef.current?.removePriceLine(lines.sl);
        if (lines.tp) seriesRef.current?.removePriceLine(lines.tp);
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
        existingLines.entry.applyOptions({ lineVisible: trade.visible, axisLabelVisible: trade.visible });
        if (existingLines.sl) {
          existingLines.sl.applyOptions({ 
            price: trade.stopLoss!,
            lineVisible: trade.visible, 
            axisLabelVisible: trade.visible 
          });
        }
        if (existingLines.tp) {
          existingLines.tp.applyOptions({ 
            price: trade.takeProfit!,
            lineVisible: trade.visible, 
            axisLabelVisible: trade.visible 
          });
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

        const slLine = trade.stopLoss !== null ? series.createPriceLine({
          price: trade.stopLoss,
          color: trade.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: trade.visible,
          axisLabelVisible: true,
          title: "SL",
        }) : null;

        const tpLine = trade.takeProfit !== null ? series.createPriceLine({
          price: trade.takeProfit,
          color: trade.color,
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: trade.visible,
          axisLabelVisible: true,
          title: "TP",
        }) : null;

        currentLines.set(trade.id, { entry: entryLine, sl: slLine, tp: tpLine });
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
