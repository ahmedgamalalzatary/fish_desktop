import type { Column } from "../components/DataTable";
import { formatAmount, formatDateTime } from "./format";
import type { Expense } from "./types";

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Expense columns shared by the expenses page, the reports and their printouts. */
export function expenseColumns(rows: Expense[]): Column<Expense>[] {
  return [
    { header: "التاريخ", cell: (r) => formatDateTime(r.created_at) },
    { header: "السبب", cell: (r) => r.reason },
    { header: "سجّله", cell: (r) => r.user_name },
    {
      header: "المبلغ",
      numeric: true,
      cell: (r) => formatAmount(r.amount),
      total: formatAmount(sum(rows, (r) => r.amount)),
    },
  ];
}

export interface ExpenseByUser {
  user_id: number;
  name: string;
  count: number;
  amount: number;
}

/** Who took how much out, largest first. */
export function expensesByUser(rows: Expense[]): ExpenseByUser[] {
  const byUser = new Map<number, ExpenseByUser>();
  for (const e of rows) {
    const u = byUser.get(e.user_id) ?? { user_id: e.user_id, name: e.user_name, count: 0, amount: 0 };
    byUser.set(e.user_id, { ...u, count: u.count + 1, amount: u.amount + e.amount });
  }
  return [...byUser.values()].sort((a, b) => b.amount - a.amount);
}

export function expenseByUserColumns(rows: ExpenseByUser[]): Column<ExpenseByUser>[] {
  return [
    { header: "الموظف", cell: (r) => r.name },
    { header: "عدد المصروفات", numeric: true, cell: (r) => r.count, total: sum(rows, (r) => r.count) },
    {
      header: "المبلغ",
      numeric: true,
      cell: (r) => formatAmount(r.amount),
      total: formatAmount(sum(rows, (r) => r.amount)),
    },
  ];
}
