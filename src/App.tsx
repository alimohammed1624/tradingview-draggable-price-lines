import { ChartPanel } from "@/components/chart-panel";
import { PlaceTradesCard, type TradeLog, type PreviewTrade } from "@/components/place-trades-card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useState, useRef } from "react";

export function App() {
  const [livePrice, setLivePrice] = useState<number | undefined>(undefined);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [previewTrade, setPreviewTrade] = useState<PreviewTrade | null>(null);
  const [highlightedTradeId, setHighlightedTradeId] = useState<number | null>(null);
  
  // Refs to store the drag handlers from PlaceTradesCard
  const slDragHandlerRef = useRef<((price: number) => void) | null>(null);
  const tpDragHandlerRef = useRef<((price: number) => void) | null>(null);

  const handleTradePlaced = (trade: TradeLog) => {
    console.log("Trade placed:", trade);
    setTrades((prev) => [...prev, trade]);
  };

  const handleTradeVisibilityChange = (tradeId: number, visible: boolean) => {
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId ? { ...trade, visible } : trade
      )
    );
  };
  
  const handleTradePriceUpdate = (tradeId: number, lineType: "sl" | "tp", newPrice: number) => {
    setTrades((prev) =>
      prev.map((trade) =>
        trade.id === tradeId
          ? {
              ...trade,
              [lineType === "sl" ? "stopLoss" : "takeProfit"]: newPrice,
            }
          : trade
      )
    );
  };

  return (
    <div className="h-screen w-screen">
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={70}>
          <ChartPanel 
            onPriceChange={setLivePrice} 
            trades={trades} 
            previewTrade={previewTrade}
            onSlPriceDrag={(price) => slDragHandlerRef.current?.(price)}
            onTpPriceDrag={(price) => tpDragHandlerRef.current?.(price)}
            onTradePriceUpdate={handleTradePriceUpdate}
            onTradeHighlight={setHighlightedTradeId}
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
              onSlDragHandlerReady={(handler) => { slDragHandlerRef.current = handler; }}
              onTpDragHandlerReady={(handler) => { tpDragHandlerRef.current = handler; }}
              trades={trades}
              highlightedTradeId={highlightedTradeId}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
