import { ChartPanel } from "@/components/chart-panel";
import { PlaceTradesCard, type TradeLog } from "@/components/place-trades-card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useState } from "react";

export function App() {
  const [livePrice, setLivePrice] = useState<number | undefined>(undefined);
  const [trades, setTrades] = useState<TradeLog[]>([]);

  const handleTradePlaced = (trade: TradeLog) => {
    console.log("Trade placed:", trade);
    setTrades((prev) => [...prev, trade]);
  };

  return (
    <div className="h-screen w-screen">
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={70}>
          <ChartPanel onPriceChange={setLivePrice} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30}>
          <div className="h-full overflow-auto p-4">
            <PlaceTradesCard 
              livePrice={livePrice} 
              onTradePlaced={handleTradePlaced}
              trades={trades}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
