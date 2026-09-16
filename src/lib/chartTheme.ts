import type { CSSProperties } from 'react';

// Paleta Nerqia (2026-09-02): Cobalto #173aef · Teal #14b8a6 · Warm #f59e0b · Purple #8b5cf6
export const chartColors = {
  sales: '#173aef',      // Cobalto — acción principal / ventas
  profit: '#14b8a6',     // Teal — margen / éxito
  expenses: '#f59e0b',   // Warm — riesgo / gasto
  margin: '#14b8a6',     // Teal — margen
  warning: '#f59e0b',    // Warm — alerta / baja
  text: 'hsl(var(--muted-foreground))',
};

export const chartPalette = [
  '#173aef', // cobalto
  '#14b8a6', // teal
  '#f59e0b', // warm
  '#8b5cf6', // purple
  '#173aef', // cobalto (repetido para variedad controlada)
];

export const chartTooltipStyle: CSSProperties = {
  background: 'hsl(var(--popover))',
  color: 'hsl(var(--popover-foreground))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
};
