/**
 * Cash flow projection helpers — fully driven by user settings (no hardcoded thresholds).
 */
import { calculateTaxes } from './supabaseStore';

export interface CashFlowMovement {
  date: string;       // YYYY-MM-DD
  amount: number;     // positive = inflow, negative = outflow
  label: string;
  kind: 'debt' | 'sales_projection' | 'recurring_expense' | 'scheduled_purchase' | 'tax';
}

export interface CashFlowWindow {
  days: number;
  inflows: number;
  outflows: number;
  net: number;
  endingBalance: number;
  movements: CashFlowMovement[];
  daily: { date: string; balance: number; flow: number }[];
}

export function projectCashFlow(opts: {
  initialCash: number;
  windowDays: number;
  sales: any[];          // historical sales (last 90d preferred for averaging)
  debts: any[];          // pending debts with due_date
  expenses: any[];       // expenses (recurring flag used for replication)
  purchases: any[];      // includes scheduled future purchases
  settings: any;
}): CashFlowWindow {
  const { initialCash, windowDays, sales, debts, expenses, purchases, settings } = opts;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today.getTime() + windowDays * 86400000);

  // Sales avg from last 30 days
  const cutoff30 = new Date(today.getTime() - 30 * 86400000);
  const recentSales = sales.filter(s => new Date(s.date) >= cutoff30);
  const sumRecent = recentSales.reduce((a, b) => a + Number(b.total_ars || 0), 0);
  const dailySalesAvg = sumRecent / 30;

  const movements: CashFlowMovement[] = [];

  // Inflow: pending debts with due_date in window
  debts.forEach(d => {
    if (d.status === 'paid' || !d.due_date) return;
    const due = new Date(d.due_date);
    if (due >= today && due <= end) {
      movements.push({
        date: due.toISOString().slice(0, 10),
        amount: Number(d.remaining_ars),
        label: `Cobranza ${d.customer_name}`,
        kind: 'debt',
      });
    }
  });

  // Inflow: projected sales spread across all days
  for (let i = 1; i <= windowDays; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    if (dailySalesAvg > 0) {
      movements.push({
        date: d.toISOString().slice(0, 10),
        amount: dailySalesAvg,
        label: 'Ventas proyectadas',
        kind: 'sales_projection',
      });
    }
  }

  // Outflow: recurring expenses replicated each month within window
  const recurring = (expenses || []).filter(e => e.recurring);
  const monthsInWindow = Math.ceil(windowDays / 30);
  recurring.forEach(e => {
    const baseDay = new Date(e.date).getDate();
    for (let m = 0; m < monthsInWindow; m++) {
      const proj = new Date(today.getFullYear(), today.getMonth() + m + 1, Math.min(baseDay, 28));
      if (proj >= today && proj <= end) {
        movements.push({
          date: proj.toISOString().slice(0, 10),
          amount: -Number(e.amount_ars),
          label: `Gasto recurrente: ${e.description || e.category}`,
          kind: 'recurring_expense',
        });
      }
    }
  });

  // Outflow: scheduled purchases
  (purchases || []).forEach(p => {
    if (!p.is_scheduled || !p.scheduled_date) return;
    const sd = new Date(p.scheduled_date);
    if (sd >= today && sd <= end) {
      movements.push({
        date: sd.toISOString().slice(0, 10),
        amount: -Number(p.total_ars),
        label: `Compra programada: ${p.product_name}`,
        kind: 'scheduled_purchase',
      });
    }
  });

  // Outflow: estimated taxes on projected sales
  if (settings?.tax_enabled) {
    const projectedRevenue = dailySalesAvg * windowDays;
    const avgMargin = recentSales.length
      ? recentSales.reduce((a, b) => a + Number(b.profit_ars || 0), 0) / sumRecent
      : 0;
    const projectedProfit = projectedRevenue * avgMargin;
    const tax = calculateTaxes(projectedRevenue, projectedProfit, settings).totalTax;
    if (tax > 0) {
      movements.push({
        date: end.toISOString().slice(0, 10),
        amount: -tax,
        label: 'Impuestos estimados',
        kind: 'tax',
      });
    }
  }

  // Build daily balance series
  movements.sort((a, b) => a.date.localeCompare(b.date));
  const daily: { date: string; balance: number; flow: number }[] = [];
  let balance = initialCash;
  for (let i = 0; i <= windowDays; i++) {
    const day = new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10);
    const dayMovs = movements.filter(m => m.date === day);
    const flow = dayMovs.reduce((a, b) => a + b.amount, 0);
    balance += flow;
    daily.push({ date: day, balance: Math.round(balance), flow: Math.round(flow) });
  }

  const inflows = movements.filter(m => m.amount > 0).reduce((a, b) => a + b.amount, 0);
  const outflows = movements.filter(m => m.amount < 0).reduce((a, b) => a + b.amount, 0);

  return {
    days: windowDays,
    inflows: Math.round(inflows),
    outflows: Math.round(outflows),
    net: Math.round(inflows + outflows),
    endingBalance: Math.round(balance),
    movements,
    daily,
  };
}

/** Computes a 0-100 financial health score with sub-component breakdown. */
export function computeHealthScore(opts: {
  sales: any[];
  expenses: any[];
  debts: any[];
  products: any[];
  initialCash: number;
  marginAlertPercent: number;
}) {
  const { sales, expenses, debts, products, initialCash, marginAlertPercent } = opts;
  const now = new Date();
  const curY = now.getFullYear(); const curM = now.getMonth();
  const monthSales = sales.filter(s => { const d = new Date(s.date); return d.getFullYear() === curY && d.getMonth() === curM; });
  const monthRevenue = monthSales.reduce((a, b) => a + Number(b.total_ars || 0), 0);
  const monthProfit = monthSales.reduce((a, b) => a + Number(b.profit_ars || 0), 0);
  const margin = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;

  const monthExpenses = (expenses || []).filter(e => { const d = new Date(e.date); return d.getFullYear() === curY && d.getMonth() === curM; })
    .reduce((a, b) => a + Number(b.amount_ars || 0), 0);

  const cash = initialCash + monthProfit - monthExpenses;
  const liquidityRatio = monthExpenses > 0 ? cash / monthExpenses : (cash > 0 ? 5 : 0);

  const inventoryValue = products.reduce((a, p) => a + Number(p.total_cost_usd || 0) * Number(p.stock || 0), 0);
  const cogs30 = monthSales.reduce((a, b) => a + Number(b.cost_per_unit_usd || 0) * Number(b.quantity || 0), 0);
  const inventoryTurnoverDays = cogs30 > 0 ? inventoryValue / (cogs30 / 30) : 60;

  // MoM growth
  const prevDate = new Date(curY, curM - 1, 1);
  const prevSales = sales.filter(s => { const d = new Date(s.date); return d.getFullYear() === prevDate.getFullYear() && d.getMonth() === prevDate.getMonth(); });
  const prevRevenue = prevSales.reduce((a, b) => a + Number(b.total_ars || 0), 0);
  const growth = prevRevenue > 0 ? ((monthRevenue - prevRevenue) / prevRevenue) * 100 : (monthRevenue > 0 ? 100 : 0);

  // Overdue ratio
  const totalDebts = debts.reduce((a, b) => a + Number(b.remaining_ars || 0), 0);
  const overdue = debts.filter(d => d.status !== 'paid' && d.due_date && new Date(d.due_date) < now)
    .reduce((a, b) => a + Number(b.remaining_ars || 0), 0);
  const overdueRatio = totalDebts > 0 ? (overdue / totalDebts) * 100 : 0;

  // Score components (0-100 each)
  const scoreMargin = Math.min(100, Math.max(0, (margin / Math.max(marginAlertPercent * 1.5, 1)) * 100));
  const scoreLiquidity = Math.min(100, Math.max(0, liquidityRatio * 25));
  const scoreTurnover = Math.min(100, Math.max(0, 100 - (inventoryTurnoverDays - 30) * 2));
  const scoreGrowth = Math.min(100, Math.max(0, 50 + growth * 2));
  const scoreOverdue = Math.min(100, Math.max(0, 100 - overdueRatio * 2));

  const total = Math.round(
    scoreMargin * 0.25 + scoreLiquidity * 0.20 + scoreTurnover * 0.20 + scoreGrowth * 0.20 + scoreOverdue * 0.15
  );

  return {
    total,
    components: [
      { label: 'Margen', value: Math.round(scoreMargin), weight: 25, raw: `${margin.toFixed(1)}%`, hint: `Margen actual ${margin.toFixed(1)}% (objetivo > ${marginAlertPercent}%)` },
      { label: 'Liquidez', value: Math.round(scoreLiquidity), weight: 20, raw: `${liquidityRatio.toFixed(1)}×`, hint: `Caja cubre ${liquidityRatio.toFixed(1)}× los gastos del mes` },
      { label: 'Rotación', value: Math.round(scoreTurnover), weight: 20, raw: `${inventoryTurnoverDays.toFixed(0)}d`, hint: `Stock rota cada ${inventoryTurnoverDays.toFixed(0)} días` },
      { label: 'Crecimiento', value: Math.round(scoreGrowth), weight: 20, raw: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`, hint: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}% vs mes anterior` },
      { label: 'Cobranza', value: Math.round(scoreOverdue), weight: 15, raw: `${overdueRatio.toFixed(0)}% vencido`, hint: `${overdueRatio.toFixed(0)}% de las deudas están vencidas` },
    ],
  };
}

/** Detects data inconsistencies that can be auto-repaired. */
export function detectConsistencyIssues(opts: {
  sales: any[]; debts: any[]; products: any[]; settings: any;
}): { kind: string; label: string; ids: string[]; severity: 'warning' | 'error' }[] {
  const issues: { kind: string; label: string; ids: string[]; severity: 'warning' | 'error' }[] = [];
  const { sales, debts, products, settings } = opts;

  // Debts paid but linked sale not marked paid
  const badPaidSales = debts
    .filter(d => d.status === 'paid' && d.sale_id)
    .filter(d => {
      const s = sales.find(x => x.id === d.sale_id);
      return s && !s.paid;
    })
    .map(d => d.sale_id);
  if (badPaidSales.length) issues.push({
    kind: 'sale_not_paid',
    label: `${badPaidSales.length} ventas marcadas como impagas pero su deuda está saldada`,
    ids: badPaidSales,
    severity: 'warning',
  });

  // Outdated cost
  const customs = Number(settings?.customs_percent || 15);
  const badCosts = products.filter(p => {
    const expected = Number(p.cost_usd) * (1 + customs / 100);
    return Number(p.cost_usd) > 0 && Math.abs(expected - Number(p.total_cost_usd)) > 0.01;
  }).map(p => p.id);
  if (badCosts.length) issues.push({
    kind: 'outdated_cost',
    label: `${badCosts.length} productos con total_cost_usd desactualizado`,
    ids: badCosts,
    severity: 'warning',
  });

  return issues;
}
