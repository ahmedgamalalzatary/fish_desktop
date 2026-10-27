import { ArchiveRestore, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../../components/DataTable";
import { CategorySelect } from "./CategorySelect";
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
} from "../../components/ui";
import { api } from "./api";
import { parseMoney } from "../../lib/format";
import { formatGramPrice, formatWeight, parseGramPrice, parseGrams } from "./format";
import { useSession } from "../../lib/session";
import { errorMessage, useToast } from "../../lib/toast";
import { useResource } from "../../lib/useResource";
import type { Category, Product, ProductInput } from "./types";

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
      header: "طريقة البيع",
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.sell_by_weight && <Badge>بالجرام</Badge>}
          {p.variants.length > 0 && <Badge>{p.variants.length} أوزان جاهزة</Badge>}
        </div>
      ),
    },
    {
      header: "سعر الجرام",
      numeric: true,
      cell: (p) => (p.sell_by_weight ? formatGramPrice(p.price_per_gram) : "—"),
    },
    {
      header: "تكلفة الجرام",
      numeric: true,
      cell: (p) => <span className="text-muted">{formatGramPrice(p.cost_per_gram)}</span>,
    },
    {
      header: "المخزون",
      numeric: true,
      cell: (p) => {
        const low = p.stock_grams <= p.low_stock_grams;
        return <span className={low ? "font-medium text-danger" : ""}>{formatWeight(p.stock_grams)}</span>;
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
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
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
            كل منتج يتبع تصنيفاً، مثل «أسماك» أو «جمبري». أنشئ التصنيفات من صفحة التصنيفات.
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

interface VariantDraft {
  id: number | null;
  label: string;
  grams: string;
  price: string;
  cost: string;
}

const money = (cents: number) => (cents ? String(cents / 100) : "");
const gramPrice = (milli: number) => (milli ? String(milli / 100_000) : "");
const count = (n: number) => (n ? String(n) : "");

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
  const [sellByWeight, setSellByWeight] = useState(product?.sell_by_weight ?? true);
  const [pricePerGram, setPricePerGram] = useState(gramPrice(product?.price_per_gram ?? 0));
  const [costPerGram, setCostPerGram] = useState(gramPrice(product?.cost_per_gram ?? 0));
  const [lowStock, setLowStock] = useState(count(product?.low_stock_grams ?? 0));
  const [openingStock, setOpeningStock] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({
      id: v.id,
      label: v.label,
      grams: count(v.weight_grams),
      price: money(v.price),
      cost: money(v.cost),
    })) ?? [],
  );
  const [busy, setBusy] = useState(false);

  const updateVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v, j) => (i === j ? { ...v, ...patch } : v)));

  const save = async () => {
    if (categoryId === null) return toast("اختر التصنيف", "error");
    const parsedVariants = variants.map((v) => ({
      id: v.id,
      label: v.label,
      weight_grams: parseGrams(v.grams) ?? 0,
      price: parseMoney(v.price) ?? 0,
      cost: parseMoney(v.cost || "0") ?? 0,
    }));
    const input: ProductInput = {
      name,
      category_id: categoryId,
      sell_by_weight: sellByWeight,
      price_per_gram: parseGramPrice(pricePerGram || "0") ?? -1,
      cost_per_gram: parseGramPrice(costPerGram || "0") ?? -1,
      low_stock_grams: parseGrams(lowStock || "0") ?? -1,
      variants: parsedVariants,
    };
    const opening = parseGrams(openingStock || "0");
    if (opening === null) return toast("المخزون الافتتاحي غير صحيح", "error");

    setBusy(true);
    try {
      if (product) {
        await api.updateProduct(product.id, input);
      } else {
        await api.createProduct(input, opening);
      }
      toast(product ? "حُفظت التعديلات" : "أُضيف المنتج");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={product ? `تعديل «${product.name}»` : "منتج جديد"}
      onClose={onClose}
      width="max-w-3xl"
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
                placeholder="مثال: بلطي"
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
            checked={sellByWeight}
            onChange={setSellByWeight}
            label="البيع بالجرام"
            description="يكتب الكاشير الوزن، ويُحسب السعر تلقائياً."
          />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Field label={`سعر بيع الجرام (${settings.currency})`} hint="مثال: 0.25">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="decimal"
                  value={pricePerGram}
                  onChange={(e) => setPricePerGram(e.target.value)}
                  disabled={!sellByWeight}
                />
              )}
            </Field>
            <Field label={`تكلفة الجرام (${settings.currency})`} hint="تُستخدم لحساب الربح.">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="decimal"
                  value={costPerGram}
                  onChange={(e) => setCostPerGram(e.target.value)}
                />
              )}
            </Field>
            <Field label="تنبيه نقص المخزون (جم)" hint="يظهر التنبيه عند الوصول لهذه الكمية.">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="numeric"
                  value={lowStock}
                  onChange={(e) => setLowStock(e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">أوزان جاهزة</div>
              <div className="text-xs text-muted">
                مثل: علبة 250 جم، علبة 500 جم، علبة 1000 جم. لكل وزن سعره الخاص، ويُخصم وزنه من المخزون.
              </div>
            </div>
            <Button
              tone="outline"
              size="sm"
              onClick={() =>
                setVariants((vs) => [...vs, { id: null, label: "", grams: "", price: "", cost: "" }])
              }
            >
              <Plus className="size-4" />
              إضافة وزن
            </Button>
          </div>
          {variants.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 text-xs text-muted">
                <span>الاسم</span>
                <span>الوزن (جم)</span>
                <span>سعر البيع</span>
                <span>التكلفة</span>
                <span className="w-9" />
              </div>
              {variants.map((v, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
                  <Input
                    value={v.label}
                    onChange={(e) => updateVariant(i, { label: e.target.value })}
                    placeholder="علبة 500 جم"
                    aria-label="اسم الوزن"
                  />
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    value={v.grams}
                    onChange={(e) => updateVariant(i, { grams: e.target.value })}
                    placeholder="500"
                    aria-label="الوزن بالجرام"
                  />
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    value={v.price}
                    onChange={(e) => updateVariant(i, { price: e.target.value })}
                    aria-label="سعر البيع"
                  />
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    value={v.cost}
                    onChange={(e) => updateVariant(i, { cost: e.target.value })}
                    aria-label="التكلفة"
                  />
                  <Button
                    tone="danger-ghost"
                    size="icon"
                    onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
                    aria-label="حذف الوزن"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        {!product && (
          <Field
            label="المخزون الافتتاحي (جم)"
            hint="الكمية الموجودة الآن. يمكنك إضافة الكميات الجديدة لاحقاً من صفحة المخزون."
            className="w-64"
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
              />
            )}
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
