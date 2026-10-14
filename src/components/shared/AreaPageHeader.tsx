/**
 * Encabezado y tarjeta KPI de las páginas por área (Commerce, Business,
 * Finance). Antes había tres copias idénticas que sólo cambiaban el color; desde
 * 2026-10-14 son el PageHeader y el MetricTile de todo el panel.
 */
import type { LucideIcon } from "lucide-react";
import MetricTile from "@/components/shared/MetricTile";
import PageHeader from "@/components/shared/PageHeader";

export type Area = "commerce" | "business" | "finance";

/** La línea de contexto del encabezado, igual que en el resto del panel. */
const AREA: Record<Area, string> = {
  commerce: "Commerce",
  business: "Gestión",
  finance: "Finance",
};

export interface AreaPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: string;
}

export function AreaPageHeader({ area, icon, title, description, actions, badge }: AreaPageHeaderProps & { area: Area }) {
  // Desde 2026-10-14 es el mismo encabezado que el resto del panel (PageHeader):
  // antes cada área tenía su propio formato y la pantalla se veía de otra época.
  return <PageHeader icon={icon} title={title} description={description} actions={actions}
    eyebrow={AREA[area]} badge={badge ? { label: badge } : undefined} />;
}

export interface AreaKPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  description?: string;
}

export function AreaKPICard({ title, value, change, trend = "neutral", icon, action, description }: AreaKPICardProps & { area: Area }) {
  // Mismo indicador que el resto del panel (MetricTile, 2026-10-14): el área ya
  // la dice el encabezado de la página, no hace falta un borde de color.
  const variacion = change === undefined ? undefined
    : { value: trend === "down" ? -Math.abs(change) : trend === "up" ? Math.abs(change) : change };
  return <MetricTile label={title} value={value} sub={description} icon={icon} change={variacion} action={action} />;
}
