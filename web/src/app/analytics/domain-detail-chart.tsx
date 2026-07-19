"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

interface TimeSeriesPoint {
  date: string;
  count: number;
}

interface DomainDetailChartProps {
  orgId: string;
  domain: string;
  days: string;
}

export function DomainDetailChart({ orgId, domain, days }: DomainDetailChartProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics-domain-series", orgId, domain, days],
    queryFn: () =>
      api.get<{ data: TimeSeriesPoint[]; domain: string }>(
        `/orgs/${orgId}/analytics/domain-series`,
        { domain, days }
      ),
  });

  if (isLoading) {
    return <Skeleton className="h-[150px] w-full rounded-lg mt-2" />;
  }

  if (isError || !data?.data) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Failed to load domain trend.
      </p>
    );
  }

  if (data.data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No data for this period.
      </p>
    );
  }

  const avg = Math.round(
    data.data.reduce((s, d) => s + d.count, 0) / data.data.length
  );

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-3">
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data.data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickFormatter={(v) => v.slice(5)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            allowDecimals={false}
            width={30}
          />
          <Tooltip
            content={
              <ChartTooltip
                average={avg}
                unit="emails"
                labelFormatter={(v) => `Date: ${v}`}
              />
            }
          />
          <Bar dataKey="count" fill="var(--chart-4)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
