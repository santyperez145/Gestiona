import type { CSSProperties } from 'react';

export const chartColors = {
  sales: 'hsl(var(--primary))',
  profit: 'hsl(var(--success))',
  expenses: 'hsl(var(--destructive))',
  margin: 'hsl(var(--nerqia-teal))',
  warning: 'hsl(var(--warning))',
  text: 'hsl(var(--muted-foreground))',
};

export const chartPalette = [chartColors.sales, chartColors.margin, chartColors.warning, chartColors.expenses, chartColors.profit];

export const chartTooltipStyle: CSSProperties = {
  background: 'hsl(var(--popover))',
  color: 'hsl(var(--popover-foreground))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
};
