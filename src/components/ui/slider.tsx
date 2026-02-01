import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  showValueTooltip?: boolean;
  formatValue?: (value: number) => string;
}

function SliderComponent({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  showValueTooltip = false,
  formatValue = (val) => val.toString(),
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}: SliderProps) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const [isDragging, setIsDragging] = React.useState(false);

  // Calculate tooltip position based on slider value percentage
  const tooltipLeft = React.useMemo(() => {
    if (_values.length === 0) return 0;
    const percentage = (((_values[0] - min) / (max - min)) * 100);
    return `${percentage}%`;
  }, [_values, min, max]);

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      onPointerDown={(event) => {
        setIsDragging(true)
        onPointerDown?.(event)
      }}
      onPointerUp={(event) => {
        setIsDragging(false)
        onPointerUp?.(event)
      }}
      onPointerCancel={(event) => {
        setIsDragging(false)
        onPointerCancel?.(event)
      }}
      onLostPointerCapture={(event) => {
        setIsDragging(false)
        onLostPointerCapture?.(event)
      }}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted rounded-md data-horizontal:h-3 data-horizontal:w-full data-vertical:h-full data-vertical:w-3 bg-muted relative grow overflow-hidden data-horizontal:w-full data-vertical:h-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          className="border-primary ring-ring/30 size-4 rounded-md border bg-white shadow-sm transition-colors hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
      {showValueTooltip && isDragging && (
        <div 
          className="absolute px-2 py-1 bg-popover border rounded-md shadow-md text-xs whitespace-nowrap pointer-events-none z-50 -top-10"
          style={{
            left: tooltipLeft,
            transform: 'translateX(-50%)'
          }}
        >
          {formatValue(_values[0])}
        </div>
      )}
    </SliderPrimitive.Root>
  )
}

const Slider = React.memo(SliderComponent);

export { Slider }
