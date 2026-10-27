import { LogOut, PackagePlus, Pencil, Plus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import { AddPhonesModal, EditPhoneModal, RemovePhoneModal } from "../components/PhoneModals";
import { Button, Empty, Input, PageHeader, Panel, Select } from "../components/ui";
import { api } from "../lib/api";
import { section } from "../lib/document";
import { formatMoney, formatPhones, isoDate } from "../lib/format";
import { useSession } from "../lib/session";
import { stockColumns, stockRows, type StockRow } from "../lib/stock";
import { useResource } from "../lib/useResource";
import { PurchaseFormModal } from "./PurchasesPage";

const matches = (r: StockRow, q: string) =>
  [r.product.name, r.phone.serial, r.phone.storage, r.phone.color].some((s) => s.toLowerCase().includes(q));

export function StockPage() {
  const { settings } = useSession();
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [action, setAction] = useState<
    { kind: "add" } | { kind: "purchase" } | { kind: "edit" | "remove"; row: StockRow } | null
  >(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(), []));
  const products = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => stockRows(products), [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (!productId || String(r.product.id) === productId) && (!q || matches(r, q)));
  }, [rows, query, productId]);
  const costValue = visible.reduce((s, r) => s + r.phone.cost, 0);
  const priceValue = visible.reduce((s, r) => s + r.phone.price, 0);

  const columns: Column<StockRow>[] = [
    ...stockColumns(visible),
    {
      header: "",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            tone="ghost"
            size="icon"
            onClick={() => setAction({ kind: "edit", row: r })}
            aria-label="تعديل"
          >
            <Pencil className="size-4" />
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setAction({ kind: "remove", row: r })}>
            <LogOut className="size-4 -scale-x-100" />
            إخراج
          </Button>
        </div>
      ),
    },
  ];

  const figures = [
    { label: "الأجهزة في المخزون", value: formatPhones(visible.length) },
    { label: "قيمتها بسعر الشراء", value: formatMoney(costValue, settings.currency) },
    { label: "قيمتها بسعر البيع", value: formatMoney(priceValue, settings.currency) },
    { label: "الربح المتوقع", value: formatMoney(priceValue - costValue, settings.currency) },
  ];
  const done = () => (setAction(null), load());
  const active = products.filter((p) => p.active);

  return (
    <div className="p-8">
      <PageHeader
        title="المخزون"
        actions={
          <>
            <ExportButtons
              disabled={visible.length === 0}
              fileName={`المخزون-${isoDate(new Date())}`}
              document={() => (
                <ReportDocument
                  settings={settings}
                  title="تقرير المخزون"
                  figures={figures}
                  sections={[section({ columns: stockColumns(visible), rows: visible })]}
                />
              )}
            />
            <Button tone="outline" onClick={() => setAction({ kind: "purchase" })}>
              <PackagePlus className="size-4" />
              فاتورة شراء
            </Button>
            <Button onClick={() => setAction({ kind: "add" })} disabled={active.length === 0}>
              <Plus className="size-4" />
              إضافة أجهزة
            </Button>
          </>
        }
      />

      <Panel className="mb-6 grid grid-cols-4 divide-x divide-x-reverse divide-line">
        {figures.map((f) => (
          <div key={f.label} className="px-5 py-4">
            <div className="text-sm text-muted">{f.label}</div>
            <div className="mt-1 text-lg font-semibold">{f.value}</div>
          </div>
        ))}
      </Panel>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالرقم التسلسلي أو الموديل أو اللون"
            className="ps-9"
          />
        </div>
        <Select
          className="w-64"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          aria-label="الموديل"
        >
          <option value="">كل الموديلات</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.phones.length})
            </option>
          ))}
        </Select>
      </div>

      <Panel className="overflow-hidden">
        {visible.length === 0 ? (
          <Empty title={rows.length === 0 ? "المخزون فارغ" : "لا يوجد جهاز بهذا البحث"}>
            {rows.length === 0 && "أضف الأجهزة من «إضافة أجهزة» أو من «فاتورة شراء»، برقم تسلسلي لكل جهاز."}
          </Empty>
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(r) => r.phone.id} />
        )}
      </Panel>

      {action?.kind === "add" && (
        <AddPhonesModal products={active} onClose={() => setAction(null)} onSaved={done} />
      )}
      {action?.kind === "purchase" && <PurchaseFormModal onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === "edit" && (
        <EditPhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />
      )}
      {action?.kind === "remove" && (
        <RemovePhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />
      )}
    </div>
  );
}
