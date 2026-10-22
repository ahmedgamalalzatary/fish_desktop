import { PackagePlus, Scale, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import { section } from "../lib/document";
import { isLowStock as isLow, stockColumns, stockValue } from "../lib/stock";
import { useResource } from "../lib/useResource";
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Panel, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { formatAmount, formatMoney, formatWeight, gramsToKg, isoDate, parseKg } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { PurchaseFormModal } from "./PurchasesPage";
import type { Product } from "../lib/types";

type Filter = "all" | "low" | "out";

export function StockPage() {
  const { settings } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<{
    kind: "purchase" | "adjust";
    product: Product;
  } | null>(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(), []));
  const products = useMemo(() => data ?? [], [data]);

  const counts = {
    low: products.filter(isLow).length,
    out: products.filter((p) => p.stock_grams <= 0).length,
  };
  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          (filter === "all" || (filter === "low" ? isLow(p) : p.stock_grams <= 0)) &&
          (!query.trim() || p.name.includes(query.trim())),
      ),
    [products, filter, query],
  );
  const totalValue = visible.reduce((s, p) => s + stockValue(p), 0);

  const columns: Column<Product>[] = [
    ...stockColumns(settings.currency).map((c) =>
      c.header === "المتوفر"
        ? {
            ...c,
            cell: (p: Product) => (
              <span className="inline-flex items-center gap-2">
                {p.stock_grams <= 0 ? (
                  <Badge tone="danger">نفد</Badge>
                ) : (
                  isLow(p) && <Badge tone="danger">منخفض</Badge>
                )}
                <span className={p.stock_grams <= 0 || isLow(p) ? "font-medium text-gill" : "font-medium"}>
                  {formatWeight(p.stock_grams)}
                </span>
              </span>
            ),
          }
        : c,
    ),
    {
      header: "",
      cell: (p) => (
        <div className="flex justify-end gap-2">
          <Button tone="outline" size="sm" onClick={() => setAction({ kind: "purchase", product: p })}>
            <PackagePlus className="size-4" />
            استلام
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setAction({ kind: "adjust", product: p })}>
            <Scale className="size-4" />
            جرد
          </Button>
        </div>
      ),
    },
  ];
  columns[columns.length - 2].total = formatAmount(totalValue);

  const filterTitle = {
    all: "تقرير المخزون",
    low: "منتجات قاربت على النفاد",
    out: "منتجات نفدت",
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
                  { label: "عدد المنتجات", value: visible.length },
                  {
                    label: "قيمة المخزون بالتكلفة",
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
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
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
          <Empty title={products.length === 0 ? "لا توجد منتجات" : "لا يوجد ما يطابق هذا الفلتر"} />
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(p) => p.id} />
        )}
      </Panel>

      {action?.kind === "purchase" && (
        <PurchaseFormModal
          productId={action.product.id}
          onClose={() => setAction(null)}
          onSaved={() => (setAction(null), load())}
        />
      )}
      {action?.kind === "adjust" && (
        <AdjustModal
          product={action.product}
          onClose={() => setAction(null)}
          onSaved={() => (setAction(null), load())}
        />
      )}
    </div>
  );
}

function AdjustModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kg, setKg] = useState(gramsToKg(Math.max(product.stock_grams, 0)));
  const [note, setNote] = useState("");
  const grams = parseKg(kg);
  const diff = grams === null ? null : grams - product.stock_grams;

  const save = async () => {
    if (grams === null) return toast("أدخل الكمية بشكل صحيح", "error");
    try {
      await api.adjustStock(product.id, grams, note);
      toast(`حُدّث مخزون «${product.name}»`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={`جرد · ${product.name}`}
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
          اكتب الكمية الموجودة فعلاً بعد الوزن. يُسجَّل الفرق في حركة المخزون (هالك، تالف، أو خطأ سابق).
        </p>
        <Field
          label="الكمية الفعلية (كجم)"
          hint={
            diff !== null && diff !== 0
              ? `${diff > 0 ? "زيادة" : "نقص"} ${formatWeight(Math.abs(diff))} عن المسجّل (${formatWeight(product.stock_grams)})`
              : `المسجّل حالياً: ${formatWeight(product.stock_grams)}`
          }
        >
          {(id) => (
            <Input id={id} dir="ltr" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />
          )}
        </Field>
        <Field label="السبب">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: هالك تنظيف"
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
