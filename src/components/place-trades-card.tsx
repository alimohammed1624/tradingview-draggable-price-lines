"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as React from "react";

const TRADE_COLORS = [
  "#3b82f6", // blue
  "#a855f7", // purple (changed from green)
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
];

const LOTS_MIN = 0.1;
const LOTS_MAX = 5;
const LOTS_STEP = 0.01;
const SL_TP_PERCENT_MIN = 1;
const SL_TP_PERCENT_MAX = 500;
const SL_TP_PERCENT_STEP = 0.1;

function roundLots(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.min(LOTS_MAX, Math.max(LOTS_MIN, rounded));
}

function clampPercent(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(SL_TP_PERCENT_MAX, Math.max(SL_TP_PERCENT_MIN, rounded));
}

function clampPrice(value: number): number {
  return Math.max(0, value);
}

type Side = "buy" | "sell";

export type TradeLog = {
  id: number;
  timestamp: number;
  side: Side;
  lots: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  color: string;
  visible: boolean;
};

export type PreviewTrade = {
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

export type PlaceTradesCardProps = {
  /** TradingView chart's current live price; current price field is disabled and read-only and shows this value */
  livePrice?: number;
  /** Callback when a trade is placed */
  onTradePlaced?: (trade: TradeLog) => void;
  /** List of placed trades to display */
  trades?: TradeLog[];
  /** Callback when trade visibility is toggled */
  onTradeVisibilityChange?: (tradeId: number, visible: boolean) => void;
  /** Callback when preview trade changes */
  onPreviewTradeChange?: (preview: PreviewTrade | null) => void;
  /** Registers the SL price drag handler */
  onSlDragHandlerReady?: (handler: (price: number) => void) => void;
  /** Registers the TP price drag handler */
  onTpDragHandlerReady?: (handler: (price: number) => void) => void;
};

export function PlaceTradesCard({ 
  livePrice, 
  onTradePlaced, 
  trades = [], 
  onTradeVisibilityChange,
  onPreviewTradeChange,
  onSlDragHandlerReady,
  onTpDragHandlerReady
}: PlaceTradesCardProps = {}) {
  const [lots, setLots] = React.useState(0.1);
  const [side, setSide] = React.useState<Side>("buy");
  const [currentPrice, setCurrentPrice] = React.useState(1.0);
  const [slTpEnabled, setSlTpEnabled] = React.useState(false);
  const [slPercent, setSlPercent] = React.useState(1);
  const [tpPercent, setTpPercent] = React.useState(1);

  const effectivePrice = livePrice ?? currentPrice;

  const lotsDisplay = Number(lots.toFixed(2));
  const lotsLabel = lotsDisplay === 1 ? "lot" : "lots";

  // SL/TP prices from effective (live or manual) price and %; cap at 0.00
  const slPrice = clampPrice(
    side === "buy"
      ? effectivePrice * (1 - slPercent / 100)
      : effectivePrice * (1 + slPercent / 100),
  );
  const tpPrice = clampPrice(
    side === "buy"
      ? effectivePrice * (1 + tpPercent / 100)
      : effectivePrice * (1 - tpPercent / 100),
  );

  // Cap % so price never goes below 0: BUY SL and SELL TP max at 100%
  const slPercentMax = side === "buy" ? 100 : SL_TP_PERCENT_MAX;
  const tpPercentMax = side === "sell" ? 100 : SL_TP_PERCENT_MAX;
  const slPercentCapped = Math.min(slPercent, slPercentMax);
  const tpPercentCapped = Math.min(tpPercent, tpPercentMax);

  React.useEffect(() => {
    if (slPercent > slPercentMax) setSlPercent(slPercentMax);
    if (tpPercent > tpPercentMax) setTpPercent(tpPercentMax);
  }, [side]);

  // Update preview trade whenever relevant state changes
  React.useEffect(() => {
    if (livePrice === undefined) {
      onPreviewTradeChange?.(null);
      return;
    }
    onPreviewTradeChange?.({
      entryPrice: effectivePrice,
      stopLoss: slTpEnabled ? slPrice : null,
      takeProfit: slTpEnabled ? tpPrice : null,
    });
  }, [effectivePrice, slPrice, tpPrice, slTpEnabled, livePrice, onPreviewTradeChange]);

  const setSlPercentFromPrice = React.useCallback((price: number) => {
    if (effectivePrice <= 0) return;
    const pct =
      side === "buy"
        ? ((effectivePrice - price) / effectivePrice) * 100
        : ((price - effectivePrice) / effectivePrice) * 100;
    setSlPercent(Math.min(clampPercent(pct), slPercentMax));
  }, [effectivePrice, side, slPercentMax]);

  const setTpPercentFromPrice = React.useCallback((price: number) => {
    if (effectivePrice <= 0) return;
    const pct =
      side === "buy"
        ? ((price - effectivePrice) / effectivePrice) * 100
        : ((effectivePrice - price) / effectivePrice) * 100;
    setTpPercent(Math.min(clampPercent(pct), tpPercentMax));
  }, [effectivePrice, side, tpPercentMax]);

  // Register SL price drag handler with parent
  React.useEffect(() => {
    onSlDragHandlerReady?.(setSlPercentFromPrice);
  }, [onSlDragHandlerReady, setSlPercentFromPrice]);

  // Register TP price drag handler with parent
  React.useEffect(() => {
    onTpDragHandlerReady?.(setTpPercentFromPrice);
  }, [onTpDragHandlerReady, setTpPercentFromPrice]);

  const actionLabel = `${side === "buy" ? "BUY" : "SELL"} ${lotsDisplay} ${lotsLabel}${slTpEnabled ? ` [SL: ${slPrice.toFixed(4)}, TP: ${tpPrice.toFixed(4)}]` : ""}`;

  const handlePlaceTrade = () => {
    const now = Date.now();
    const trade: TradeLog = {
      id: now,
      timestamp: now,
      side,
      lots,
      entryPrice: effectivePrice,
      stopLoss: slTpEnabled ? slPrice : null,
      takeProfit: slTpEnabled ? tpPrice : null,
      color: TRADE_COLORS[trades.length % TRADE_COLORS.length],
      visible: true,
    };
    onTradePlaced?.(trade);
    setSlTpEnabled(false);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Place trade</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 1. Lots: input group with slider + input */}
        <div className="space-y-2">
          <Label>Lots</Label>
          <InputGroup className={cn("flex-col h-auto gap-2 py-2 px-2")}>
            <Slider
              min={LOTS_MIN}
              max={LOTS_MAX}
              step={LOTS_STEP}
              value={[lots]}
              onValueChange={([v]) => setLots(roundLots(v))}
            />
            <InputGroupInput
              type="number"
              min={LOTS_MIN}
              max={LOTS_MAX}
              step={LOTS_STEP}
              value={Number(lots.toFixed(2))}
              onChange={(e) =>
                setLots(roundLots(Number(e.target.value) || LOTS_MIN))
              }
            />
          </InputGroup>
        </div>

        {/* 2. BUY / SELL button group */}
        <div className="space-y-2">
          <Label className="sr-only">Side</Label>
          <ButtonGroup orientation="horizontal" className="w-full">
            <Button
              type="button"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white border-green-700 dark:bg-green-700 dark:hover:bg-green-600"
              onClick={() => setSide("buy")}
            >
              BUY
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white border-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              onClick={() => setSide("sell")}
            >
              SELL
            </Button>
          </ButtonGroup>
        </div>

        {/* 3. SL/TP checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="sl-tp"
            checked={slTpEnabled}
            onCheckedChange={(checked) => setSlTpEnabled(checked === true)}
          />
          <Label htmlFor="sl-tp" className="cursor-pointer text-sm font-medium">
            SL/TP
          </Label>
        </div>

        {/* 3.1 & 3.2 SL and TP input groups when checked */}
        {slTpEnabled && (
          <div className="flex flex-col gap-4 pl-6 border-l-2 border-muted">
            <div className="space-y-2">
              <Label>Current price</Label>
              <Input
                type="number"
                min={0}
                step={0.0001}
                value={livePrice ?? ""}
                placeholder="—"
                readOnly
                disabled
                aria-readonly
              />
            </div>
            <div className="space-y-2">
              <Label>SL (% from price)</Label>
              <InputGroup className={cn("flex-col h-auto gap-2 py-2 px-2")}>
                <Slider
                  min={SL_TP_PERCENT_MIN}
                  max={slPercentMax}
                  step={SL_TP_PERCENT_STEP}
                  value={[slPercentCapped]}
                  onValueChange={([v]) =>
                    setSlPercent(Math.min(clampPercent(v), slPercentMax))
                  }
                />
                <div className="flex items-center gap-2 w-full">
                  <InputGroupInput
                    type="number"
                    min={SL_TP_PERCENT_MIN}
                    max={slPercentMax}
                    step={SL_TP_PERCENT_STEP}
                    value={slPercentCapped}
                    onChange={(e) =>
                      setSlPercent(
                        Math.min(
                          clampPercent(Number(e.target.value) || 1),
                          slPercentMax,
                        ),
                      )
                    }
                  />
                  <InputGroupText>%</InputGroupText>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">
                    SL price
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.0001}
                    value={slPrice.toFixed(4)}
                    onChange={(e) =>
                      setSlPercentFromPrice(
                        clampPrice(Number(e.target.value) || 0),
                      )
                    }
                  />
                </div>
              </InputGroup>
            </div>
            <div className="space-y-2">
              <Label>TP (% from price)</Label>
              <InputGroup className={cn("flex-col h-auto gap-2 py-2 px-2")}>
                <Slider
                  min={SL_TP_PERCENT_MIN}
                  max={tpPercentMax}
                  step={SL_TP_PERCENT_STEP}
                  value={[tpPercentCapped]}
                  onValueChange={([v]) =>
                    setTpPercent(Math.min(clampPercent(v), tpPercentMax))
                  }
                />
                <div className="flex items-center gap-2 w-full">
                  <InputGroupInput
                    type="number"
                    min={SL_TP_PERCENT_MIN}
                    max={tpPercentMax}
                    step={SL_TP_PERCENT_STEP}
                    value={tpPercentCapped}
                    onChange={(e) =>
                      setTpPercent(
                        Math.min(
                          clampPercent(Number(e.target.value) || 1),
                          tpPercentMax,
                        ),
                      )
                    }
                  />
                  <InputGroupText>%</InputGroupText>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">
                    TP price
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.0001}
                    value={tpPrice.toFixed(4)}
                    onChange={(e) =>
                      setTpPercentFromPrice(
                        clampPrice(Number(e.target.value) || 0),
                      )
                    }
                  />
                </div>
              </InputGroup>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button type="button" className="w-full" onClick={handlePlaceTrade}>
          {actionLabel}
        </Button>
        {trades.length > 0 && (
          <div className="w-full mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Recent Trades</div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {trades.slice().reverse().map((trade) => (
                <div key={trade.id} className="text-xs p-2 rounded border border-border bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-sm" 
                        style={{ backgroundColor: trade.color }}
                      />
                      <span className={cn(
                        "font-semibold uppercase",
                        trade.side === "buy" ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
                      )}>
                        {trade.side}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{trade.lots} lots</span>
                      <Switch 
                        checked={trade.visible}
                        onCheckedChange={(checked) => onTradeVisibilityChange?.(trade.id, checked)}
                        className="scale-75"
                      />
                    </div>
                  </div>
                  <div className="mt-1 space-y-0.5 text-muted-foreground">
                    <div>Entry: {trade.entryPrice.toFixed(5)}</div>
                    {trade.stopLoss && <div>SL: {trade.stopLoss.toFixed(5)}</div>}
                    {trade.takeProfit && <div>TP: {trade.takeProfit.toFixed(5)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
