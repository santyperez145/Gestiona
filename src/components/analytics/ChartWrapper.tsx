import React from "react";
import { cn } from "@/lib/utils";

interface DashboardChartWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function DashboardChartWrapper({ children, className }: DashboardChartWrapperProps) {
  return (
    <div className={cn(
      "relative w-full overflow-auto rounded-xl border border-[#1a1a2e]/60 bg-[#0b0b18]/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset,0_12px_40px_rgba(0,0,0,0.6)]",
      className
    )}>
      {children}
    </div>
  );
}