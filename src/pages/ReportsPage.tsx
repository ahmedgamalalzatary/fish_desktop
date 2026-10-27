import { shop } from "@shop";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { PeriodPicker } from "../components/PeriodPicker";
import { presetRange, type Preset } from "../lib/periods";
import { ReportDocument } from "../components/ReportDocument";
import { cx } from "../lib/cx";
import { section, type DocumentSection } from "../lib/document";
import { expenseByUserColumns, expenseColumns, expensesByUser } from "../lib/expenses";
import { purchaseColumns, supplierReportColumns } from "../lib/purchases";
import { stockColumns, stockRows, type StockRow } from "../lib/stock";
import { useResource } from "../lib/useResource";
import { Empty, PageHeader, Panel, Segmented, Select } from "../components/ui";
import { api } from "../lib/api";
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  formatPhones,
  isoDate,
  movementLabels,
  paymentLabels,
  paymentNames,
} from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type {
  CashierReportRow,
  DailyRow,
  Expense,
  MovementReason,
  MovementRow,
  PeriodGroup,
  PeriodRow,
  ProductReportRow,
  PurchasedItemRow,
  PurchaseSummary,
  ReportSummary,
  Sale,
  SaleSummary,
  SupplierReportRow,
} from "../lib/types";
import { ReceiptModal } from "./PosPage";
import { PurchaseDetailModal } from "./PurchasesPage";

type Tab =
  | "summary"
  | "profit"
  | "sales"
  | "products"
  | "cashiers"
  | "purchases"
  | "suppliers"
  | "expenses"
  | "stock"
  | "movements";

const tabs: { value: Tab; label: string }[] = [
  { value: "summary", label: "الملخص" },
  { value: "profit", label: "الأرباح" },
  { value: "sales", label: "الفواتير" },
  { value: "products", label: "المنتجات" },
  { value: "cashiers", label: "الموظفون" },
  { value: "purchases", label: "المشتريات" },
  { value: "suppliers", label: "الموردون" },
  { value: "expenses", label: "المصروفات" },
  { value: "stock", label: "المخزون" },
  { value: "movements", label: "حركة المخزون" },
];

const groupLabels: Record<PeriodGroup, string> = { day: "يومي", month: "شهري", year: "سنوي" };

const monthName = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric" });

/** "2026-10-22" → "22/10/2026", "2026-10" → "أكتوبر 2026", "2026" → "2026" */
function periodName(period: string): string {
  const parts = period.split("-");
  if (parts.length === 3) return parts.reverse().join("/");
  if (parts.length === 2) return monthName.format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1));
  return period;
}

interface ReportData {
  summary: ReportSummary;
  daily: DailyRow[];
  sales: SaleSummary[];
  products: ProductReportRow[];
  cashiers: CashierReportRow[];
  purchases: PurchaseSummary[];
  suppliers: SupplierReportRow[];
  purchasedItems: PurchasedItemRow[];
  expenses: Expense[];
  stock: StockRow[];
  movements: MovementRow[];
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const margin = (profit: number, revenue: number) =>
  revenue ? `${Math.round((profit / revenue) * 100)}%` : "—";

export function ReportsPage() {
  const { settings } = useSession();
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState(presetRange("today"));
  const [tab, setTab] = useState<Tab>("summary");
  const [group, setGroup] = useState<PeriodGroup>("day");
  const [purchasesBy, setPurchasesBy] = useState<"invoice" | "item">("invoice");
  const [reason, setReason] = useState<MovementReason | "">("");
  const [openSale, setOpenSale] = useState<Sale | null>(null);
  const [openPurchase, setOpenPurchase] = useState<number | null>(null);
  const currency = settings.currency;

  const fetchReports = useCallback(async (): Promise<ReportData> => {
    const [
      summary,
      daily,
      sales,
      products,
      cashiers,
      purchases,
      suppliers,
      purchasedItems,
      expenses,
      stock,
      movements,
    ] = await Promise.all([
      api.reportSummary(range),
      api.reportDaily(range),
      api.listSales(range),
      api.reportByProduct(range),
      api.reportByCashier(range),
      api.listPurchases(range),
      api.reportBySupplier(range),
      api.reportPurchasedItems(range),
      api.listExpenses(range),
      api.listProducts().then(stockRows),
      api.reportMovements(range),
    ]);
    return {
      summary,
      daily,
      sales,
      products,
      cashiers,
      purchases,
      suppliers,
      purchasedItems,
      expenses,
      stock,
      movements,
    };
  }, [range]);
  const [data] = useResource(fetchReports);
  // Loaded on its own so switching between daily, monthly and yearly does not reload everything.
  const [periods] = useResource(useCallback(() => api.reportPeriods(range, group), [range, group]));

  // ---- Column definitions, shared by the screen and the printed documents ----

  const movements = useMemo(
    () => (data ? data.movements.filter((m) => !reason || m.reason === reason) : []),
    [data, reason],
  );

  if (!data) return null;
  const s = data.summary;

  const dailyColumns: Column<DailyRow>[] = [
    { header: "اليوم", cell: (r) => r.day.split("-").reverse().join("/") },
    {
      header: "عدد الفواتير",
      numeric: true,
      cell: (r) => r.sales_count,
      total: s.sales_count,
    },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    {
      header: "الربح",
      numeric: true,
      cell: (r) => formatAmount(r.profit),
      total: formatAmount(s.profit),
    },
  ];

  const paymentColumns: Column<ReportSummary["by_payment"][number]>[] = [
    { header: "طريقة الدفع", cell: (r) => paymentLabels[r.method] },
    { header: "عدد الفواتير", numeric: true, cell: (r) => r.count },
    {
      header: "المبلغ",
      numeric: true,
      cell: (r) => formatAmount(r.total),
      total: formatAmount(s.revenue),
    },
  ];

  const salesColumns: Column<SaleSummary>[] = [
    { header: "رقم الفاتورة", cell: (r) => `#${r.id}` },
    {
      header: "التاريخ",
      cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span>,
    },
    { header: "الكاشير", cell: (r) => r.cashier_name },
    { header: "الدفع", cell: (r) => paymentNames(r.methods) },
    { header: "الأصناف", numeric: true, cell: (r) => r.items_count },
    {
      header: "الإجمالي",
      numeric: true,
      cell: (r) => formatAmount(r.total),
      total: formatAmount(sum(data.sales, (r) => r.total)),
    },
  ];

  const productColumns: Column<ProductReportRow>[] = [
    { header: "الموديل", cell: (r) => r.name },
    {
      header: "الأجهزة المباعة",
      numeric: true,
      cell: (r) => r.units,
      total: sum(data.products, (r) => r.units),
    },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (r) => formatAmount(r.cost),
      total: formatAmount(s.cost),
    },
    {
      header: "الربح",
      numeric: true,
      cell: (r) => formatAmount(r.profit),
      total: formatAmount(s.profit),
    },
    {
      header: "الهامش",
      numeric: true,
      cell: (r) => margin(r.profit, r.revenue),
    },
  ];

  const cashierColumns: Column<CashierReportRow>[] = [
    { header: "الموظف", cell: (r) => r.name },
    {
      header: "عدد الفواتير",
      numeric: true,
      cell: (r) => r.sales_count,
      total: s.sales_count,
    },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    {
      header: "الربح",
      numeric: true,
      cell: (r) => formatAmount(r.profit),
      total: formatAmount(s.profit),
    },
    {
      header: "متوسط الفاتورة",
      numeric: true,
      cell: (r) => formatAmount(Math.round(r.revenue / r.sales_count)),
    },
    {
      header: "أول فاتورة",
      cell: (r) => <span dir="ltr">{formatDateTime(r.first_sale)}</span>,
    },
    {
      header: "آخر فاتورة",
      cell: (r) => <span dir="ltr">{formatDateTime(r.last_sale)}</span>,
    },
  ];

  const stockCols = stockColumns(data.stock);

  const movementColumns: Column<MovementRow>[] = [
    {
      header: "التاريخ",
      cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span>,
    },
    { header: "الموديل", cell: (r) => r.product_name },
    { header: "الرقم التسلسلي", cell: (r) => <span dir="ltr">{r.serial}</span> },
    { header: "الحركة", cell: (r) => movementLabels[r.reason] },
    {
      header: "الكمية",
      numeric: true,
      cell: (r) => (
        <span
          dir="ltr"
          className={r.change_qty < 0 ? "text-danger print:text-black" : "text-ok print:text-black"}
        >
          {r.change_qty > 0 ? "+" : "−"}
          {Math.abs(r.change_qty)}
        </span>
      ),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (r) => (r.cost_total === null ? "—" : formatAmount(r.cost_total)),
    },
    {
      header: "ملاحظة",
      cell: (r) =>
        r.note ??
        (r.sale_id
          ? `فاتورة #${r.sale_id}`
          : r.purchase_id
            ? `شراء #${r.purchase_id} · ${r.supplier_name}`
            : ""),
    },
    { header: "بواسطة", cell: (r) => r.user_name },
  ];

  const figures = [
    { label: "المبيعات", value: formatMoney(s.revenue, currency) },
    { label: "صافي الربح", value: formatMoney(s.net_profit, currency) },
    { label: "المشتريات", value: formatMoney(s.purchases_cost, currency) },
    { label: "المصروفات", value: formatMoney(s.expenses, currency) },
    { label: "إجمالي الربح", value: formatMoney(s.profit, currency) },
    { label: "الأجهزة المباعة", value: formatPhones(s.units_sold) },
    { label: "عدد الفواتير", value: s.sales_count },
    {
      label: "متوسط الفاتورة",
      value: formatMoney(s.sales_count ? Math.round(s.revenue / s.sales_count) : 0, currency),
    },
    { label: "تكلفة الأجهزة المباعة", value: formatMoney(s.cost, currency) },
    { label: "هامش الربح", value: margin(s.profit, s.revenue) },
    { label: "الأجهزة المشتراة", value: formatPhones(s.purchases_units) },
    { label: "مدفوع للموردين", value: formatMoney(s.supplier_paid, currency) },
    {
      label: "مستحق للموردين حالياً",
      value: formatMoney(
        sum(data.suppliers, (r) => r.balance),
        currency,
      ),
    },
  ];

  const purchaseCols = purchaseColumns(data.purchases);
  const supplierCols = supplierReportColumns(data.suppliers);
  const expenseCols = expenseColumns(data.expenses);
  const expenseUsers = expensesByUser(data.expenses);
  const expenseUserCols = expenseByUserColumns(expenseUsers);
  const periodRows = periods ?? [];

  const purchasedItemColumns: Column<PurchasedItemRow>[] = [
    { header: "الموديل", cell: (r) => r.name },
    {
      header: "الأجهزة المشتراة",
      numeric: true,
      cell: (r) => r.units,
      total: sum(data.purchasedItems, (r) => r.units),
    },
    {
      header: "متوسط سعر الجهاز",
      numeric: true,
      cell: (r) => (r.units ? formatAmount(Math.round(r.cost / r.units)) : "—"),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (r) => formatAmount(r.cost),
      total: formatAmount(sum(data.purchasedItems, (r) => r.cost)),
    },
  ];

  const signed = (cents: number) => (
    <span className={cents < 0 ? "text-danger print:text-black" : undefined}>{formatAmount(cents)}</span>
  );
  const periodColumns: Column<PeriodRow>[] = [
    { header: "الفترة", cell: (r) => periodName(r.period) },
    {
      header: "المشتريات",
      numeric: true,
      cell: (r) => formatAmount(r.purchases_cost),
      total: formatAmount(s.purchases_cost),
    },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    {
      header: "الأجهزة المباعة",
      numeric: true,
      cell: (r) => r.units_sold,
      total: s.units_sold,
    },
    {
      header: "إجمالي الربح",
      numeric: true,
      cell: (r) => formatAmount(r.profit),
      total: formatAmount(s.profit),
    },
    {
      header: "المصروفات",
      numeric: true,
      cell: (r) => formatAmount(r.expenses),
      total: formatAmount(s.expenses),
    },
    {
      header: "صافي الربح",
      numeric: true,
      cell: (r) => <span className="font-semibold">{signed(r.net_profit)}</span>,
      total: signed(s.net_profit),
    },
  ];

  // ---- Per-tab document for print/PDF ----

  const tabSections: Record<Tab, DocumentSection[]> = {
    summary: [
      section({
        title: "المبيعات حسب طريقة الدفع",
        columns: paymentColumns,
        rows: s.by_payment,
      }),
      section({
        title: "المبيعات اليومية",
        columns: dailyColumns,
        rows: data.daily,
      }),
    ],
    profit: [section({ title: `الأرباح · ${groupLabels[group]}`, columns: periodColumns, rows: periodRows })],
    sales: [section({ columns: salesColumns, rows: data.sales })],
    products: [section({ columns: productColumns, rows: data.products })],
    cashiers: [section({ columns: cashierColumns, rows: data.cashiers })],
    purchases: [
      section({ title: "حسب الصنف", columns: purchasedItemColumns, rows: data.purchasedItems }),
      section({ title: "فواتير الشراء", columns: purchaseCols, rows: data.purchases }),
    ],
    suppliers: [section({ columns: supplierCols, rows: data.suppliers })],
    expenses: [
      section({ title: "حسب الموظف", columns: expenseUserCols, rows: expenseUsers }),
      section({ title: "المصروفات", columns: expenseCols, rows: data.expenses }),
    ],
    stock: [section({ columns: stockCols, rows: data.stock })],
    movements: [section({ columns: movementColumns, rows: movements })],
  };
  const tabLabel = tabs.find((t) => t.value === tab)!.label;
  const isSnapshot = tab === "stock";
  const fileRange = range.from === range.to ? range.from : `${range.from}_${range.to}`;

  const tabDocument = () => (
    <ReportDocument
      settings={settings}
      title={isSnapshot ? "تقرير المخزون الحالي" : `تقرير ${tabLabel}`}
      from={isSnapshot ? undefined : range.from}
      to={isSnapshot ? undefined : range.to}
      figures={tab === "summary" || tab === "profit" ? figures : []}
      sections={tabSections[tab]}
    />
  );

  const fullDocument = () => (
    <ReportDocument
      settings={settings}
      title="التقرير الشامل"
      from={range.from}
      to={range.to}
      figures={figures}
      sections={[
        ...tabSections.summary,
        ...tabSections.profit,
        section({
          title: "المنتجات",
          columns: productColumns,
          rows: data.products,
        }),
        section({
          title: "الموظفون",
          columns: cashierColumns,
          rows: data.cashiers,
        }),
        section({
          title: "المشتريات حسب الصنف",
          columns: purchasedItemColumns,
          rows: data.purchasedItems,
        }),
        section({
          title: "الموردون",
          columns: supplierCols,
          rows: data.suppliers,
        }),
        section({
          title: "المصروفات حسب الموظف",
          columns: expenseUserCols,
          rows: expenseUsers,
        }),
        section({
          title: "المصروفات",
          columns: expenseCols,
          rows: data.expenses,
        }),
        section({
          title: "المخزون الحالي",
          columns: stockCols,
          rows: data.stock,
        }),
      ]}
    />
  );

  return (
    <div className="p-8">
      <PageHeader
        title="التقارير"
        actions={
          <>
            <span className="text-sm text-muted">التقرير الشامل:</span>
            <ExportButtons fileName={`تقرير-شامل-${fileRange}`} document={fullDocument} />
          </>
        }
      />

      <div className="mb-6">
        <PeriodPicker preset={preset} range={range} onChange={(p, r) => (setPreset(p), setRange(r))} />
      </div>

      {/* Key figures: one strip, the most important two first and larger. */}
      <Panel className="mb-6 grid grid-cols-[1.4fr_1.4fr_repeat(4,1fr)] divide-x divide-x-reverse divide-line">
        {figures.slice(0, 6).map((f, i) => (
          <div key={f.label} className="px-5 py-4">
            <div className="text-sm text-muted">{f.label}</div>
            <div className={cx("mt-1 font-semibold", i < 2 ? "text-2xl" : "text-lg")}>{f.value}</div>
          </div>
        ))}
      </Panel>

      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-line">
        <nav className="-mb-px flex min-w-0 gap-1 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cx(
                "shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                tab === t.value ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex gap-2 pb-2">
          <ExportButtons
            fileName={`تقرير-${tabLabel}-${isSnapshot ? isoDate(new Date()) : fileRange}`}
            document={tabDocument}
          />
        </div>
      </div>

      {tab === "summary" && (
        <div className="grid grid-cols-[2fr_1fr] gap-6">
          <Panel className="p-5">
            <h2 className="mb-4 font-semibold">المبيعات اليومية</h2>
            <DailyChart rows={data.daily} from={range.from} to={range.to} currency={currency} />
          </Panel>
          <Panel className="overflow-hidden">
            <h2 className="px-5 pt-5 pb-2 font-semibold">حسب طريقة الدفع</h2>
            {s.by_payment.length ? (
              <DataTable columns={paymentColumns} rows={s.by_payment} rowKey={(r) => r.method} />
            ) : (
              <Empty title="لا توجد مبيعات في هذه الفترة" />
            )}
          </Panel>
        </div>
      )}
      {tab === "profit" && (
        <>
          <div className="mb-6 grid grid-cols-[3fr_2fr] items-start gap-6">
            <ProfitStatement summary={s} currency={currency} />
            <Panel className="p-6">
              <h2 className="mb-4 font-semibold">البضاعة المشتراة</h2>
              <dl className="flex flex-col gap-3 text-sm">
                <Line label="المشتريات" value={formatMoney(s.purchases_cost, currency)} strong />
                <Line label="الأجهزة المستلمة" value={formatPhones(s.purchases_units)} />
                <Line label="مدفوع للموردين في الفترة" value={formatMoney(s.supplier_paid, currency)} />
                <Line
                  label="مستحق للموردين حالياً"
                  value={formatMoney(
                    sum(data.suppliers, (r) => r.balance),
                    currency,
                  )}
                />
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted">
                تكلفة البضاعة تُحسب في الربح عند بيعها، لا عند شرائها؛ لذلك قد تختلف المشتريات عن تكلفة
                الأجهزة المباعة.
              </p>
            </Panel>
          </div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-semibold">حسب الفترة</h2>
            <div className="w-64">
              <Segmented
                value={group}
                onChange={setGroup}
                options={(Object.keys(groupLabels) as PeriodGroup[]).map((g) => ({
                  value: g,
                  label: groupLabels[g],
                }))}
              />
            </div>
          </div>
          <TabTable empty="لا توجد مبيعات أو مشتريات أو مصروفات في هذه الفترة">
            {periodRows.length > 0 && (
              <DataTable columns={periodColumns} rows={periodRows} rowKey={(r) => r.period} />
            )}
          </TabTable>
        </>
      )}
      {tab === "sales" && (
        <TabTable empty="لا توجد فواتير في هذه الفترة">
          {data.sales.length > 0 && (
            <DataTable
              columns={salesColumns}
              rows={data.sales}
              rowKey={(r) => r.id}
              onRowClick={(r) => api.getSale(r.id).then(setOpenSale, (e) => toast(errorMessage(e), "error"))}
            />
          )}
        </TabTable>
      )}
      {tab === "products" && (
        <TabTable empty="لم يُبع أي منتج في هذه الفترة">
          {data.products.length > 0 && (
            <DataTable columns={productColumns} rows={data.products} rowKey={(r) => r.product_id} />
          )}
        </TabTable>
      )}
      {tab === "cashiers" && (
        <TabTable empty="لا توجد مبيعات في هذه الفترة">
          {data.cashiers.length > 0 && (
            <DataTable columns={cashierColumns} rows={data.cashiers} rowKey={(r) => r.user_id} />
          )}
        </TabTable>
      )}
      {tab === "purchases" && (
        <>
          <div className="mb-3 w-72">
            <Segmented
              value={purchasesBy}
              onChange={setPurchasesBy}
              options={[
                { value: "invoice", label: "حسب الفاتورة" },
                { value: "item", label: "حسب الصنف" },
              ]}
            />
          </div>
          <TabTable empty="لا توجد فواتير شراء في هذه الفترة">
            {purchasesBy === "invoice"
              ? data.purchases.length > 0 && (
                  <DataTable
                    columns={purchaseCols}
                    rows={data.purchases}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => setOpenPurchase(r.id)}
                  />
                )
              : data.purchasedItems.length > 0 && (
                  <DataTable
                    columns={purchasedItemColumns}
                    rows={data.purchasedItems}
                    rowKey={(r) => r.product_id}
                  />
                )}
          </TabTable>
        </>
      )}
      {tab === "suppliers" && (
        <>
          <p className="mb-3 text-sm text-muted">
            المشتريات والمدفوع خلال الفترة المختارة، و«المستحق حالياً» هو رصيد كل مورد اليوم.
          </p>
          <TabTable empty="لا توجد مشتريات أو مستحقات للموردين">
            {data.suppliers.length > 0 && (
              <DataTable columns={supplierCols} rows={data.suppliers} rowKey={(r) => r.supplier_id} />
            )}
          </TabTable>
        </>
      )}
      {tab === "expenses" && (
        <div className="grid grid-cols-[2fr_1fr] items-start gap-6">
          <TabTable empty="لا توجد مصروفات في هذه الفترة">
            {data.expenses.length > 0 && (
              <DataTable columns={expenseCols} rows={data.expenses} rowKey={(r) => r.id} />
            )}
          </TabTable>
          <Panel className="overflow-hidden">
            <h2 className="px-5 pt-5 pb-2 font-semibold">حسب الموظف</h2>
            {expenseUsers.length ? (
              <DataTable columns={expenseUserCols} rows={expenseUsers} rowKey={(r) => r.user_id} />
            ) : (
              <Empty title="لا توجد مصروفات" />
            )}
          </Panel>
        </div>
      )}
      {tab === "stock" && (
        <>
          <p className="mb-3 text-sm text-muted">
            المخزون الحالي لكل المنتجات، بغض النظر عن الفترة المختارة.
          </p>
          <TabTable empty="لا توجد منتجات">
            {data.stock.length > 0 && (
              <DataTable columns={stockCols} rows={data.stock} rowKey={(r) => r.phone.id} />
            )}
          </TabTable>
        </>
      )}
      {tab === "movements" && (
        <>
          <div className="mb-3 w-56">
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as MovementReason | "")}
              aria-label="نوع الحركة"
            >
              <option value="">كل الحركات</option>
              {(Object.keys(movementLabels) as MovementReason[]).map((r) => (
                <option key={r} value={r}>
                  {movementLabels[r]}
                </option>
              ))}
            </Select>
          </div>
          <TabTable empty="لا توجد حركات في هذه الفترة">
            {movements.length > 0 && (
              <DataTable columns={movementColumns} rows={movements} rowKey={(r) => r.id} />
            )}
          </TabTable>
        </>
      )}

      {openSale && <ReceiptModal sale={openSale} onClose={() => setOpenSale(null)} />}
      {openPurchase !== null && (
        <PurchaseDetailModal id={openPurchase} onClose={() => setOpenPurchase(null)} />
      )}
    </div>
  );
}

function TabTable({ empty, children }: { empty: string; children: ReactNode }) {
  return <Panel className="overflow-hidden">{children || <Empty title={empty} />}</Panel>;
}

function Line({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "text-lg font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );
}

/**
 * Sales down to net profit as a running sum: each step subtracts from the line above it,
 * and the result lands on the phone screen at the bottom.
 */
function ProfitStatement({ summary: s, currency }: { summary: ReportSummary; currency: string }) {
  const steps: { label: string; note?: string; value: number; kind: "plus" | "minus" | "result" }[] = [
    {
      label: "المبيعات",
      note: `${s.sales_count} فاتورة · ${formatPhones(s.units_sold)}`,
      value: s.revenue,
      kind: "plus",
    },
    { label: "تكلفة الأجهزة المباعة", value: s.cost, kind: "minus" },
    { label: "إجمالي الربح", note: `هامش ${margin(s.profit, s.revenue)}`, value: s.profit, kind: "result" },
    { label: "المصروفات", value: s.expenses, kind: "minus" },
  ];
  return (
    <Panel className="p-6">
      <h2 className="mb-4 font-semibold">حساب الأرباح للفترة</h2>
      <dl className="flex flex-col">
        {steps.map((step) => (
          <div
            key={step.label}
            className={cx(
              "flex items-baseline justify-between gap-4 py-3",
              step.kind === "result" ? "border-y border-ink/70 font-semibold" : "text-ink-2",
            )}
          >
            <dt>
              {step.label}
              {step.note && <span className="ms-2 text-xs font-normal text-muted">{step.note}</span>}
            </dt>
            <dd dir="ltr" className="font-display text-xl font-light">
              {step.kind === "minus" && <span className="me-1 text-muted">−</span>}
              {formatAmount(step.value)}
            </dd>
          </div>
        ))}
      </dl>
      <shop.Readout
        className="mt-4"
        label={s.net_profit < 0 ? "خسارة الفترة" : "صافي الربح"}
        value={formatAmount(Math.abs(s.net_profit))}
        unit={currency}
        warn={s.net_profit < 0}
      />
    </Panel>
  );
}

/** Revenue per day; one series, so the title names it and no legend is needed. */
function DailyChart({
  rows,
  from,
  to,
  currency,
}: {
  rows: DailyRow[];
  from: string;
  to: string;
  currency: string;
}) {
  // Fill gaps so quiet days show as empty slots instead of disappearing.
  const points = useMemo(() => {
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: DailyRow[] = [];
    const end = new Date(`${to}T00:00`);
    for (let d = new Date(`${from}T00:00`); d <= end && out.length < 400; d.setDate(d.getDate() + 1)) {
      const key = isoDate(d);
      out.push(byDay.get(key) ?? { day: key, sales_count: 0, revenue: 0, profit: 0 });
    }
    return out;
  }, [rows, from, to]);

  if (rows.length === 0) return <Empty title="لا توجد مبيعات في هذه الفترة" />;

  return (
    <div className="h-72" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="0" />
          <XAxis
            dataKey="day"
            reversed
            tickFormatter={(d: string) => d.slice(8) + "/" + d.slice(5, 7)}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            orientation="right"
            tickFormatter={(v: number) => (v / 100).toLocaleString("en-US")}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ fill: "var(--color-ink)", fillOpacity: 0.05 }}
            content={({ active, payload }) => {
              const r = active && (payload?.[0]?.payload as DailyRow | undefined);
              if (!r) return null;
              return (
                <div dir="rtl" className="rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-lg">
                  <div className="mb-1 text-white/70">{r.day.split("-").reverse().join("/")}</div>
                  <div>المبيعات: {formatMoney(r.revenue, currency)}</div>
                  <div>الربح: {formatMoney(r.profit, currency)}</div>
                  <div>الفواتير: {r.sales_count}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="revenue" fill="var(--color-chart)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
