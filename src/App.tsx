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

  const handleTradePlaced = (trade: TradeLog) => {
    setTrades((prev) => [...prev, trade]);
  };

  const handleTradeVisibilityChange = (tradeId: number, visible: boolean) => {
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId ? { ...trade, visible } : trade,
      ),
    );
  };

  const handleTradePriceUpdate = (
    tradeId: number,
    lineType: "sl" | "tp",
    newPrice: number,
  ) => {
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId
          ? {
              ...trade,
              [lineType === "sl" ? "stopLoss" : "takeProfit"]: newPrice,
            }
          : trade,
      ),
    );
  };

  const handleRemoveSlTp = (tradeId: number, type: "sl" | "tp") => {
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

  return (
    <div className="h-screen w-screen">
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
              onTradeVisibilityChange={handleTradeVisibilityChange}
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
