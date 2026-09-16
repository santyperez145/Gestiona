import React from "react";
import { cn } from "@/lib/utils";

interface DashboardChartWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function DashboardChartWrapper({ children, className }: DashboardChartWrapperProps) {
  return (
    <div className={cn(
      "relative w-full min-w-0 bg-transparent",
      className
    )}>
      {children}
    </div>
  );
}
