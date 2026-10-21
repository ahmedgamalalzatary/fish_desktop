import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import { cx } from "../lib/cx";
import { section, type DocumentSection } from "../lib/document";
import { stockColumns, stockValue } from "../lib/stock";
import { useResource } from "../lib/useResource";
import { Empty, Input, PageHeader, Panel, Select, Toggle } from "../components/ui";
import { api } from "../lib/api";
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  formatWeight,
  isoDate,
  movementLabels,
  paymentLabels,
} from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type {
  CashierReportRow,
  CategoryReportRow,
  DailyRow,
  MovementReason,
  MovementRow,
  Product,
  ProductReportRow,
  ReportSummary,
  Sale,
  SaleSummary,
} from "../lib/types";
import { ReceiptModal } from "./PosPage";

type Preset = "today" | "yesterday" | "week" | "month" | "last-month" | "year" | "custom";
type Tab = "summary" | "sales" | "products" | "categories" | "cashiers" | "stock" | "movements";

const presets: { value: Preset; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "أمس" },
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "last-month", label: "الشهر الماضي" },
  { value: "year", label: "هذه السنة" },
  { value: "custom", label: "فترة محددة" },
];

const tabs: { value: Tab; label: string }[] = [
  { value: "summary", label: "الملخص" },
  { value: "sales", label: "الفواتير" },
  { value: "products", label: "المنتجات" },
  { value: "categories", label: "التصنيفات" },
  { value: "cashiers", label: "الموظفون" },
  { value: "stock", label: "المخزون" },
  { value: "movements", label: "حركة المخزون" },
];

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const d = (y: number, m: number, day: number) => isoDate(new Date(y, m, day));
  const [y, m, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  switch (preset) {
    case "yesterday":
      return { from: d(y, m, day - 1), to: d(y, m, day - 1) };
    case "week":
      return { from: d(y, m, day - 6), to: d(y, m, day) };
    case "month":
      return { from: d(y, m, 1), to: d(y, m, day) };
    case "last-month":
      return { from: d(y, m - 1, 1), to: d(y, m, 0) };
    case "year":
      return { from: d(y, 0, 1), to: d(y, m, day) };
    default:
      return { from: d(y, m, day), to: d(y, m, day) };
  }
}

interface ReportData {
  summary: ReportSummary;
  daily: DailyRow[];
  sales: SaleSummary[];
  products: ProductReportRow[];
  categories: CategoryReportRow[];
  cashiers: CashierReportRow[];
  stock: Product[];
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
  const [rollUp, setRollUp] = useState(false);
  const [reason, setReason] = useState<MovementReason | "">("");
  const [openSale, setOpenSale] = useState<Sale | null>(null);
  const currency = settings.currency;

  const fetchReports = useCallback(async (): Promise<ReportData> => {
    const [summary, daily, sales, products, categories, cashiers, stock, movements] = await Promise.all([
      api.reportSummary(range),
      api.reportDaily(range),
      api.listSales(range),
      api.reportByProduct(range),
      api.reportByCategory(range),
      api.reportByCashier(range),
      api.listProducts(),
      api.reportMovements(range),
    ]);
    return { summary, daily, sales, products, categories, cashiers, stock, movements };
  }, [range]);
  const [data] = useResource(fetchReports);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  };

  // ---- Column definitions, shared by the screen and the printed documents ----

  const categoryRows = useMemo(() => {
    if (!data) return [];
    if (!rollUp) return data.categories;
    const merged = new Map<number, CategoryReportRow>();
    for (const r of data.categories) {
      const id = r.parent_id ?? r.category_id;
      const name = r.parent_name ?? r.name;
      const m = merged.get(id) ?? {
        category_id: id,
        name,
        parent_id: null,
        parent_name: null,
        grams: 0,
        revenue: 0,
        profit: 0,
      };
      merged.set(id, {
        ...m,
        grams: m.grams + r.grams,
        revenue: m.revenue + r.revenue,
        profit: m.profit + r.profit,
      });
    }
    return [...merged.values()].sort((a, b) => b.revenue - a.revenue);
  }, [data, rollUp]);

  const movements = useMemo(
    () => (data ? data.movements.filter((m) => !reason || m.reason === reason) : []),
    [data, reason],
  );

  if (!data) return null;
  const s = data.summary;

  const dailyColumns: Column<DailyRow>[] = [
    { header: "اليوم", cell: (r) => r.day.split("-").reverse().join("/") },
    { header: "عدد الفواتير", numeric: true, cell: (r) => r.sales_count, total: s.sales_count },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
  ];

  const paymentColumns: Column<ReportSummary["by_payment"][number]>[] = [
    { header: "طريقة الدفع", cell: (r) => paymentLabels[r.method] },
    { header: "عدد الفواتير", numeric: true, cell: (r) => r.count },
    { header: "المبلغ", numeric: true, cell: (r) => formatAmount(r.total), total: formatAmount(s.revenue) },
  ];

  const salesColumns: Column<SaleSummary>[] = [
    { header: "رقم الفاتورة", cell: (r) => `#${r.id}` },
    { header: "التاريخ", cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span> },
    { header: "الكاشير", cell: (r) => r.cashier_name },
    { header: "الدفع", cell: (r) => paymentLabels[r.payment_method] },
    { header: "الأصناف", numeric: true, cell: (r) => r.items_count },
    {
      header: "الإجمالي",
      numeric: true,
      cell: (r) => formatAmount(r.total),
      total: formatAmount(sum(data.sales, (r) => r.total)),
    },
  ];

  const productColumns: Column<ProductReportRow>[] = [
    { header: "المنتج", cell: (r) => r.name },
    { header: "التصنيف", cell: (r) => r.category_name },
    {
      header: "الوزن المباع",
      numeric: true,
      cell: (r) => formatWeight(r.grams),
      total: formatWeight(sum(data.products, (r) => r.grams)),
    },
    { header: "قطع جاهزة", numeric: true, cell: (r) => r.units || "—" },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    { header: "التكلفة", numeric: true, cell: (r) => formatAmount(r.cost), total: formatAmount(s.cost) },
    { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
    { header: "الهامش", numeric: true, cell: (r) => margin(r.profit, r.revenue) },
  ];

  const categoryColumns: Column<CategoryReportRow>[] = [
    { header: "التصنيف", cell: (r) => (r.parent_name ? `${r.parent_name} / ${r.name}` : r.name) },
    {
      header: "الوزن المباع",
      numeric: true,
      cell: (r) => formatWeight(r.grams),
      total: formatWeight(sum(categoryRows, (r) => r.grams)),
    },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
    { header: "من إجمالي المبيعات", numeric: true, cell: (r) => margin(r.revenue, s.revenue) },
  ];

  const cashierColumns: Column<CashierReportRow>[] = [
    { header: "الموظف", cell: (r) => r.name },
    { header: "عدد الفواتير", numeric: true, cell: (r) => r.sales_count, total: s.sales_count },
    {
      header: "المبيعات",
      numeric: true,
      cell: (r) => formatAmount(r.revenue),
      total: formatAmount(s.revenue),
    },
    { header: "الربح", numeric: true, cell: (r) => formatAmount(r.profit), total: formatAmount(s.profit) },
    {
      header: "متوسط الفاتورة",
      numeric: true,
      cell: (r) => formatAmount(Math.round(r.revenue / r.sales_count)),
    },
    { header: "أول فاتورة", cell: (r) => <span dir="ltr">{formatDateTime(r.first_sale)}</span> },
    { header: "آخر فاتورة", cell: (r) => <span dir="ltr">{formatDateTime(r.last_sale)}</span> },
  ];

  const stockValueTotal = sum(data.stock, stockValue);
  const stockCols = stockColumns(currency).map((c, i, all) =>
    i === all.length - 1 ? { ...c, total: formatAmount(stockValueTotal) } : c,
  );

  const movementColumns: Column<MovementRow>[] = [
    { header: "التاريخ", cell: (r) => <span dir="ltr">{formatDateTime(r.created_at)}</span> },
    { header: "المنتج", cell: (r) => r.product_name },
    { header: "النوع", cell: (r) => movementLabels[r.reason] },
    {
      header: "الكمية",
      numeric: true,
      cell: (r) => (
        <span
          dir="ltr"
          className={r.change_grams < 0 ? "text-gill print:text-black" : "text-kelp print:text-black"}
        >
          {r.change_grams > 0 ? "+" : "−"}
          {formatWeight(Math.abs(r.change_grams))}
        </span>
      ),
    },
    {
      header: "التكلفة",
      numeric: true,
      cell: (r) => (r.cost_total === null ? "—" : formatAmount(r.cost_total)),
    },
    { header: "ملاحظة", cell: (r) => r.note ?? (r.sale_id ? `فاتورة #${r.sale_id}` : "") },
    { header: "بواسطة", cell: (r) => r.user_name },
  ];

  const figures = [
    { label: "المبيعات", value: formatMoney(s.revenue, currency) },
    { label: "الربح", value: formatMoney(s.profit, currency) },
    { label: "عدد الفواتير", value: s.sales_count },
    {
      label: "متوسط الفاتورة",
      value: formatMoney(s.sales_count ? Math.round(s.revenue / s.sales_count) : 0, currency),
    },
    { label: "الوزن المباع", value: formatWeight(s.grams_sold) },
    { label: "التكلفة", value: formatMoney(s.cost, currency) },
    { label: "هامش الربح", value: margin(s.profit, s.revenue) },
    { label: "مشتريات الفترة", value: formatMoney(s.purchases_cost, currency) },
  ];

  // ---- Per-tab document for print/PDF ----

  const tabSections: Record<Tab, DocumentSection[]> = {
    summary: [
      section({ title: "المبيعات حسب طريقة الدفع", columns: paymentColumns, rows: s.by_payment }),
      section({ title: "المبيعات اليومية", columns: dailyColumns, rows: data.daily }),
    ],
    sales: [section({ columns: salesColumns, rows: data.sales })],
    products: [section({ columns: productColumns, rows: data.products })],
    categories: [section({ columns: categoryColumns, rows: categoryRows })],
    cashiers: [section({ columns: cashierColumns, rows: data.cashiers })],
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
      figures={tab === "summary" ? figures : []}
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
        section({ title: "المنتجات", columns: productColumns, rows: data.products }),
        section({ title: "التصنيفات", columns: categoryColumns, rows: categoryRows }),
        section({ title: "الموظفون", columns: cashierColumns, rows: data.cashiers }),
        section({ title: "المخزون الحالي", columns: stockCols, rows: data.stock }),
      ]}
    />
  );

  return (
    <div className="p-8">
      <PageHeader
        title="التقارير"
        actions={
          <>
            <span className="text-sm text-mist">التقرير الشامل:</span>
            <ExportButtons fileName={`تقرير-شامل-${fileRange}`} document={fullDocument} />
          </>
        }
      />

      {/* Period */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => choosePreset(p.value)}
            aria-pressed={preset === p.value}
            className={cx(
              "h-9 rounded-full border px-4 text-sm font-medium transition-colors",
              preset === p.value
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink-2 hover:border-ink-3/40",
            )}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ps-2">
            <Input
              type="date"
              className="w-40"
              value={range.from}
              max={range.to}
              onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
              aria-label="من"
            />
            <span className="text-mist">إلى</span>
            <Input
              type="date"
              className="w-40"
              value={range.to}
              min={range.from}
              onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
              aria-label="إلى"
            />
          </div>
        )}
      </div>

      {/* Key figures: one strip, the most important two first and larger. */}
      <Panel className="mb-6 grid grid-cols-[1.4fr_1.4fr_repeat(4,1fr)] divide-x divide-x-reverse divide-line">
        {figures.slice(0, 6).map((f, i) => (
          <div key={f.label} className="px-5 py-4">
            <div className="text-sm text-mist">{f.label}</div>
            <div className={cx("mt-1 font-semibold", i < 2 ? "text-2xl" : "text-lg")}>{f.value}</div>
          </div>
        ))}
      </Panel>

      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-line">
        <nav className="-mb-px flex gap-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cx(
                "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                tab === t.value ? "border-ink text-ink" : "border-transparent text-mist hover:text-ink",
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
      {tab === "categories" && (
        <>
          <div className="mb-3">
            <Toggle checked={rollUp} onChange={setRollUp} label="دمج التصنيفات الفرعية في التصنيف الرئيسي" />
          </div>
          <TabTable empty="لا توجد مبيعات في هذه الفترة">
            {categoryRows.length > 0 && (
              <DataTable columns={categoryColumns} rows={categoryRows} rowKey={(r) => r.category_id} />
            )}
          </TabTable>
        </>
      )}
      {tab === "cashiers" && (
        <TabTable empty="لا توجد مبيعات في هذه الفترة">
          {data.cashiers.length > 0 && (
            <DataTable columns={cashierColumns} rows={data.cashiers} rowKey={(r) => r.user_id} />
          )}
        </TabTable>
      )}
      {tab === "stock" && (
        <>
          <p className="mb-3 text-sm text-mist">المخزون الحالي لكل المنتجات، بغض النظر عن الفترة المختارة.</p>
          <TabTable empty="لا توجد منتجات">
            {data.stock.length > 0 && (
              <DataTable columns={stockCols} rows={data.stock} rowKey={(p) => p.id} />
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
    </div>
  );
}

function TabTable({ empty, children }: { empty: string; children: ReactNode }) {
  return <Panel className="overflow-hidden">{children || <Empty title={empty} />}</Panel>;
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
            tick={{ fill: "var(--color-mist)", fontSize: 12 }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            orientation="right"
            tickFormatter={(v: number) => (v / 100).toLocaleString("en-US")}
            tick={{ fill: "var(--color-mist)", fontSize: 12 }}
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
          <Bar dataKey="revenue" fill="var(--color-sea)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
