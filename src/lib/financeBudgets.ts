import { supabase } from "@/integrations/supabase/client";

export type ExpenseBudgetRow = {
  budget_id: string;
  category_key: string;
  category_name: string;
  amount: number;
  notes: string | null;
  updated_at: string;
};

export type ExpenseBudgetPeriod = {
  year: number;
  month: number;
};

export type ExpenseBudgetSpendSource = {
  category?: string | null;
  amount_ars?: number | string | null;
  date?: string | null;
};

export function expenseBudgetPeriod(filterMonth: string): ExpenseBudgetPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(filterMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export function expenseBudgetMap(rows: ExpenseBudgetRow[]) {
  return Object.fromEntries(rows.map(row => [row.category_key, Number(row.amount || 0)]));
}

export function expenseBudgetSpendByCategory(
  expenses: ExpenseBudgetSpendSource[],
  period: ExpenseBudgetPeriod,
) {
  const monthKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  return expenses.reduce<Record<string, number>>((totals, expense) => {
    const category = expense.category?.trim();
    if (!category || expense.date?.slice(0, 7) !== monthKey) return totals;
    const amount = Number(expense.amount_ars ?? 0);
    if (!Number.isFinite(amount)) return totals;
    totals[category] = (totals[category] ?? 0) + amount;
    return totals;
  }, {});
}

export async function getExpenseBudgets(
  orgId: string,
  period: ExpenseBudgetPeriod,
): Promise<ExpenseBudgetRow[]> {
  const { data, error } = await supabase.rpc("get_expense_budgets", {
    p_org_id: orgId,
    p_year: period.year,
    p_month: period.month,
  });
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, amount: Number(row.amount || 0) }));
}

export async function setExpenseBudget(params: {
  orgId: string;
  categoryKey: string;
  categoryName: string;
  period: ExpenseBudgetPeriod;
  amount: number;
}) {
  const { data, error } = await supabase.rpc("set_expense_budget", {
    p_org_id: params.orgId,
    p_category_key: params.categoryKey,
    p_category_name: params.categoryName,
    p_year: params.period.year,
    p_month: params.period.month,
    p_amount: params.amount,
  });
  if (error) throw error;
  return data;
}
