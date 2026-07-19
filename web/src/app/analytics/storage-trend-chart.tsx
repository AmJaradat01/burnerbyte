'use client';

import { Card, CardContent } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { HardDrive } from "lucide-react";
import { ChartTooltip } from "./chart-tooltip";

interface StorageTrendChartProps {
  data: { date: string; storage_bytes: number }[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(k, index);
  return `${value.toFixed(1)} ${units[index]}`;
}

export default function StorageTrendChart({ data }: StorageTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center justify-center text-center">
          <HardDrive className="h-8 w-8 text-muted-foreground mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No storage data</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Storage trend data is not available for this period.</p>
        </CardContent>
      </Card>
    );
  }

  const storageAvg = Math.round(data.reduce((s, d) => s + d.storage_bytes, 0) / data.length);

  return (
    <Card>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => formatBytes(Number(v))}
              width={60}
            />
            <Tooltip
              content={
                <ChartTooltip
                  average={storageAvg}
                  unit="storage"
                  labelFormatter={(v) => `Date: ${v}`}
                  valueFormatter={(v) => formatBytes(v)}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="storage_bytes"
              stroke="var(--chart-4)"
              fill="var(--chart-4)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
