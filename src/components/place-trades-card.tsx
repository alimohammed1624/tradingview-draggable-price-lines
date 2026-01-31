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
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconCheck, IconEdit, IconTrash } from "@tabler/icons-react";
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
] as const;

const LOTS_MIN = 0.1;
const LOTS_MAX = 5;
const LOTS_STEP = 0.01;

function roundLots(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.min(LOTS_MAX, Math.max(LOTS_MIN, rounded));
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
  color?: string;
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
  /** Callback to remove SL/TP from a trade */
  onRemoveSlTp?: (tradeId: number, type: "sl" | "tp") => void;
  /** Callback when trade SL/TP is updated */
  onTradePriceUpdate?: (
    tradeId: number,
    lineType: "sl" | "tp",
    newPrice: number,
  ) => void;
  /** Current data source: simulated (default) or live EURUSD */
  dataSource?: "simulated" | "live";
  /** Callback when data source is changed */
  onDataSourceChange?: (source: "simulated" | "live") => void;
};

export function PlaceTradesCard({
  livePrice,
  onTradePlaced,
  trades = [],
  onTradeVisibilityChange,
  onPreviewTradeChange,
  onSlDragHandlerReady,
  onTpDragHandlerReady,
  onRemoveSlTp,
  onTradePriceUpdate,
  dataSource = "simulated",
  onDataSourceChange,
}: PlaceTradesCardProps) {
  const [lots, setLots] = React.useState(0.1);
  const [side, setSide] = React.useState<Side>("buy");
  const [currentPrice, _setCurrentPrice] = React.useState(1.0);
  const [slEnabled, setSlEnabled] = React.useState(false);
  const [tpEnabled, setTpEnabled] = React.useState(false);
  const [slSliderValue, setSlSliderValue] = React.useState(33.33);
  const [tpSliderValue, setTpSliderValue] = React.useState(33.33);
  const [editingTradeId, setEditingTradeId] = React.useState<number | null>(
    null,
  );
  const [addingSlTp, setAddingSlTp] = React.useState<{
    tradeId: number;
    type: "sl" | "tp";
    sliderValue: number;
  } | null>(null);

  const effectivePrice = livePrice ?? currentPrice;

  // Convert linear slider value (0-100) to logarithmic percentage (0.1-100)
  const sliderToPercent = React.useCallback((sliderValue: number): number => {
    const minPercent = 0.1;
    const maxPercent = 100;
    const ratio = maxPercent / minPercent;
    return minPercent * Math.pow(ratio, sliderValue / 100);
  }, []);

  // Convert logarithmic percentage (0.1-100) to linear slider value (0-100)
  const percentToSlider = React.useCallback((percent: number): number => {
    const minPercent = 0.1;
    const maxPercent = 100;
    const ratio = maxPercent / minPercent;
    return (Math.log(percent / minPercent) / Math.log(ratio)) * 100;
  }, []);

  // Calculate percentages from slider values
  const slPercent = sliderToPercent(slSliderValue);
  const tpPercent = sliderToPercent(tpSliderValue);

  // Calculate SL/TP price from entry price and percentage
  const calculateSlTpPrice = React.useCallback(
    (
      entryPrice: number,
      tradeSide: Side,
      type: "sl" | "tp",
      percent: number,
    ) => {
      const multiplier = percent / 100;
      if (type === "sl") {
        return tradeSide === "buy"
          ? entryPrice * (1 - multiplier)
          : entryPrice * (1 + multiplier);
      } else {
        return tradeSide === "buy"
          ? entryPrice * (1 + multiplier)
          : entryPrice * (1 - multiplier);
      }
    },
    [],
  );

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

  // Uncheck SL/TP when entering edit mode
  React.useEffect(() => {
    if (addingSlTp !== null) {
      setSlEnabled(false);
      setTpEnabled(false);
    }
  }, [addingSlTp]);

  // Update preview trade whenever relevant state changes
  React.useEffect(() => {
    if (livePrice === undefined) {
      onPreviewTradeChange?.(null);
      return;
    }
    onPreviewTradeChange?.({
      entryPrice: effectivePrice,
      stopLoss: slEnabled ? slPrice : null,
      takeProfit: tpEnabled ? tpPrice : null,
    });
  }, [
    effectivePrice,
    slPrice,
    tpPrice,
    slEnabled,
    tpEnabled,
    livePrice,
    onPreviewTradeChange,
  ]);

  // Update preview for adding SL/TP - only show the line being added
  React.useEffect(() => {
    if (addingSlTp) {
      const trade = trades.find((t) => t.id === addingSlTp.tradeId);
      if (trade) {
        const actualPercent = sliderToPercent(addingSlTp.sliderValue);
        const price = calculateSlTpPrice(
          trade.entryPrice,
          trade.side,
          addingSlTp.type,
          actualPercent,
        );
        onPreviewTradeChange?.({
          entryPrice: trade.entryPrice,
          stopLoss: addingSlTp.type === "sl" ? price : null,
          takeProfit: addingSlTp.type === "tp" ? price : null,
          color: trade.color,
        });
      }
    } else if (!slEnabled && !tpEnabled && livePrice === undefined) {
      onPreviewTradeChange?.(null);
    }
  }, [
    addingSlTp,
    trades,
    onPreviewTradeChange,
    slEnabled,
    tpEnabled,
    livePrice,
    sliderToPercent,
    calculateSlTpPrice,
  ]);

  const setSlPercentFromPrice = React.useCallback(
    (price: number) => {
      if (effectivePrice <= 0) return;
      const pct =
        side === "buy"
          ? ((effectivePrice - price) / effectivePrice) * 100
          : ((price - effectivePrice) / effectivePrice) * 100;
      const clampedPct = Math.max(0.1, Math.min(100, pct));
      setSlSliderValue(percentToSlider(clampedPct));
    },
    [effectivePrice, side, percentToSlider],
  );

  const setTpPercentFromPrice = React.useCallback(
    (price: number) => {
      if (effectivePrice <= 0) return;
      const pct =
        side === "buy"
          ? ((price - effectivePrice) / effectivePrice) * 100
          : ((effectivePrice - price) / effectivePrice) * 100;
      const clampedPct = Math.max(0.1, Math.min(100, pct));
      setTpSliderValue(percentToSlider(clampedPct));
    },
    [effectivePrice, side, percentToSlider],
  );

  // Create drag handler for edit mode that updates slider based on dragged price
  const createEditModeDragHandler = React.useCallback(
    (type: "sl" | "tp") => {
      return (price: number) => {
        const trade = trades.find((t) => t.id === addingSlTp?.tradeId);
        if (!trade) return;

        // Calculate percentage from dragged price based on type
        const multiplier =
          type === "sl"
            ? (trade.side === "buy"
                ? trade.entryPrice - price
                : price - trade.entryPrice) / trade.entryPrice
            : (trade.side === "buy"
                ? price - trade.entryPrice
                : trade.entryPrice - price) / trade.entryPrice;

        const percent = Math.max(0.1, Math.min(100, multiplier * 100));
        setAddingSlTp((prev) =>
          prev ? { ...prev, sliderValue: percentToSlider(percent) } : null,
        );
      };
    },
    [trades, addingSlTp?.tradeId, percentToSlider],
  );

  // Register SL price drag handler with parent
  React.useEffect(() => {
    const handler =
      addingSlTp?.type === "sl"
        ? createEditModeDragHandler("sl")
        : setSlPercentFromPrice;
    onSlDragHandlerReady?.(handler);
  }, [
    onSlDragHandlerReady,
    setSlPercentFromPrice,
    addingSlTp?.type,
    createEditModeDragHandler,
  ]);

  // Register TP price drag handler with parent
  React.useEffect(() => {
    const handler =
      addingSlTp?.type === "tp"
        ? createEditModeDragHandler("tp")
        : setTpPercentFromPrice;
    onTpDragHandlerReady?.(handler);
  }, [
    onTpDragHandlerReady,
    setTpPercentFromPrice,
    addingSlTp?.type,
    createEditModeDragHandler,
  ]);

  const slTpLabel = [
    slEnabled && `SL: ${slPrice.toFixed(4)}`,
    tpEnabled && `TP: ${tpPrice.toFixed(4)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const actionLabel = `${side === "buy" ? "BUY" : "SELL"} ${lotsDisplay} ${lotsLabel}${slTpLabel ? ` [${slTpLabel}]` : ""}`;

  const handlePlaceTrade = () => {
    const now = Date.now();
    const trade: TradeLog = {
      id: now,
      timestamp: now,
      side,
      lots,
      entryPrice: effectivePrice,
      stopLoss: slEnabled ? slPrice : null,
      takeProfit: tpEnabled ? tpPrice : null,
      color: TRADE_COLORS[trades.length % TRADE_COLORS.length],
      visible: true,
    };
    onTradePlaced?.(trade);
    setSlEnabled(false);
    setTpEnabled(false);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Place trade</CardTitle>
        {onDataSourceChange && (
          <>
            <div className="flex items-center justify-between gap-2 mt-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                {dataSource === "simulated" ? "Simulated" : "Live (EURUSD)"}
              </Label>
              <Switch
                checked={dataSource === "live"}
                onCheckedChange={(checked) =>
                  onDataSourceChange(checked ? "live" : "simulated")
                }
                aria-label="Toggle live EURUSD data"
              />
            </div>
            {dataSource === "live" && !import.meta.env.VITE_POLYGON_API_KEY && (
              <p className="text-xs text-muted-foreground mt-1">
                Set VITE_POLYGON_API_KEY for live data.
              </p>
            )}
          </>
        )}
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

        {/* 3. Take Profit checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="tp"
            checked={tpEnabled}
            onCheckedChange={(checked) => setTpEnabled(checked === true)}
          />
          <Label htmlFor="tp" className="cursor-pointer text-sm font-medium">
            Take Profit
          </Label>
        </div>

        {/* 3.1 TP section with logarithmic slider */}
        {tpEnabled && (
          <div className="space-y-2 pl-6 border-l-2 border-muted">
            <div className="flex items-center justify-between">
              <Label>Distance: {tpPercent.toFixed(2)}%</Label>
              <span className="text-sm text-muted-foreground">
                {tpPrice.toFixed(5)}
              </span>
            </div>
            <Slider
              value={[tpSliderValue]}
              min={0}
              max={100}
              step={0.01}
              onValueChange={([value]) => setTpSliderValue(value)}
            />
          </div>
        )}

        {/* 4. Stop Loss checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="sl"
            checked={slEnabled}
            onCheckedChange={(checked) => setSlEnabled(checked === true)}
          />
          <Label htmlFor="sl" className="cursor-pointer text-sm font-medium">
            Stop Loss
          </Label>
        </div>

        {/* 4.1 SL section with logarithmic slider */}
        {slEnabled && (
          <div className="space-y-2 pl-6 border-l-2 border-muted">
            <div className="flex items-center justify-between">
              <Label>Distance: {slPercent.toFixed(2)}%</Label>
              <span className="text-sm text-muted-foreground">
                {slPrice.toFixed(5)}
              </span>
            </div>
            <Slider
              value={[slSliderValue]}
              min={0}
              max={100}
              step={0.01}
              onValueChange={([value]) => setSlSliderValue(value)}
            />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button type="button" className="w-full" onClick={handlePlaceTrade}>
          {actionLabel}
        </Button>
        {trades.length > 0 && (
          <div className="w-full mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Recent Trades
            </div>
            <div className="space-y-1.5 max-h-[calc(100vh-25rem)] overflow-y-auto">
              {trades
                .slice()
                .reverse()
                .map((trade) => (
                  <div
                    key={trade.id}
                    className="text-xs p-2 rounded border border-border bg-muted/30"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm"
                          style={{ backgroundColor: trade.color }}
                        />
                        <span
                          className={cn(
                            "font-semibold uppercase",
                            trade.side === "buy"
                              ? "text-green-600 dark:text-green-500"
                              : "text-red-600 dark:text-red-500",
                          )}
                        >
                          {trade.side}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {trade.lots} lots
                        </span>
                        <Switch
                          checked={trade.visible}
                          onCheckedChange={(checked) =>
                            onTradeVisibilityChange?.(trade.id, checked)
                          }
                          className="scale-75"
                        />
                      </div>
                    </div>
                    <div className="mt-1 space-y-0.5 text-muted-foreground">
                      <div>Entry: {trade.entryPrice.toFixed(5)}</div>
                      {editingTradeId === trade.id ? (
                        <>
                          {trade.stopLoss && (
                            <div className="flex items-center justify-between">
                              <span>SL: {trade.stopLoss.toFixed(5)}</span>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                                      onClick={() => {
                                        onRemoveSlTp?.(trade.id, "sl");
                                      }}
                                    >
                                      <IconTrash size={10} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove SL</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                          {trade.takeProfit && (
                            <div className="flex items-center justify-between">
                              <span>TP: {trade.takeProfit.toFixed(5)}</span>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                                      onClick={() => {
                                        onRemoveSlTp?.(trade.id, "tp");
                                      }}
                                    >
                                      <IconTrash size={10} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove TP</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {trade.stopLoss && (
                            <div>SL: {trade.stopLoss.toFixed(5)}</div>
                          )}
                          {trade.takeProfit && (
                            <div>TP: {trade.takeProfit.toFixed(5)}</div>
                          )}
                        </>
                      )}
                    </div>

                    {editingTradeId === trade.id ? (
                      <div className="mt-2 space-y-2">
                        {addingSlTp?.tradeId === trade.id ? (
                          <div className="space-y-2">
                            <div className="text-xs font-medium">
                              {addingSlTp.type === "sl"
                                ? "Stop Loss"
                                : "Take Profit"}{" "}
                              (
                              {sliderToPercent(addingSlTp.sliderValue).toFixed(
                                1,
                              )}
                              %)
                            </div>
                            <Slider
                              value={[addingSlTp.sliderValue]}
                              onValueChange={(value) =>
                                setAddingSlTp({
                                  ...addingSlTp,
                                  sliderValue: value[0],
                                })
                              }
                              min={0}
                              max={100}
                              step={0.5}
                              className="w-full"
                            />
                            <div className="text-xs text-muted-foreground">
                              Price:{" "}
                              {calculateSlTpPrice(
                                trade.entryPrice,
                                trade.side,
                                addingSlTp.type,
                                sliderToPercent(addingSlTp.sliderValue),
                              ).toFixed(5)}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-6 text-xs flex-1"
                                onClick={() => {
                                  const actualPercent = sliderToPercent(
                                    addingSlTp.sliderValue,
                                  );
                                  const price = calculateSlTpPrice(
                                    trade.entryPrice,
                                    trade.side,
                                    addingSlTp.type,
                                    actualPercent,
                                  );
                                  if (addingSlTp.type === "sl") {
                                    onTradePriceUpdate?.(trade.id, "sl", price);
                                  } else {
                                    onTradePriceUpdate?.(trade.id, "tp", price);
                                  }
                                  setAddingSlTp(null);
                                  onPreviewTradeChange?.(null);
                                }}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs"
                                onClick={() => {
                                  setAddingSlTp(null);
                                  onPreviewTradeChange?.(null);
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            {!trade.stopLoss && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs flex-1"
                                onClick={() => {
                                  setAddingSlTp({
                                    tradeId: trade.id,
                                    type: "sl",
                                    sliderValue: percentToSlider(1),
                                  });
                                }}
                              >
                                Add SL
                              </Button>
                            )}

                            {!trade.takeProfit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs flex-1"
                                onClick={() => {
                                  setAddingSlTp({
                                    tradeId: trade.id,
                                    type: "tp",
                                    sliderValue: percentToSlider(1),
                                  });
                                }}
                              >
                                Add TP
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setEditingTradeId(null);
                                setAddingSlTp(null);
                                onPreviewTradeChange?.(null);
                              }}
                            >
                              <IconCheck size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs w-full mt-1"
                        onClick={() => {
                          // Close any open edit mode first
                          if (editingTradeId !== null) {
                            setAddingSlTp(null);
                            onPreviewTradeChange?.(null);
                          }
                          setEditingTradeId(trade.id);
                        }}
                      >
                        <IconEdit size={12} className="mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
