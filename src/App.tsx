import { ChartPanel } from "@/components/chart-panel";
import {
  PlaceTradesCard,
  type PreviewTrade,
  type TradeLog,
} from "@/components/place-trades-card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toggle } from "@/components/ui/toggle";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";

// Temporary flag to enable/disable toast notifications
const ENABLE_TOASTS = false;

export function App() {
  const [livePrice, setLivePrice] = useState<number | undefined>(undefined);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [previewTrade, setPreviewTrade] = useState<PreviewTrade | null>(null);
  const [dataSource, setDataSource] = useState<"simulated" | "live">(
    "simulated",
  );

  // Theme state - initialize from localStorage or system preference
  const [isDark, setIsDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Apply theme to document and persist to localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  // Hard reset when switching data source: clear trades and preview so chart remounts clean
  useEffect(() => {
    setTrades([]);
    setPreviewTrade(null);
    setLivePrice(undefined);
  }, [dataSource]);

  // Refs to store the drag handlers from PlaceTradesCard
  const slDragHandlerRef = useRef<((price: number) => void) | null>(null);
  const tpDragHandlerRef = useRef<((price: number) => void) | null>(null);
  
  // Ref to track recent toast notifications to prevent duplicates
  const recentToastsRef = useRef<Record<string, number>>({});

  // Helper to calculate display index (trades are shown in reverse order)
  const getDisplayIndex = (tradeId: number) => {
    const index = trades.findIndex((t) => t.id === tradeId);
    return trades.length - index;
  };

  const handleTradePlaced = (trade: TradeLog) => {
    const tradeIndex = trades.length + 1;
    if (ENABLE_TOASTS) {
      toast.success(`Position #${tradeIndex} opened`, {
        description: `${trade.side.toUpperCase()} ${trade.lots} lots @ ${trade.entryPrice.toFixed(5)}`,
      });
    }
    setTrades((prev) => [...prev, trade]);
  };

  const handleTradeVisibilityChange = (tradeId: number, visible: boolean) => {
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId ? { ...trade, visible } : trade,
      ),
    );
  };

  const isValidSlTpPrice = (
    trade: TradeLog,
    lineType: "sl" | "tp",
    newPrice: number,
  ): boolean => {
    if (trade.side === "buy") {
      // For BUY: SL must be below entry, TP must be above entry
      if (lineType === "sl") return newPrice < trade.entryPrice;
      if (lineType === "tp") return newPrice > trade.entryPrice;
    } else {
      // For SELL: SL must be above entry, TP must be below entry
      if (lineType === "sl") return newPrice > trade.entryPrice;
      if (lineType === "tp") return newPrice < trade.entryPrice;
    }
    return false;
  };

  const handleTradePriceUpdate = (
    tradeId: number,
    lineType: "sl" | "tp",
    newPrice: number,
    isDragging: boolean = false,
  ) => {
    setTrades((prev) =>
      prev.map((trade) => {
        if (trade.id === tradeId && isValidSlTpPrice(trade, lineType, newPrice)) {
          // Show toast notification only when dragging ends, with deduplication
          if (!isDragging) {
            const toastKey = `${tradeId}-${lineType}`;
            const lastToastTime = recentToastsRef.current[toastKey] || 0;
            const now = Date.now();
            
            // Only show toast if more than 300ms has passed since the last one
            if (now - lastToastTime > 300) {
              recentToastsRef.current[toastKey] = now;
              if (ENABLE_TOASTS) {
                const displayIndex = getDisplayIndex(tradeId);
                const lineLabel = lineType === "sl" ? "SL" : "TP";
                toast.info(`Position #${displayIndex} ${lineLabel} updated`, {
                  description: `${lineLabel} set to ${newPrice.toFixed(5)}`,
                });
              }
            }
          }
          return {
            ...trade,
            [lineType === "sl" ? "stopLoss" : "takeProfit"]: newPrice,
          };
        }
        return trade;
      }),
    );
  };

  const handleRemoveSlTp = (tradeId: number, type: "sl" | "tp") => {
    const trade = trades.find((t) => t.id === tradeId);
    if (trade && ENABLE_TOASTS) {
      const displayIndex = getDisplayIndex(tradeId);
      const typeLabel = type === "sl" ? "SL" : "TP";
      toast.info(`Position #${displayIndex} ${typeLabel} removed`, {
        description: `${typeLabel} has been cleared`,
      });
    }
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId
          ? {
              ...trade,
              [type === "sl" ? "stopLoss" : "takeProfit"]: null,
            }
          : trade,
      ),
    );
  };

  const handleToggleLock = (
    tradeId: number,
    type: "sl" | "tp",
    locked: boolean,
  ) => {
    const trade = trades.find((t) => t.id === tradeId);
    if (trade && ENABLE_TOASTS) {
      const displayIndex = getDisplayIndex(tradeId);
      const lineLabel = type === "sl" ? "SL" : "TP";
      toast.info(`Position #${displayIndex} ${lineLabel} ${locked ? "locked" : "unlocked"}`, {
        description: `${lineLabel} is now ${locked ? "locked" : "unlocked"}`,
      });
    }
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId
          ? {
              ...trade,
              [type === "sl" ? "lockedSl" : "lockedTp"]: locked,
            }
          : trade,
      ),
    );
  };

  const handleTogglePositionLock = (tradeId: number, locked: boolean) => {
    const trade = trades.find((t) => t.id === tradeId);
    if (trade && ENABLE_TOASTS) {
      const displayIndex = getDisplayIndex(tradeId);
      toast.info(`Position #${displayIndex} ${locked ? "locked" : "unlocked"}`, {
        description: `All lines are now ${locked ? "locked" : "unlocked"}`,
      });
    }
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId
          ? {
              ...trade,
              lockedPosition: locked,
              lockedSl: locked,
              lockedTp: locked,
            }
          : trade,
      ),
    );
  };

  const handleCloseTrade = (tradeId: number) => {
    const trade = trades.find((t) => t.id === tradeId);
    if (trade && ENABLE_TOASTS) {
      const displayIndex = getDisplayIndex(tradeId);
      toast.success(`Position #${displayIndex} closed`, {
        description: `Trade closed`,
      });
    }
    setTrades((prev) => prev.filter((trade) => trade.id !== tradeId));
  };

  return (
    <div className="h-screen w-screen">
      <Toaster position="top-right" />
      {/* Theme Toggle Button */}
      <Toggle
        pressed={isDark}
        onPressedChange={setIsDark}
        aria-label="Toggle theme"
        className="fixed bottom-4 right-4 z-50 shadow-lg"
      >
        {isDark ? <IconMoon size={20} /> : <IconSun size={20} />}
      </Toggle>

      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={70}>
          <ChartPanel
            key={dataSource}
            onPriceChange={setLivePrice}
            trades={trades}
            previewTrade={previewTrade}
            onSlPriceDrag={(price) => slDragHandlerRef.current?.(price)}
            onTpPriceDrag={(price) => tpDragHandlerRef.current?.(price)}
            onTradePriceUpdate={handleTradePriceUpdate}
            dataSource={dataSource}
            isDark={isDark}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30}>
          <div className="h-full overflow-auto p-4">
            <PlaceTradesCard
              livePrice={livePrice}
              onTradePlaced={handleTradePlaced}
              onPreviewTradeChange={setPreviewTrade}
              onSlDragHandlerReady={(handler) => {
                slDragHandlerRef.current = handler;
              }}
              onTpDragHandlerReady={(handler) => {
                tpDragHandlerRef.current = handler;
              }}
              trades={trades}
              onRemoveSlTp={handleRemoveSlTp}
              onTradePriceUpdate={handleTradePriceUpdate}
              onToggleLock={handleToggleLock}
              onTogglePositionLock={handleTogglePositionLock}
              onCloseTrade={handleCloseTrade}
              dataSource={dataSource}
              onDataSourceChange={setDataSource}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
