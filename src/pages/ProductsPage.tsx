import { ArchiveRestore, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { CategorySelect } from "../components/CategorySelect";
import {
  Badge,
  Button,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Toggle,
} from "../components/ui";
import { api } from "../lib/api";
import { formatAmount, formatPieces, parseCount, parseMoney } from "../lib/format";
import { isLowStock, productStock } from "../lib/stock";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { Category, Product, ProductInput, Variant } from "../lib/types";

export function ProductsPage() {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const [data, load] = useResource(
    useCallback(() => Promise.all([api.listProducts(true), api.listCategories()]), []),
  );
  const [products, categories] = useMemo(() => data ?? [[], []], [data]);

  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          p.active !== showArchived &&
          (!query.trim() || p.name.includes(query.trim())) &&
          (categoryId === null || p.category_id === categoryId || p.parent_category_id === categoryId),
      ),
    [products, showArchived, query, categoryId],
  );

  const remove = async (p: Product) => {
    setDeleting(null);
    try {
      const result = await api.deleteProduct(p.id);
      toast(result === "archived" ? `نُقل «${p.name}» إلى الأرشيف لأن له مبيعات سابقة` : `حُذف «${p.name}»`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const restore = async (p: Product) => {
    try {
      await api.restoreProduct(p.id);
      toast(`أُعيد «${p.name}» إلى قائمة البيع`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const columns: Column<Product>[] = [
    {
      header: "المنتج",
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      header: "التصنيف",
      cell: (p) => (
        <span className="text-ink-2">
          {p.parent_category_name ? `${p.parent_category_name} / ` : ""}
          {p.category_name}
        </span>
      ),
    },
    {
      header: "الأنواع",
      cell: (p) =>
        p.variants.length === 1 && !p.variants[0].label ? (
          <span className="text-dim">—</span>
        ) : (
          <div className="flex max-w-80 flex-wrap gap-1">
            {p.variants.slice(0, 4).map((v) => (
              <Badge key={v.id}>{v.label}</Badge>
            ))}
            {p.variants.length > 4 && <Badge tone="ink">+{p.variants.length - 4}</Badge>}
          </div>
        ),
    },
    {
      header: "سعر البيع",
      numeric: true,
      cell: (p) => priceRange(p.variants, (v) => v.price),
    },
    {
      header: "سعر الشراء",
      numeric: true,
      cell: (p) => <span className="text-dim">{priceRange(p.variants, (v) => v.cost)}</span>,
    },
    {
      header: "المخزون",
      numeric: true,
      cell: (p) => {
        const low = p.variants.some((v) => v.stock <= 0 || isLowStock(v));
        return <span className={low ? "font-medium text-alert" : ""}>{formatPieces(productStock(p))}</span>;
      },
    },
    {
      header: "",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {p.active ? (
            <>
              <Button tone="ghost" size="icon" onClick={() => setEditing(p)} aria-label="تعديل">
                <Pencil className="size-4" />
              </Button>
              <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(p)} aria-label="حذف">
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <Button tone="outline" size="sm" onClick={() => restore(p)}>
              <ArchiveRestore className="size-4" />
              استعادة
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader
        title="المنتجات"
        actions={
          <Button onClick={() => setEditing("new")} disabled={categories.length === 0}>
            <Plus className="size-4" />
            منتج جديد
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث"
            className="ps-9"
          />
        </div>
        <CategorySelect
          className="w-56"
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          placeholder="كل التصنيفات"
        />
        <div className="ms-auto">
          <Toggle checked={showArchived} onChange={setShowArchived} label="عرض الأرشيف" />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {categories.length === 0 ? (
          <Empty title="أضف تصنيفاً أولاً">
            كل منتج يتبع تصنيفاً، مثل «موبايلات» أو «إكسسوارات». أنشئ التصنيفات من صفحة التصنيفات.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty title={showArchived ? "الأرشيف فارغ" : "لا توجد منتجات"}>
            {!showArchived && products.length === 0 && "أضف أول منتج ليظهر في شاشة البيع."}
          </Empty>
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(p) => p.id} />
        )}
      </Panel>

      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف المنتج"
          message={`سيُحذف «${deleting.name}» من قائمة البيع. إن كانت له مبيعات سابقة فسيُنقل إلى الأرشيف لتبقى التقارير كاملة.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** "1,200.00" for one price, "1,200.00 – 1,850.00" across options. */
function priceRange(variants: Variant[], pick: (v: Variant) => number) {
  if (!variants.length) return "—";
  const values = variants.map(pick);
  const [min, max] = [Math.min(...values), Math.max(...values)];
  return min === max ? formatAmount(min) : `${formatAmount(min)} – ${formatAmount(max)}`;
}

interface VariantDraft {
  id: number | null;
  label: string;
  price: string;
  cost: string;
  lowStock: string;
  openingStock: string;
}

const money = (cents: number) => (cents ? String(cents / 100) : "");
const emptyDraft: VariantDraft = { id: null, label: "", price: "", cost: "", lowStock: "", openingStock: "" };

function ProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(product?.category_id ?? null);
  const [drafts, setDrafts] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({
      id: v.id,
      label: v.label,
      price: money(v.price),
      cost: money(v.cost),
      lowStock: v.low_stock ? String(v.low_stock) : "",
      openingStock: "",
    })) ?? [emptyDraft],
  );
  const [hasOptions, setHasOptions] = useState(drafts.length > 1 || drafts[0].label !== "");
  const [busy, setBusy] = useState(false);

  const updateDraft = (i: number, patch: Partial<VariantDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (i === j ? { ...d, ...patch } : d)));

  const toggleOptions = (on: boolean) => {
    if (!on && drafts.length > 1) return toast("احذف الأنواع الزائدة أولاً واترك نوعاً واحداً", "error");
    setHasOptions(on);
  };

  const save = async () => {
    if (categoryId === null) return toast("اختر التصنيف", "error");
    const variants = drafts.map((d) => ({
      id: d.id,
      label: hasOptions ? d.label : "",
      price: parseMoney(d.price) ?? 0,
      cost: parseMoney(d.cost || "0") ?? -1,
      low_stock: parseCount(d.lowStock || "0") ?? -1,
      opening_stock: parseCount(d.openingStock || "0") ?? -1,
    }));
    if (variants.some((v) => v.cost < 0 || v.low_stock < 0 || v.opening_stock < 0)) {
      return toast("اكتب الأسعار والكميات أرقاماً صحيحة، والكميات بدون كسور", "error");
    }
    const input: ProductInput = { name, category_id: categoryId, variants };

    setBusy(true);
    try {
      if (product) {
        await api.updateProduct(product.id, input);
      } else {
        await api.createProduct(input);
      }
      toast(product ? "حُفظت التعديلات" : "أُضيف المنتج");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  const numberInput = (i: number, key: keyof Omit<VariantDraft, "id">, label: string, id?: string) => (
    <Input
      id={id}
      dir="ltr"
      inputMode="decimal"
      value={drafts[i][key]}
      onChange={(e) => updateDraft(i, { [key]: e.target.value })}
      aria-label={id ? undefined : label}
    />
  );

  return (
    <Modal
      title={product ? `تعديل «${product.name}»` : "منتج جديد"}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            {product ? "حفظ التعديلات" : "إضافة المنتج"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم المنتج">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: Samsung Galaxy A55"
              />
            )}
          </Field>
          <Field label="التصنيف">
            {(id) => (
              <CategorySelect
                id={id}
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="اختر التصنيف"
              />
            )}
          </Field>
        </div>

        <fieldset className="rounded-xl border border-line bg-white p-4">
          <Toggle
            checked={hasOptions}
            onChange={toggleOptions}
            label="له أنواع (سعة أو لون)"
            description="مثل 128GB أسود و256GB أزرق. لكل نوع سعره ومخزونه، ويختار الكاشير النوع عند البيع."
          />

          {!hasOptions ? (
            <div className="mt-4 grid grid-cols-4 gap-4">
              <Field label={`سعر البيع (${settings.currency})`}>
                {(id) => numberInput(0, "price", "سعر البيع", id)}
              </Field>
              <Field label={`سعر الشراء (${settings.currency})`} hint="يُستخدم لحساب الربح.">
                {(id) => numberInput(0, "cost", "سعر الشراء", id)}
              </Field>
              <Field label="تنبيه نقص المخزون" hint="عدد القطع الذي يظهر عنده التنبيه.">
                {(id) => numberInput(0, "lowStock", "تنبيه نقص المخزون", id)}
              </Field>
              {drafts[0].id === null && (
                <Field label="المخزون الافتتاحي" hint="عدد القطع الموجودة الآن.">
                  {(id) => numberInput(0, "openingStock", "المخزون الافتتاحي", id)}
                </Field>
              )}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs text-dim">
                <span>النوع</span>
                <span>سعر البيع</span>
                <span>سعر الشراء</span>
                <span>تنبيه عند</span>
                <span>المخزون</span>
                <span className="w-9" />
              </div>
              {drafts.map((d, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2">
                  <Input
                    value={d.label}
                    onChange={(e) => updateDraft(i, { label: e.target.value })}
                    placeholder="128GB أسود"
                    aria-label="اسم النوع"
                  />
                  {numberInput(i, "price", "سعر البيع")}
                  {numberInput(i, "cost", "سعر الشراء")}
                  {numberInput(i, "lowStock", "تنبيه نقص المخزون")}
                  {d.id === null ? (
                    numberInput(i, "openingStock", "المخزون الافتتاحي")
                  ) : (
                    <span className="flex items-center px-3 text-sm text-dim">
                      {formatPieces(product?.variants.find((v) => v.id === d.id)?.stock ?? 0)}
                    </span>
                  )}
                  <Button
                    tone="danger-ghost"
                    size="icon"
                    disabled={drafts.length === 1}
                    onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                    aria-label="حذف النوع"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                tone="outline"
                size="sm"
                className="self-start"
                onClick={() => setDrafts((ds) => [...ds, emptyDraft])}
              >
                <Plus className="size-4" />
                إضافة نوع
              </Button>
            </div>
          )}
        </fieldset>
        {product && (
          <p className="-mt-3 text-xs text-dim">
            الكميات تتغير بفاتورة شراء من صفحة المشتريات، أو بالجرد من صفحة المخزون.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
