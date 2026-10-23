import { ClipboardCheck, PackagePlus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import { section } from "../lib/document";
import { isLowStock as isLow, stockColumns, stockRows, stockValue, type StockRow } from "../lib/stock";
import { useResource } from "../lib/useResource";
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Panel, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { formatAmount, formatMoney, formatPieces, isoDate, itemName, parseCount } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { PurchaseFormModal } from "./PurchasesPage";

type Filter = "all" | "low" | "out";

const rowKey = (r: StockRow) => r.variant.id;
const rowName = (r: StockRow) => itemName(r.product.name, r.variant.label);

export function StockPage() {
  const { settings } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<{
    kind: "purchase" | "adjust";
    row: StockRow;
  } | null>(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(), []));
  const rows = useMemo(() => stockRows(data ?? []), [data]);

  const counts = {
    low: rows.filter((r) => isLow(r.variant)).length,
    out: rows.filter((r) => r.variant.stock <= 0).length,
  };
  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filter === "all" || (filter === "low" ? isLow(r.variant) : r.variant.stock <= 0)) &&
          (!query.trim() || rowName(r).includes(query.trim())),
      ),
    [rows, filter, query],
  );
  const totalValue = visible.reduce((s, r) => s + stockValue(r.variant), 0);

  const columns: Column<StockRow>[] = [
    ...stockColumns(settings.currency).map((c) =>
      c.header === "المتوفر"
        ? {
            ...c,
            cell: ({ variant: v }: StockRow) => (
              <span className="inline-flex items-center gap-2">
                {v.stock <= 0 ? (
                  <Badge tone="danger">نفد</Badge>
                ) : (
                  isLow(v) && <Badge tone="danger">منخفض</Badge>
                )}
                <span className={v.stock <= 0 || isLow(v) ? "font-medium text-alert" : "font-medium"}>
                  {formatPieces(v.stock)}
                </span>
              </span>
            ),
          }
        : c,
    ),
    {
      header: "",
      cell: (r) => (
        <div className="flex justify-end gap-2">
          <Button tone="outline" size="sm" onClick={() => setAction({ kind: "purchase", row: r })}>
            <PackagePlus className="size-4" />
            استلام
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setAction({ kind: "adjust", row: r })}>
            <ClipboardCheck className="size-4" />
            جرد
          </Button>
        </div>
      ),
    },
  ];
  columns[columns.length - 2].total = formatAmount(totalValue);

  const filterTitle = {
    all: "تقرير المخزون",
    low: "أصناف قاربت على النفاد",
    out: "أصناف نفدت",
  }[filter];

  return (
    <div className="p-8">
      <PageHeader
        title="المخزون"
        actions={
          <ExportButtons
            disabled={visible.length === 0}
            fileName={`المخزون-${isoDate(new Date())}`}
            document={() => (
              <ReportDocument
                settings={settings}
                title={filterTitle}
                figures={[
                  { label: "عدد الأصناف", value: visible.length },
                  {
                    label: "قيمة المخزون بسعر الشراء",
                    value: formatMoney(totalValue, settings.currency),
                  },
                  { label: "منخفض", value: counts.low },
                  { label: "نفد", value: counts.out },
                ]}
                sections={[
                  section({
                    columns: stockColumns(settings.currency).map((c, i, all) =>
                      i === all.length - 1 ? { ...c, total: formatAmount(totalValue) } : c,
                    ),
                    rows: visible,
                  }),
                ]}
              />
            )}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-96">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "الكل" },
              { value: "low", label: `منخفض (${counts.low})` },
              { value: "out", label: `نفد (${counts.out})` },
            ]}
          />
        </div>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث"
            className="ps-9"
          />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {visible.length === 0 ? (
          <Empty title={rows.length === 0 ? "لا توجد منتجات" : "لا يوجد ما يطابق هذا الفلتر"} />
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={rowKey} />
        )}
      </Panel>

      {action?.kind === "purchase" && (
        <PurchaseFormModal
          variantId={action.row.variant.id}
          onClose={() => setAction(null)}
          onSaved={() => (setAction(null), load())}
        />
      )}
      {action?.kind === "adjust" && (
        <AdjustModal
          row={action.row}
          onClose={() => setAction(null)}
          onSaved={() => (setAction(null), load())}
        />
      )}
    </div>
  );
}

function AdjustModal({ row, onClose, onSaved }: { row: StockRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const current = row.variant.stock;
  const [text, setText] = useState(String(Math.max(current, 0)));
  const [note, setNote] = useState("");
  const counted = parseCount(text);
  const diff = counted === null ? null : counted - current;
  const name = rowName(row);

  const save = async () => {
    if (counted === null) return toast("اكتب عدد القطع رقماً صحيحاً", "error");
    try {
      await api.adjustStock(row.variant.id, counted, note);
      toast(`حُدّث مخزون «${name}»`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={`جرد · ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={diff === 0}>
            حفظ الجرد
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm leading-6 text-ink-2">
          اكتب عدد القطع الموجودة فعلاً على الرف وفي المخزن. يُسجَّل الفرق في حركة المخزون (تالف، مفقود، أو
          خطأ سابق).
        </p>
        <Field
          label="العدد الفعلي"
          hint={
            diff !== null && diff !== 0
              ? `${diff > 0 ? "زيادة" : "نقص"} ${formatPieces(Math.abs(diff))} عن المسجّل (${formatPieces(current)})`
              : `المسجّل حالياً: ${formatPieces(current)}`
          }
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Field label="السبب">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: شاشة مكسورة"
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
