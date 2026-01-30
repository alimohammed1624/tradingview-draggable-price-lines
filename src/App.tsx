import { ChartPanel } from "@/components/chart-panel";
import { PlaceTradesCard } from "@/components/place-trades-card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useState } from "react";

export function App() {
  const [livePrice, setLivePrice] = useState<number | undefined>(undefined);

  return (
    <div className="h-screen w-screen">
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={70}>
          <ChartPanel onPriceChange={setLivePrice} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={30}>
          <div className="h-full overflow-auto p-4">
            <PlaceTradesCard livePrice={livePrice} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
