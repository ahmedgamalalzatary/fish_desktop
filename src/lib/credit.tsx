import { formatAmount, formatDateTime } from "./format";
import { api } from "./api";
import { reportTab } from "./shop";
import type { CreditReportRow } from "./types";

const sum = (rows: CreditReportRow[], f: (r: CreditReportRow) => number) => rows.reduce((s, r) => s + f(r), 0);

/** The reports tab of the sales on credit, for shops with `creditSales` to list in their `reportTabs`. */
export const creditReportTab = reportTab<CreditReportRow>({
  value: "credit",
  label: "البيع الآجل",
  place: "sales",
  intro: "الفواتير الآجلة في الفترة، وما تبقى على كل منها الآن.",
  empty: "لا يوجد بيع آجل في هذه الفترة",
  inFullReport: "البيع الآجل",
  load: (range) => api.reportCredit(range),
  rowKey: (r) => r.sale_id,
  filter: {
    label: "الحالة",
    all: "كل الفواتير",
    options: [
      { value: "owing", label: "عليها مبالغ" },
      { value: "paid", label: "مسددة" },
    ],
    apply: (rows, value) => rows.filter((r) => (value === "owing" ? r.remaining > 0 : r.remaining <= 0)),
  },
  columns: (rows) => [
    { header: "رقم الفاتورة", cell: (r) => `#${r.sale_id}` },
    { header: "التاريخ", cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span> },
    { header: "العميل", cell: (r) => r.customer_name },
    { header: "الهاتف", cell: (r) => <span dir="ltr">{r.customer_phone}</span> },
    { header: "الكاشير", cell: (r) => r.cashier_name },
    {
      header: "الإجمالي",
      numeric: true,
      cell: (r) => formatAmount(r.total),
      total: formatAmount(sum(rows, (r) => r.total)),
    },
    {
      header: "المدفوع",
      numeric: true,
      cell: (r) => formatAmount(r.paid),
      total: formatAmount(sum(rows, (r) => r.paid)),
    },
    {
      header: "المتبقي",
      numeric: true,
      cell: (r) => (r.remaining > 0 ? <span className="font-semibold">{formatAmount(r.remaining)}</span> : "مسددة"),
      total: formatAmount(sum(rows, (r) => r.remaining)),
    },
  ],
});
