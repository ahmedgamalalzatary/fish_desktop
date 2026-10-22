import type { Column } from "../components/DataTable";
import { formatAmount, formatDateTime, formatWeight } from "./format";
import type { PurchaseSummary, SupplierReportRow } from "./types";

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Purchase invoice columns shared by the purchases page, the reports and their printouts. */
export function purchaseColumns(rows: PurchaseSummary[]): Column<PurchaseSummary>[] {
  return [
    { header: "رقم", cell: (r) => `#${r.id}` },
    { header: "التاريخ", cell: (r) => formatDateTime(r.created_at) },
    { header: "المورد", cell: (r) => r.supplier_name },
    { header: "فاتورة المورد", cell: (r) => r.invoice_no || "—" },
    { header: "الأصناف", numeric: true, cell: (r) => r.items_count },
    {
      header: "الوزن",
      numeric: true,
      cell: (r) => formatWeight(r.grams),
      total: formatWeight(sum(rows, (r) => r.grams)),
    },
    {
      header: "الإجمالي",
      numeric: true,
      cell: (r) => formatAmount(r.total),
      total: formatAmount(sum(rows, (r) => r.total)),
    },
    {
      header: "دُفع عند الاستلام",
      numeric: true,
      cell: (r) => formatAmount(r.paid),
      total: formatAmount(sum(rows, (r) => r.paid)),
    },
  ];
}

/** Per-supplier activity in a period, plus what is still owed today. */
export function supplierReportColumns(rows: SupplierReportRow[]): Column<SupplierReportRow>[] {
  return [
    { header: "المورد", cell: (r) => r.name },
    { header: "الفواتير", numeric: true, cell: (r) => r.purchases_count },
    {
      header: "الوزن المستلم",
      numeric: true,
      cell: (r) => formatWeight(r.grams),
      total: formatWeight(sum(rows, (r) => r.grams)),
    },
    {
      header: "المشتريات",
      numeric: true,
      cell: (r) => formatAmount(r.purchases_total),
      total: formatAmount(sum(rows, (r) => r.purchases_total)),
    },
    {
      header: "المدفوع",
      numeric: true,
      cell: (r) => formatAmount(r.paid),
      total: formatAmount(sum(rows, (r) => r.paid)),
    },
    {
      header: "المستحق حالياً",
      numeric: true,
      cell: (r) => formatAmount(r.balance),
      total: formatAmount(sum(rows, (r) => r.balance)),
    },
  ];
}
