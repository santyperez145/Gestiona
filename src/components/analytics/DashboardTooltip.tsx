import React from "react";

interface DashboardTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string | null;
    color: string;
    dataKey: string;
  }>;
  label?: string | number;
}

export default function DashboardTooltip({ active, payload, label }: DashboardTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="text-[10px]">
      <div className="mb-1">
        <span className="font-medium text-[11px]">{label}</span>
      </div>
      {payload.map((item, index) => {
        const { name, value, color } = item;
        return (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="flex-1">{name}</span>
            <span className="font-mono tabular-nums">
              {typeof value === "number" ? value.toLocaleString("es-AR") : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}