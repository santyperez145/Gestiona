import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import MetricTile, { type TonoDeIndicador } from "@/components/shared/MetricTile";

type ColorVariant = "primary" | "success" | "destructive" | "warning" | "blue" | "purple";

interface KPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color?: ColorVariant;
  trend?: { value: number; label: string };
  onClick?: () => void;
  footer?: ReactNode;
}

const TONO: Record<ColorVariant, TonoDeIndicador> = {
  primary: "primary",
  success: "success",
  destructive: "destructive",
  warning: "warning",
  blue: "primary",
  purple: "primary",
};

/**
 * Indicador clásico del panel. Desde 2026-10-14 se dibuja con MetricTile (el
 * lenguaje del Inicio): sin barra lateral de color ni números monoespaciados.
 */
export default function KPICard({ label, value, sub, icon, color = "primary", trend, onClick, footer }: KPICardProps) {
  return (
    <MetricTile label={label} value={value} sub={sub} icon={icon} tone={TONO[color]}
      change={trend ? { value: trend.value, label: trend.label } : undefined} onClick={onClick} footer={footer} />
  );
}
