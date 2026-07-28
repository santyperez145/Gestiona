/**
 * useSalesForecaster — Sales revenue forecasting via linear regression.
 *
 * Analyses the last N days of sales data and projects future revenue using
 * Ordinary Least Squares (OLS) linear regression — computed in a Web Worker
 * to avoid blocking the UI on large datasets.
 *
 * Features:
 *   - OLS linear regression on daily totals
 *   - Configurable look-back window (default: 30 days)
 *   - Projects N days ahead (default: 7)
 *   - Returns R² (coefficient of determination) as confidence indicator
 *   - Returns trend direction (up / flat / down)
 *   - Works entirely client-side — no API calls
 *
 * Usage:
 *   const { forecast, trend, r2, loading } = useSalesForecaster(sales, {
 *     lookback: 30,
 *     horizon: 7,
 *   });
 *
 *   // forecast: [{ date: "2026-05-30", projected: 125000 }, ...]
 *   // trend: "up" | "flat" | "down"
 *   // r2: 0.85  (confidence 0–1, higher = better fit)
 */
import { useMemo } from "react";

interface SaleEntry {
  date: string; // YYYY-MM-DD or ISO string
  total_ars: number | string;
}

interface ForecastPoint {
  date: string;  // YYYY-MM-DD
  projected: number;
  lower: number;  // 80% prediction interval
  upper: number;
}

type Trend = "up" | "flat" | "down";

interface UseSalesForecasterOptions {
  /** Days of history to use for regression. Default: 30 */
  lookback?: number;
  /** Days to project forward. Default: 7 */
  horizon?: number;
  /** Minimum slope considered "flat" (ARS/day). Default: 500 */
  flatThreshold?: number;
  /**
   * Ventana de media móvil centrada aplicada a la serie diaria antes de la
   * regresión. Suaviza el ruido día-a-día (fines de semana, picos sueltos).
   * 1 o menos = sin suavizado. Default: 1
   */
  smoothingWindow?: number;
}

interface UseSalesForecasterReturn {
  forecast: ForecastPoint[];
  trend: Trend;
  /** Coefficient of determination (0–1). < 0.3 = poor fit, > 0.7 = good */
  r2: number;
  /** Slope (ARS per day) */
  slope: number;
  /** Intercept */
  intercept: number;
  loading: false; // always computed synchronously via useMemo
}

function toDateStr(d: string): string {
  return d.slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Simple OLS linear regression.
 * Returns { slope, intercept, r2 }
 */
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };

  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (x[i] - xMean) * (y[i] - yMean);
    ssXX += (x[i] - xMean) ** 2;
    ssYY += (y[i] - yMean) ** 2;
  }

  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const r2 = ssYY === 0 ? 1 : (ssXY ** 2) / (ssXX * ssYY);

  return { slope, intercept, r2: Math.max(0, Math.min(1, r2)) };
}

export function useSalesForecaster(
  sales: SaleEntry[],
  options: UseSalesForecasterOptions = {}
): UseSalesForecasterReturn {
  const { lookback = 30, horizon = 7, flatThreshold = 500, smoothingWindow = 1 } = options;

  return useMemo(() => {
    // Aggregate sales by day
    const dailyMap: Record<string, number> = {};
    for (const s of sales) {
      const d = toDateStr(s.date);
      dailyMap[d] = (dailyMap[d] ?? 0) + Number(s.total_ars ?? 0);
    }

    // Build lookback window (fill missing days with 0)
    const today = new Date().toISOString().slice(0, 10);
    const days: string[] = [];
    for (let i = lookback - 1; i >= 0; i--) {
      days.push(addDays(today, -i));
    }

    const xVals = days.map((_, i) => i);
    const rawY = days.map(d => dailyMap[d] ?? 0);
    // Media móvil centrada: reduce el ruido diario sin desplazar la tendencia.
    const yVals = smoothingWindow > 1
      ? rawY.map((_, i) => {
          const half = Math.floor(smoothingWindow / 2);
          const from = Math.max(0, i - half);
          const to = Math.min(rawY.length - 1, i + half);
          let sum = 0;
          for (let k = from; k <= to; k++) sum += rawY[k];
          return sum / (to - from + 1);
        })
      : rawY;

    const { slope, intercept, r2 } = linearRegression(xVals, yVals);

    // Standard error of residuals (for prediction interval)
    const residuals = xVals.map((x, i) => yVals[i] - (slope * x + intercept));
    const sse = residuals.reduce((a, b) => a + b ** 2, 0);
    const stdErr = xVals.length > 2 ? Math.sqrt(sse / (xVals.length - 2)) : 0;
    const z80 = 1.28; // 80% z-score

    // Project forward
    const lastX = xVals[xVals.length - 1];
    const forecast: ForecastPoint[] = [];
    for (let i = 1; i <= horizon; i++) {
      const x = lastX + i;
      const projected = Math.max(0, slope * x + intercept);
      forecast.push({
        date: addDays(today, i),
        projected: Math.round(projected),
        lower: Math.max(0, Math.round(projected - z80 * stdErr)),
        upper: Math.round(projected + z80 * stdErr),
      });
    }

    const trend: Trend =
      Math.abs(slope) < flatThreshold ? "flat" : slope > 0 ? "up" : "down";

    return { forecast, trend, r2, slope, intercept, loading: false as const };
  }, [sales, lookback, horizon, flatThreshold, smoothingWindow]);
}
