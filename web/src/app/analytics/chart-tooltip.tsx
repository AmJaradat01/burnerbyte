'use client';

interface ChartTooltipProps {
  active?: boolean;
  payload?: { value: number; dataKey: string }[];
  label?: string | number;
  average: number;
  unit: string;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  average,
  unit,
  labelFormatter,
  valueFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const value = payload[0].value;
  const formattedLabel = labelFormatter ? labelFormatter(label ?? '') : `${label}`;
  const formattedValue = valueFormatter
    ? valueFormatter(value)
    : value.toLocaleString();

  let deltaText: string | null = null;
  if (average > 0) {
    const delta = ((value - average) / average) * 100;
    const sign = delta >= 0 ? '+' : '';
    deltaText = `${sign}${delta.toFixed(1)}% vs avg`;
  }

  return (
    <div
      className="rounded-md px-3 py-2 text-sm shadow-md"
      style={{
        backgroundColor: 'var(--popover)',
        border: '1px solid var(--border)',
        color: 'var(--popover-foreground)',
      }}
    >
      <p className="text-xs text-muted-foreground mb-1">{formattedLabel}</p>
      <p className="font-semibold tabular-nums">
        {formattedValue} <span className="font-normal text-muted-foreground">{unit}</span>
      </p>
      {deltaText && (
        <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{deltaText}</p>
      )}
    </div>
  );
}
