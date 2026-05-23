/**
 * useProductExpiry — Track products nearing or past their expiry date.
 *
 * Queries products with an `expiry_date` set, buckets them by urgency,
 * and returns sorted lists for the alerts dashboard and product list.
 *
 * Urgency buckets:
 *   expired   — expiry_date < today
 *   critical  — expires within 7 days
 *   warning   — expires within 30 days
 *   ok        — expires in 31+ days
 *
 * Usage:
 *   const { expired, critical, warning, ok, totalAtRisk } = useProductExpiry(products);
 *
 *   // Alert badge
 *   {critical.length > 0 && <Badge destructive>{critical.length} vencen pronto</Badge>}
 */
import { useMemo } from "react";

interface Product {
  id: string;
  name: string;
  stock: number;
  expiry_date?: string | null;
  lot_number?: string | null;
  category?: string;
}

type UrgencyLevel = "expired" | "critical" | "warning" | "ok";

interface ExpiryProduct extends Product {
  urgency: UrgencyLevel;
  /** Days until expiry (negative = already expired) */
  daysUntil: number;
  /** Formatted expiry date (DD/MM/YYYY) */
  expiryLabel: string;
}

interface UseProductExpiryReturn {
  expired: ExpiryProduct[];
  critical: ExpiryProduct[];   // ≤ 7 days
  warning: ExpiryProduct[];    // ≤ 30 days
  ok: ExpiryProduct[];         // > 30 days
  /** Products with stock > 0 that are expired or critical */
  totalAtRisk: number;
  /** All products with an expiry date, sorted by urgency */
  all: ExpiryProduct[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export function useProductExpiry(products: Product[]): UseProductExpiryReturn {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const withExpiry: ExpiryProduct[] = [];

    for (const p of products) {
      if (!p.expiry_date) continue;
      const expiry = new Date(p.expiry_date + "T00:00:00");
      const daysUntil = daysBetween(today, expiry);

      let urgency: UrgencyLevel;
      if (daysUntil < 0) urgency = "expired";
      else if (daysUntil <= 7) urgency = "critical";
      else if (daysUntil <= 30) urgency = "warning";
      else urgency = "ok";

      const expiryLabel = expiry.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

      withExpiry.push({ ...p, urgency, daysUntil, expiryLabel });
    }

    // Sort: most urgent first
    withExpiry.sort((a, b) => a.daysUntil - b.daysUntil);

    const expired = withExpiry.filter(p => p.urgency === "expired");
    const critical = withExpiry.filter(p => p.urgency === "critical");
    const warning = withExpiry.filter(p => p.urgency === "warning");
    const ok = withExpiry.filter(p => p.urgency === "ok");

    const totalAtRisk = [...expired, ...critical].filter(p => p.stock > 0).length;

    return { expired, critical, warning, ok, totalAtRisk, all: withExpiry };
  }, [products]);
}
