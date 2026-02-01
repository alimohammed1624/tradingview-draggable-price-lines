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
import { Input } from "@/components/ui/input";
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
import { IconLock, IconLockOpen, IconTrash, IconX } from "@tabler/icons-react";
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

function getTradeColor(index: number): string {
  return TRADE_COLORS[index % TRADE_COLORS.length];
}

type Side = "buy" | "sell";

// A single SL or TP level with its own price, number of lots to close, and lock state
export type SlTpLevel = {
  id: string;           // Unique level ID (e.g., "tp-1", "sl-1")
  price: number;        // Target price for this level
  lots: number;         // Number of lots to close at this level
  locked?: boolean;     // Whether this level is locked from dragging
};

// Helper to calculate remaining unallocated lots for a type
export function getRemainingLots(levels: SlTpLevel[], totalLots: number): number {
  const total = levels.reduce((sum, l) => sum + l.lots, 0);
  return Math.max(0, totalLots - total);
}

export type TradeLog = {
  id: number;
  timestamp: number;
  side: Side;
  lots: number;
  entryPrice: number;
  stopLossLevels: SlTpLevel[];    // Array of SL levels (usually 1, but can be more)
  takeProfitLevels: SlTpLevel[];  // Array of TP levels (multiple for partial closes)
  color: string;
  visible: boolean;
  lockedPosition?: boolean;
};

export type PreviewTrade = {
  entryPrice: number;
  stopLossLevels: SlTpLevel[];
  takeProfitLevels: SlTpLevel[];
  color?: string;
};

export type PlaceTradesCardProps = {
  /** TradingView chart's current live price; current price field is disabled and read-only and shows this value */
  livePrice?: number;
  /** Callback when a trade is placed */
  onTradePlaced?: (trade: TradeLog) => void;
  /** List of placed trades to display */
  trades?: TradeLog[];
  /** Callback when preview trade changes */
  onPreviewTradeChange?: (preview: PreviewTrade | null) => void;
  /** Registers the SL price drag handler */
  onSlDragHandlerReady?: (handler: (price: number, levelIndex: number) => void) => void;
  /** Registers the TP price drag handler */
  onTpDragHandlerReady?: (handler: (price: number, levelIndex: number) => void) => void;
  /** Callback to remove a specific level from a trade */
  onRemoveLevel?: (tradeId: number, type: "sl" | "tp", levelId: string) => void;
  /** Callback when trade level price is updated */
  onTradePriceUpdate?: (
    tradeId: number,
    lineType: "sl" | "tp",
    levelId: string,
    newPrice: number,
    isDragging?: boolean,
  ) => void;
  /** Callback when level lock state changes */
  onToggleLevelLock?: (tradeId: number, type: "sl" | "tp", levelId: string, locked: boolean) => void;
  /** Callback when level lots changes */
  onUpdateLevelLots?: (tradeId: number, type: "sl" | "tp", levelId: string, newLots: number) => void;
  /** Callback to add a new level */
  onAddLevel?: (tradeId: number, type: "sl" | "tp", price: number, lots: number) => void;
  /** Callback when position lock state changes */
  onTogglePositionLock?: (tradeId: number, locked: boolean) => void;
  /** Callback when a trade is closed */
  onCloseTrade?: (tradeId: number) => void;
  /** Current data source: simulated (default) or live EURUSD */
  dataSource?: "simulated" | "live";
  /** Callback when data source is changed */
  onDataSourceChange?: (source: "simulated" | "live") => void;
};

export function PlaceTradesCard({
  livePrice,
  onTradePlaced,
  trades = [],
  onPreviewTradeChange,
  onSlDragHandlerReady,
  onTpDragHandlerReady,
  onRemoveLevel,
  onTradePriceUpdate,
  onToggleLevelLock,
  onUpdateLevelLots,
  onAddLevel,
  onTogglePositionLock,
  onCloseTrade,
  dataSource = "simulated",
  onDataSourceChange,
}: PlaceTradesCardProps) {
  const [lots, setLots] = React.useState(0.1);
  const [side, setSide] = React.useState<Side>("buy");
  const [currentPrice, _setCurrentPrice] = React.useState(1.0);
  const [slEnabled, setSlEnabled] = React.useState(false);
  const [tpEnabled, setTpEnabled] = React.useState(false);

  // Multi-level SL/TP for position creation
  const [creationSlLevels, setCreationSlLevels] = React.useState<SlTpLevel[]>([]);
  const [creationTpLevels, setCreationTpLevels] = React.useState<SlTpLevel[]>([]);

  // Track slider values for creation levels: { levelId: sliderValue }
  const [creationSliders, setCreationSliders] = React.useState<Record<string, number>>({});

  // Track slider values for each trade's SL/TP levels: { tradeId: { levelId: sliderValue } }
  const [tradeSliders, setTradeSliders] = React.useState<Record<number, Record<string, number>>>({});

  const effectivePrice = livePrice ?? currentPrice;

  // Auto-create first level when enabling TP/SL with a default 2% distance
  React.useEffect(() => {
    if (tpEnabled && creationTpLevels.length === 0) {
      setCreationTpLevels([{
        id: `tp-1`,
        price: calculateSlTpPrice(effectivePrice, side, "tp", 2),
        lots: lots,
        locked: false,
      }]);
    }
  }, [tpEnabled, lots, effectivePrice, side]);

  React.useEffect(() => {
    if (slEnabled && creationSlLevels.length === 0) {
      setCreationSlLevels([{
        id: `sl-1`,
        price: calculateSlTpPrice(effectivePrice, side, "sl", 2),
        lots: lots,
        locked: false,
      }]);
    }
  }, [slEnabled, lots, effectivePrice, side]);

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

  // Calculate distance percentages from slider values (for price calculation)
  // NOTE: These are no longer used for the default SL/TP, but may be useful for reference
  // const slDistancePercent = sliderToPercent(slSliderValue);
  // const tpDistancePercent = sliderToPercent(tpSliderValue);

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

  const isValidSlTpPrice = React.useCallback(
    (trade: TradeLog, lineType: "sl" | "tp", newPrice: number): boolean => {
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
    },
    [],
  );

  // Sync tradeSliders with actual trade level prices when trades change
  React.useEffect(() => {
    setTradeSliders(prev => {
      const updated = { ...prev };
      let hasChanges = false;
      
      trades.forEach(trade => {
        if (!updated[trade.id]) {
          updated[trade.id] = {};
        }
        const tradeSliderValues = { ...updated[trade.id] };
        
        // Calculate slider values from SL levels
        trade.stopLossLevels.forEach(level => {
          const multiplier = trade.side === "buy"
            ? (trade.entryPrice - level.price) / trade.entryPrice
            : (level.price - trade.entryPrice) / trade.entryPrice;
          const percent = Math.max(0.1, Math.min(100, multiplier * 100));
          const sliderValue = percentToSlider(percent);
          
          if (prev[trade.id]?.[level.id] !== sliderValue) {
            tradeSliderValues[level.id] = sliderValue;
            hasChanges = true;
          }
        });
        
        // Calculate slider values from TP levels
        trade.takeProfitLevels.forEach(level => {
          const multiplier = trade.side === "buy"
            ? (level.price - trade.entryPrice) / trade.entryPrice
            : (trade.entryPrice - level.price) / trade.entryPrice;
          const percent = Math.max(0.1, Math.min(100, multiplier * 100));
          const sliderValue = percentToSlider(percent);
          
          if (prev[trade.id]?.[level.id] !== sliderValue) {
            tradeSliderValues[level.id] = sliderValue;
            hasChanges = true;
          }
        });
        
        updated[trade.id] = tradeSliderValues;
      });
      
      return hasChanges ? updated : prev;
    });
  }, [trades, percentToSlider]);

  // Sync creationSliders with creation level prices
  React.useEffect(() => {
    setCreationSliders(prev => {
      const updated = { ...prev };
      let hasChanges = false;

      creationSlLevels.forEach(level => {
        const multiplier = side === "buy"
          ? (effectivePrice - level.price) / effectivePrice
          : (level.price - effectivePrice) / effectivePrice;
        const percent = Math.max(0.1, Math.min(100, multiplier * 100));
        const sliderValue = percentToSlider(percent);
        if (prev[level.id] !== sliderValue) {
          updated[level.id] = sliderValue;
          hasChanges = true;
        }
      });

      creationTpLevels.forEach(level => {
        const multiplier = side === "buy"
          ? (level.price - effectivePrice) / effectivePrice
          : (effectivePrice - level.price) / effectivePrice;
        const percent = Math.max(0.1, Math.min(100, multiplier * 100));
        const sliderValue = percentToSlider(percent);
        if (prev[level.id] !== sliderValue) {
          updated[level.id] = sliderValue;
          hasChanges = true;
        }
      });

      return hasChanges ? updated : prev;
    });
  }, [creationSlLevels, creationTpLevels, effectivePrice, side, percentToSlider]);

  const lotsDisplay = Number(lots.toFixed(2));
  const lotsLabel = lotsDisplay === 1 ? "lot" : "lots";

  // SL/TP prices are now computed from creation levels
  // The old single-level preview is no longer used
  const slPrice = creationSlLevels.length > 0 ? creationSlLevels[0].price : effectivePrice * 0.98;
  const tpPrice = creationTpLevels.length > 0 ? creationTpLevels[0].price : effectivePrice * 1.02;

  // Remove old preview trade update effect - replaced by the one using creation levels below



  const setSlPercentFromPrice = React.useCallback(
    (price: number, levelIndex: number) => {
      if (effectivePrice <= 0) return;
      const newLevels = [...creationSlLevels];
      if (newLevels[levelIndex]) {
        newLevels[levelIndex] = {
          ...newLevels[levelIndex],
          price,
        };
        setCreationSlLevels(newLevels);
      }
    },
    [effectivePrice, creationSlLevels],
  );

  const setTpPercentFromPrice = React.useCallback(
    (price: number, levelIndex: number) => {
      if (effectivePrice <= 0) return;
      const newLevels = [...creationTpLevels];
      if (newLevels[levelIndex]) {
        newLevels[levelIndex] = {
          ...newLevels[levelIndex],
          price,
        };
        setCreationTpLevels(newLevels);
      }
    },
    [effectivePrice, creationTpLevels],
  );



  // Register SL price drag handler with parent
  React.useEffect(() => {
    onSlDragHandlerReady?.(setSlPercentFromPrice);
  }, [onSlDragHandlerReady, setSlPercentFromPrice]);

  // Register TP price drag handler with parent
  React.useEffect(() => {
    onTpDragHandlerReady?.(setTpPercentFromPrice);
  }, [onTpDragHandlerReady, setTpPercentFromPrice]);

  // Update preview trade whenever creation levels change
  React.useEffect(() => {
    if (tpEnabled || slEnabled) {
      onPreviewTradeChange?.({
        entryPrice: effectivePrice,
        stopLossLevels: creationSlLevels,
        takeProfitLevels: creationTpLevels,
        color: TRADE_COLORS[0],
      });
    } else {
      onPreviewTradeChange?.(null);
    }
  }, [tpEnabled, slEnabled, creationTpLevels, creationSlLevels, effectivePrice, onPreviewTradeChange]);

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
      stopLossLevels: creationSlLevels,
      takeProfitLevels: creationTpLevels,
      color: getTradeColor(trades.length),
      visible: true,
    };
    onTradePlaced?.(trade);
    setSlEnabled(false);
    setTpEnabled(false);
    setCreationSlLevels([]);
    setCreationTpLevels([]);
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
              type="text"
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
              onClick={() => {
                setSide("buy");
                setSlEnabled(false);
                setTpEnabled(false);
                setCreationSlLevels([]);
                setCreationTpLevels([]);
                setCreationSliders({});
              }}
            >
              BUY
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white border-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              onClick={() => {
                setSide("sell");
                setSlEnabled(false);
                setTpEnabled(false);
                setCreationSlLevels([]);
                setCreationTpLevels([]);
                setCreationSliders({});
              }}
            >
              SELL
            </Button>
          </ButtonGroup>
        </div>

        {/* 3. Take Profit section */}
        {!tpEnabled ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setTpEnabled(true)}
          >
            Add TP
          </Button>
        ) : (
          <div className="space-y-2 pl-6 border-l-2 border-green-500/30">
            <div className="text-xs font-medium text-foreground">Take Profit</div>
            {creationTpLevels.map((level, idx) => (
              <div key={level.id} className="space-y-1 p-2 bg-muted/30 rounded">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 w-[4.5rem]">
                    <span className="text-xs font-semibold whitespace-nowrap">#{idx + 1}</span>
                    <Input
                      type="text"
                      value={level.price.toFixed(5)}
                      onChange={(e) => {
                        const newPrice = parseFloat(e.target.value);
                        if (!isNaN(newPrice) && newPrice > 0) {
                          const newLevels = [...creationTpLevels];
                          newLevels[idx] = { ...level, price: newPrice };
                          setCreationTpLevels(newLevels);
                        }
                      }}
                      className="h-5 text-xs px-1 py-0 w-16"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Slider
                      value={[creationSliders[level.id] ?? 33.33]}
                      onValueChange={(value) => {
                        setCreationSliders(prev => ({
                          ...prev,
                          [level.id]: value[0]
                        }));
                      }}
                      onPointerUp={() => {
                        const sliderValue = creationSliders[level.id] ?? 33.33;
                        const actualPercent = sliderToPercent(sliderValue);
                        const newPrice = calculateSlTpPrice(effectivePrice, side, "tp", actualPercent);
                        const newLevels = [...creationTpLevels];
                        newLevels[idx] = { ...level, price: newPrice };
                        setCreationTpLevels(newLevels);
                      }}
                      min={0}
                      max={100}
                      step={0.1}
                      className="w-full"
                    />
                  </div>
                  <div className="w-[2.5rem] text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        const newLevels = creationTpLevels.filter((_, i) => i !== idx);
                        setCreationTpLevels(newLevels);
                        if (newLevels.length === 0) {
                          setTpEnabled(false);
                        }
                        // Clean up sliders
                        setCreationSliders(prev => {
                          const updated = { ...prev };
                          delete updated[level.id];
                          return updated;
                        });
                      }}
                    >
                      <IconX size={10} />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 w-[4.5rem]">
                    <Input
                      type="text"
                      value={level.lots.toFixed(2)}
                      onChange={(e) => {
                        const newLots = Math.min(lots, Math.max(0.01, parseFloat(e.target.value) || 0));
                        const newLevels = [...creationTpLevels];
                        newLevels[idx] = { ...level, lots: newLots };
                        setCreationTpLevels(newLevels);
                      }}
                      className="h-5 text-xs px-1 py-0 w-10"
                    />
                    <span className="text-xs">Lots</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Slider
                      value={[level.lots]}
                      min={0.01}
                      max={getRemainingLots(creationTpLevels, lots) + level.lots}
                      step={0.01}
                      onValueChange={([value]) => {
                        const newLevels = [...creationTpLevels];
                        newLevels[idx] = { ...level, lots: value };
                        setCreationTpLevels(newLevels);
                      }}
                      onPointerUp={() => {
                        // Value is already updated via onValueChange
                      }}
                      className="w-full"
                    />
                  </div>
                  <div className="w-[2.5rem]"></div>
                </div>
              </div>
            ))}
            {getRemainingLots(creationTpLevels, lots) > 0 && (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-xs text-muted-foreground">
                  Remaining: {getRemainingLots(creationTpLevels, lots).toFixed(2)} Lots
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 text-xs px-2"
                  onClick={() => {
                    const newLevel: SlTpLevel = {
                      id: `tp-${creationTpLevels.length + 1}`,
                      price: tpPrice,
                      lots: getRemainingLots(creationTpLevels, lots),
                      locked: false,
                    };
                    setCreationTpLevels([...creationTpLevels, newLevel]);
                  }}
                >
                  + Add TP Level
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 4. Stop Loss section */}
        {!slEnabled ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSlEnabled(true)}
          >
            Add SL
          </Button>
        ) : (
          <div className="space-y-2 pl-6 border-l-2 border-red-500/30">
            <div className="text-xs font-medium text-foreground">Stop Loss</div>
            {creationSlLevels.map((level, idx) => (
              <div key={level.id} className="space-y-1 p-2 bg-muted/30 rounded">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 w-[4.5rem]">
                    <span className="text-xs font-semibold whitespace-nowrap">#{idx + 1}</span>
                    <Input
                      type="text"
                      value={level.price.toFixed(5)}
                      onChange={(e) => {
                        const newPrice = parseFloat(e.target.value);
                        if (!isNaN(newPrice) && newPrice > 0) {
                          const newLevels = [...creationSlLevels];
                          newLevels[idx] = { ...level, price: newPrice };
                          setCreationSlLevels(newLevels);
                        }
                      }}
                      className="h-5 text-xs px-1 py-0 w-16"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Slider
                      value={[creationSliders[level.id] ?? 33.33]}
                      onValueChange={(value) => {
                        setCreationSliders(prev => ({
                          ...prev,
                          [level.id]: value[0]
                        }));
                      }}
                      onPointerUp={() => {
                        const sliderValue = creationSliders[level.id] ?? 33.33;
                        const actualPercent = sliderToPercent(sliderValue);
                        const newPrice = calculateSlTpPrice(effectivePrice, side, "sl", actualPercent);
                        const newLevels = [...creationSlLevels];
                        newLevels[idx] = { ...level, price: newPrice };
                        setCreationSlLevels(newLevels);
                      }}
                      min={0}
                      max={100}
                      step={0.1}
                      className="w-full"
                    />
                  </div>
                  <div className="w-[2.5rem] text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        const newLevels = creationSlLevels.filter((_, i) => i !== idx);
                        setCreationSlLevels(newLevels);
                        if (newLevels.length === 0) {
                          setSlEnabled(false);
                        }
                        // Clean up sliders
                        setCreationSliders(prev => {
                          const updated = { ...prev };
                          delete updated[level.id];
                          return updated;
                        });
                      }}
                    >
                      <IconX size={10} />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 w-[4.5rem]">
                    <Input
                      type="text"
                      value={level.lots.toFixed(2)}
                      onChange={(e) => {
                        const newLots = Math.min(lots, Math.max(0.01, parseFloat(e.target.value) || 0));
                        const newLevels = [...creationSlLevels];
                        newLevels[idx] = { ...level, lots: newLots };
                        setCreationSlLevels(newLevels);
                      }}
                      className="h-5 text-xs px-1 py-0 w-10"
                    />
                    <span className="text-xs">Lots</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Slider
                      value={[level.lots]}
                      min={0.01}
                      max={getRemainingLots(creationSlLevels, lots) + level.lots}
                      step={0.01}
                      onValueChange={([value]) => {
                        const newLevels = [...creationSlLevels];
                        newLevels[idx] = { ...level, lots: value };
                        setCreationSlLevels(newLevels);
                      }}
                      onPointerUp={() => {
                        // Value is already updated via onValueChange
                      }}
                      className="w-full"
                    />
                  </div>
                  <div className="w-[2.5rem]"></div>
                </div>
              </div>
            ))}
            {getRemainingLots(creationSlLevels, lots) > 0 && (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-xs text-muted-foreground">
                  Remaining: {getRemainingLots(creationSlLevels, lots).toFixed(2)} Lots
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 text-xs px-2"
                  onClick={() => {
                    const newLevel: SlTpLevel = {
                      id: `sl-${creationSlLevels.length + 1}`,
                      price: slPrice,
                      lots: getRemainingLots(creationSlLevels, lots),
                      locked: false,
                    };
                    setCreationSlLevels([...creationSlLevels, newLevel]);
                  }}
                >
                  + Add SL Level
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button
          type="button"
          className={cn(
            "w-full",
            side === "buy"
              ? "bg-green-600 hover:bg-green-700 text-white border-green-700 dark:bg-green-700 dark:hover:bg-green-600"
              : "bg-red-600 hover:bg-red-700 text-white border-red-700 dark:bg-red-700 dark:hover:bg-red-600",
          )}
          onClick={handlePlaceTrade}
        >
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
                .map((trade, index) => (
                  <div
                    key={trade.id}
                    className="text-xs p-2 rounded border border-border bg-muted/30"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-muted-foreground min-w-6">
                          #{index + 1}
                        </span>
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
                        <span className="text-muted-foreground text-sm">
                          {trade.lots} lots
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0 hover:bg-muted"
                                onClick={() => {
                                  onTogglePositionLock?.(trade.id, !trade.lockedPosition);
                                }}
                              >
                                {trade.lockedPosition ? (
                                  <IconLock size={14} />
                                ) : (
                                  <IconLockOpen size={14} />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              {trade.lockedPosition ? "Unlock position" : "Lock position"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <button
                          onClick={() => onCloseTrade?.(trade.id)}
                          className="p-1 hover:bg-destructive/20 rounded transition-colors"
                          aria-label="Close trade"
                          title="Close trade"
                        >
                          <IconX size={16} className="text-destructive" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 space-y-1.5 text-muted-foreground">
                      <div>Entry: {trade.entryPrice.toFixed(5)}</div>
                      
                      {/* Take Profit Levels */}
                      {trade.takeProfitLevels.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-foreground">Take Profit</div>
                          {trade.takeProfitLevels.map((level, levelIndex) => (
                            <div key={level.id} className="space-y-1 pl-2 border-l border-green-500/50">
                              <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 w-[4.5rem]">
                                <span className="text-xs whitespace-nowrap">#{levelIndex + 1}</span>
                                <Input
                                  type="text"
                                  disabled={level.locked}
                                  value={level.price.toFixed(5)}
                                  onChange={(e) => {
                                    const newPrice = parseFloat(e.target.value);
                                    if (!isNaN(newPrice) && newPrice > 0 && isValidSlTpPrice(trade, "tp", newPrice)) {
                                      onTradePriceUpdate?.(trade.id, "tp", level.id, newPrice, false);
                                    }
                                  }}
                                  className="h-5 text-xs px-1 py-0 w-16"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <Slider
                                  disabled={level.locked}
                                  value={[
                                    tradeSliders[trade.id]?.[level.id] ??
                                    (() => {
                                      const multiplier = trade.side === "buy"
                                        ? (level.price - trade.entryPrice) / trade.entryPrice
                                        : (trade.entryPrice - level.price) / trade.entryPrice;
                                      const percent = Math.max(0.1, Math.min(100, multiplier * 100));
                                      return percentToSlider(percent);
                                    })()
                                  ]}
                                  onValueChange={(value) => {
                                    if (level.locked) return;
                                    setTradeSliders(prev => ({
                                      ...prev,
                                      [trade.id]: { ...prev[trade.id], [level.id]: value[0] }
                                    }));
                                  }}
                                  onPointerUp={() => {
                                    const sliderValue = tradeSliders[trade.id]?.[level.id] ?? 33.33;
                                    const actualPercent = sliderToPercent(sliderValue);
                                    const price = calculateSlTpPrice(trade.entryPrice, trade.side, "tp", actualPercent);
                                    onTradePriceUpdate?.(trade.id, "tp", level.id, price, false);
                                  }}
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  className="w-full"
                                />
                              </div>
                              <div className="flex items-center gap-0.5">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-4 w-4 p-0 hover:bg-muted"
                                        onClick={() => onToggleLevelLock?.(trade.id, "tp", level.id, !level.locked)}
                                      >
                                        {level.locked ? <IconLock size={10} /> : <IconLockOpen size={10} />}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{level.locked ? "Unlock" : "Lock"}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                                        onClick={() => {
                                          onRemoveLevel?.(trade.id, "tp", level.id);
                                          setTradeSliders(prev => {
                                            const tradeLevelSliders = { ...prev[trade.id] };
                                            delete tradeLevelSliders[level.id];
                                            return { ...prev, [trade.id]: tradeLevelSliders };
                                          });
                                        }}
                                      >
                                        <IconTrash size={10} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-0.5 w-[4.5rem]">
                                <Input
                                  type="text"
                                  disabled={level.locked}
                                  value={level.lots.toFixed(2)}
                                  onChange={(e) => {
                                    const newLots = Math.min(trade.lots, Math.max(0.01, parseFloat(e.target.value) || 0));
                                    onUpdateLevelLots?.(trade.id, "tp", level.id, newLots);
                                  }}
                                  className="h-5 text-xs px-1 py-0 w-10"
                                />
                                <span className="text-xs">Lots</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <Slider
                                  disabled={level.locked}
                                  value={[level.lots]}
                                  min={0.01}
                                  max={getRemainingLots(trade.takeProfitLevels, trade.lots) + level.lots}
                                  step={0.01}
                                  onValueChange={([value]) => {
                                    if (level.locked) return;
                                    onUpdateLevelLots?.(trade.id, "tp", level.id, value);
                                  }}
                                  onPointerUp={() => {
                                    // Value is already updated via onValueChange
                                  }}
                                  className="w-full"
                                />
                              </div>
                              <div className="w-[2.5rem]"></div>
                            </div>
                            </div>
                          ))}
                          {getRemainingLots(trade.takeProfitLevels, trade.lots) > 0 && (
                            <div className="flex items-center gap-2 pl-2">
                              <span className="text-xs text-muted-foreground">
                                Remaining: {getRemainingLots(trade.takeProfitLevels, trade.lots).toFixed(2)} Lots
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 text-xs px-2"
                                onClick={() => {
                                  const lastLevel = trade.takeProfitLevels[trade.takeProfitLevels.length - 1];
                                  const basePrice = lastLevel ? lastLevel.price : trade.entryPrice;
                                  const offset = trade.side === "buy" ? 0.001 : -0.001;
                                  const newPrice = basePrice + offset;
                                  onAddLevel?.(trade.id, "tp", newPrice, getRemainingLots(trade.takeProfitLevels, trade.lots));
                                }}
                              >
                                + Add TP Level
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Stop Loss Levels */}
                      {trade.stopLossLevels.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-foreground">Stop Loss</div>
                          {trade.stopLossLevels.map((level, levelIndex) => (
                            <div key={level.id} className="space-y-1 pl-2 border-l border-red-500/50">
                              <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 w-[4.5rem]">
                                <span className="text-xs whitespace-nowrap">#{levelIndex + 1}</span>
                                <Input
                                  type="text"
                                  disabled={level.locked}
                                  value={level.price.toFixed(5)}
                                  onChange={(e) => {
                                    const newPrice = parseFloat(e.target.value);
                                    if (!isNaN(newPrice) && newPrice > 0 && isValidSlTpPrice(trade, "sl", newPrice)) {
                                      onTradePriceUpdate?.(trade.id, "sl", level.id, newPrice, false);
                                    }
                                  }}
                                  className="h-5 text-xs px-1 py-0 w-16"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <Slider
                                  disabled={level.locked}
                                  value={[
                                    tradeSliders[trade.id]?.[level.id] ??
                                    (() => {
                                      const multiplier = trade.side === "buy"
                                        ? (trade.entryPrice - level.price) / trade.entryPrice
                                        : (level.price - trade.entryPrice) / trade.entryPrice;
                                      const percent = Math.max(0.1, Math.min(100, multiplier * 100));
                                      return percentToSlider(percent);
                                    })()
                                  ]}
                                  onValueChange={(value) => {
                                    if (level.locked) return;
                                    setTradeSliders(prev => ({
                                      ...prev,
                                      [trade.id]: { ...prev[trade.id], [level.id]: value[0] }
                                    }));
                                  }}
                                  onPointerUp={() => {
                                    const sliderValue = tradeSliders[trade.id]?.[level.id] ?? 33.33;
                                    const actualPercent = sliderToPercent(sliderValue);
                                    const price = calculateSlTpPrice(trade.entryPrice, trade.side, "sl", actualPercent);
                                    onTradePriceUpdate?.(trade.id, "sl", level.id, price, false);
                                  }}
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  className="w-full"
                                />
                              </div>
                              <div className="flex items-center gap-0.5">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-4 w-4 p-0 hover:bg-muted"
                                        onClick={() => onToggleLevelLock?.(trade.id, "sl", level.id, !level.locked)}
                                      >
                                        {level.locked ? <IconLock size={10} /> : <IconLockOpen size={10} />}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{level.locked ? "Unlock" : "Lock"}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
                                        onClick={() => {
                                          onRemoveLevel?.(trade.id, "sl", level.id);
                                          setTradeSliders(prev => {
                                            const tradeLevelSliders = { ...prev[trade.id] };
                                            delete tradeLevelSliders[level.id];
                                            return { ...prev, [trade.id]: tradeLevelSliders };
                                          });
                                        }}
                                      >
                                        <IconTrash size={10} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-0.5 w-[4.5rem]">
                                <Input
                                  type="text"
                                  disabled={level.locked}
                                  value={level.lots.toFixed(2)}
                                  onChange={(e) => {
                                    const newLots = Math.min(trade.lots, Math.max(0.01, parseFloat(e.target.value) || 0));
                                    onUpdateLevelLots?.(trade.id, "sl", level.id, newLots);
                                  }}
                                  className="h-5 text-xs px-1 py-0 w-10"
                                />
                                <span className="text-xs">Lots</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <Slider
                                  disabled={level.locked}
                                  value={[level.lots]}
                                  min={0.01}
                                  max={getRemainingLots(trade.stopLossLevels, trade.lots) + level.lots}
                                  step={0.01}
                                  onValueChange={([value]) => {
                                    if (level.locked) return;
                                    onUpdateLevelLots?.(trade.id, "sl", level.id, value);
                                  }}
                                  onPointerUp={() => {
                                    // Value is already updated via onValueChange
                                  }}
                                  className="w-full"
                                />
                              </div>
                              <div className="w-[2.5rem]"></div>
                            </div>
                            </div>
                          ))}
                          {getRemainingLots(trade.stopLossLevels, trade.lots) > 0 && (
                            <div className="flex items-center gap-2 pl-2">
                              <span className="text-xs text-muted-foreground">
                                Remaining: {getRemainingLots(trade.stopLossLevels, trade.lots).toFixed(2)} Lots
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 text-xs px-2"
                                onClick={() => {
                                  const lastLevel = trade.stopLossLevels[trade.stopLossLevels.length - 1];
                                  const basePrice = lastLevel ? lastLevel.price : trade.entryPrice;
                                  const offset = trade.side === "buy" ? -0.001 : 0.001;
                                  const newPrice = basePrice + offset;
                                  onAddLevel?.(trade.id, "sl", newPrice, getRemainingLots(trade.stopLossLevels, trade.lots));
                                }}
                              >
                                + Add SL Level
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Add SL/TP buttons when none exist */}
                    {(trade.stopLossLevels.length === 0 || trade.takeProfitLevels.length === 0) && (
                      <div className="mt-2 flex gap-1">
                        {trade.stopLossLevels.length === 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs flex-1"
                            onClick={() => {
                              const price = calculateSlTpPrice(trade.entryPrice, trade.side, "sl", 1);
                              onAddLevel?.(trade.id, "sl", price, 100);
                            }}
                          >
                            Add SL
                          </Button>
                        )}

                        {trade.takeProfitLevels.length === 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs flex-1"
                            onClick={() => {
                              const price = calculateSlTpPrice(trade.entryPrice, trade.side, "tp", 1);
                              onAddLevel?.(trade.id, "tp", price, 100);
                            }}
                          >
                            Add TP
                          </Button>
                        )}
                      </div>
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
