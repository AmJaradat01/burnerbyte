"use client";

import dynamic from "next/dynamic";

const Area = dynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

export function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  // Hide sparkline if all values are zero
  if (data.every((v) => v === 0)) return null;
  const chartData = data.map((value, index) => ({ index, value }));
  return (
    <div className="h-6 w-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-2)"
            fill="var(--chart-2)"
            fillOpacity={0.15}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
