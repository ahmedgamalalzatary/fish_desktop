import { shop } from "@shop";
import { ArchiveRestore, ClipboardList, CornerDownLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExtraCategorySelect } from "../components/Extras";
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
import { cx } from "../lib/cx";
import { extrasApi, type Extra, type ExtraCategory, type ExtraInput } from "../lib/extras";
import { formatAmount, parseCount, parseMoney } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";

// The shop's extras (add-ons, accessories): their classification on the side, the items in a table.

type EditingCategory = { category: ExtraCategory | null; parentId: number | null };

export function ExtrasPage() {
  const toast = useToast();
  const names = shop.extras;
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingCategory, setEditingCategory] = useState<EditingCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<ExtraCategory | null>(null);
  const [editing, setEditing] = useState<Extra | "new" | null>(null);
  const [deleting, setDeleting] = useState<Extra | null>(null);
  const [counting, setCounting] = useState<Extra | null>(null);

  const [data, load] = useResource(
    useCallback(() => Promise.all([extrasApi.list(true), extrasApi.listCategories()]), []),
  );
  const [extras, categories] = useMemo(() => data ?? [[], []], [data]);
  const mains = categories.filter((c) => c.parent_id === null);

  const visible = useMemo(
    () =>
      extras.filter(
        (x) =>
          x.active !== showArchived &&
          (!query.trim() || x.name.toLowerCase().includes(query.trim().toLowerCase())) &&
          (categoryId === null || x.category_id === categoryId || x.parent_category_id === categoryId),
      ),
    [extras, showArchived, query, categoryId],
  );

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast(done);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const removeCategory = (c: ExtraCategory) => {
    setDeletingCategory(null);
    if (categoryId === c.id) setCategoryId(null);
    run(() => extrasApi.deleteCategory(c.id), `حُذف «${c.name}»`);
  };

  const remove = async (x: Extra) => {
    setDeleting(null);
    try {
      const result = await extrasApi.remove(x.id);
      toast(result === "archived" ? `نُقل «${x.name}» إلى الأرشيف لأن له حركة سابقة` : `حُذف «${x.name}»`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const categoryRow = (c: ExtraCategory, sub: boolean) => (
    <li
      key={c.id}
      className={cx(
        "group flex items-center gap-2 py-2 pe-2",
        sub ? "ps-8" : "ps-4",
        categoryId === c.id ? "bg-ink/[0.06]" : "hover:bg-surface",
      )}
    >
      {sub && <CornerDownLeft className="size-3.5 shrink-0 -scale-x-100 text-muted/60" />}
      <button
        type="button"
        onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
        aria-pressed={categoryId === c.id}
        className={cx("min-w-0 flex-1 truncate text-start", sub ? "text-ink-2" : "font-semibold")}
      >
        {c.name}
        <span className="ms-2 text-xs font-normal text-muted">{c.extra_count}</span>
      </button>
      <div className="flex opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!sub && (
          <Button
            tone="ghost"
            size="icon"
            className="size-8"
            onClick={() => setEditingCategory({ category: null, parentId: c.id })}
            aria-label={`تصنيف فرعي تحت ${c.name}`}
            title="تصنيف فرعي"
          >
            <Plus className="size-4" />
          </Button>
        )}
        <Button
          tone="ghost"
          size="icon"
          className="size-8"
          onClick={() => setEditingCategory({ category: c, parentId: c.parent_id })}
          aria-label="تعديل"
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          tone="danger-ghost"
          size="icon"
          className="size-8"
          onClick={() => setDeletingCategory(c)}
          aria-label="حذف"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );

  const columns: Column<Extra>[] = [
    { header: names.one, cell: (x) => <span className="font-medium">{x.name}</span> },
    {
      header: "التصنيف",
      cell: (x) => (
        <span className="text-ink-2">
          {x.parent_category_name ? `${x.parent_category_name} / ` : ""}
          {x.category_name}
        </span>
      ),
    },
    { header: "سعر البيع", numeric: true, cell: (x) => formatAmount(x.price) },
    {
      header: "التكلفة",
      numeric: true,
      cell: (x) => <span className="text-muted">{formatAmount(x.cost)}</span>,
    },
    {
      header: "المخزون",
      numeric: true,
      cell: (x) =>
        x.track_stock ? (
          <span className={x.stock_qty <= x.low_stock_qty ? "font-medium text-danger" : ""}>
            {x.stock_qty} قطعة
          </span>
        ) : (
          <Badge>بدون عدّ</Badge>
        ),
    },
    {
      header: "",
      cell: (x) => (
        <div className="flex justify-end gap-1">
          {x.active ? (
            <>
              {x.track_stock && (
                <Button tone="ghost" size="icon" onClick={() => setCounting(x)} aria-label="جرد" title="جرد">
                  <ClipboardList className="size-4" />
                </Button>
              )}
              <Button tone="ghost" size="icon" onClick={() => setEditing(x)} aria-label="تعديل">
                <Pencil className="size-4" />
              </Button>
              <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(x)} aria-label="حذف">
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              tone="outline"
              size="sm"
              onClick={() => run(() => extrasApi.restore(x.id), `أُعيد «${x.name}» إلى قائمة البيع`)}
            >
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
        title={names.title}
        actions={
          <Button onClick={() => setEditing("new")} disabled={categories.length === 0}>
            <Plus className="size-4" />
            {names.newOne}
          </Button>
        }
      />

      <div className="grid grid-cols-[18rem_1fr] items-start gap-6">
        <Panel className="overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">التصنيفات</h2>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setEditingCategory({ category: null, parentId: null })}
            >
              <Plus className="size-4" />
              تصنيف رئيسي
            </Button>
          </header>
          {mains.length === 0 ? (
            <p className="px-4 py-6 text-sm leading-6 text-muted">
              ابدأ بتصنيفات رئيسية مثل {names.categoriesExample}.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {mains.map((m) => [
                categoryRow(m, false),
                ...categories.filter((c) => c.parent_id === m.id).map((c) => categoryRow(c, true)),
              ])}
            </ul>
          )}
        </Panel>

        <div className="min-w-0">
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
            <div className="ms-auto">
              <Toggle checked={showArchived} onChange={setShowArchived} label="عرض الأرشيف" />
            </div>
          </div>
          <Panel className="overflow-hidden">
            {categories.length === 0 ? (
              <Empty title="أضف تصنيفاً أولاً">
                كل {names.one} يتبع تصنيفاً. أنشئ التصنيفات من القائمة الجانبية.
              </Empty>
            ) : visible.length === 0 ? (
              <Empty title={showArchived ? "الأرشيف فارغ" : `لا توجد ${names.title}`}>
                {!showArchived && extras.length === 0 && "أضف أول صنف ليظهر في شاشة البيع."}
              </Empty>
            ) : (
              <DataTable columns={columns} rows={visible} rowKey={(x) => x.id} />
            )}
          </Panel>
        </div>
      </div>

      {editingCategory && (
        <CategoryForm
          editing={editingCategory}
          categories={categories}
          onClose={() => setEditingCategory(null)}
          onSaved={() => (setEditingCategory(null), load())}
        />
      )}
      {deletingCategory && (
        <ConfirmDialog
          title="حذف التصنيف"
          message={`هل تريد حذف «${deletingCategory.name}»؟ لا يمكن حذف تصنيف به أصناف أو تصنيفات فرعية.`}
          confirmLabel="حذف"
          onConfirm={() => removeCategory(deletingCategory)}
          onCancel={() => setDeletingCategory(null)}
        />
      )}
      {editing && (
        <ExtraForm
          extra={editing === "new" ? null : editing}
          categories={categories}
          defaultCategory={categoryId}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), load())}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف الصنف"
          message={`سيُحذف «${deleting.name}» من قائمة البيع. إن كانت له مبيعات أو مشتريات سابقة فسيُنقل إلى الأرشيف لتبقى التقارير كاملة.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
      {counting && (
        <CountModal
          extra={counting}
          onClose={() => setCounting(null)}
          onSaved={() => (setCounting(null), load())}
        />
      )}
    </div>
  );
}

function CategoryForm({
  editing,
  categories,
  onClose,
  onSaved,
}: {
  editing: EditingCategory;
  categories: ExtraCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(editing.category?.name ?? "");
  const [parentId, setParentId] = useState(editing.parentId);
  const hasChildren =
    editing.category !== null && categories.some((c) => c.parent_id === editing.category!.id);

  const save = async () => {
    try {
      if (editing.category) await extrasApi.updateCategory(editing.category.id, name, parentId);
      else await extrasApi.createCategory(name, parentId);
      toast(editing.category ? "حُفظ التصنيف" : "أُضيف التصنيف");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={editing.category ? "تعديل التصنيف" : parentId === null ? "تصنيف رئيسي جديد" : "تصنيف فرعي جديد"}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>{editing.category ? "حفظ" : "إضافة"}</Button>
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
        <Field label="الاسم">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {!hasChildren && (
          <Field label="يتبع" hint="اتركه فارغاً ليكون تصنيفاً رئيسياً.">
            {(id) => (
              <ExtraCategorySelect
                id={id}
                mainOnly
                categories={categories.filter((c) => c.id !== editing.category?.id)}
                value={parentId}
                onChange={setParentId}
                placeholder="— تصنيف رئيسي —"
              />
            )}
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

const money = (cents: number) => (cents ? String(cents / 100) : "");

function ExtraForm({
  extra,
  categories,
  defaultCategory,
  onClose,
  onSaved,
}: {
  extra: Extra | null;
  categories: ExtraCategory[];
  defaultCategory: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [name, setName] = useState(extra?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(extra?.category_id ?? defaultCategory);
  const [price, setPrice] = useState(money(extra?.price ?? 0));
  const [cost, setCost] = useState(money(extra?.cost ?? 0));
  const [trackStock, setTrackStock] = useState(extra?.track_stock ?? true);
  const [lowStock, setLowStock] = useState(extra?.low_stock_qty ? String(extra.low_stock_qty) : "");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (categoryId === null) return toast("اختر التصنيف", "error");
    const input: ExtraInput = {
      name,
      category_id: categoryId,
      price: parseMoney(price) ?? 0,
      cost: parseMoney(cost || "0") ?? -1,
      track_stock: trackStock,
      low_stock_qty: trackStock ? (parseCount(lowStock || "0") ?? -1) : 0,
    };
    const openingQty = trackStock ? parseCount(opening || "0") : 0;
    if (openingQty === null) return toast("المخزون الافتتاحي غير صحيح", "error");
    setBusy(true);
    try {
      if (extra) await extrasApi.update(extra.id, input);
      else await extrasApi.create(input, openingQty);
      toast(extra ? "حُفظت التعديلات" : `أُضيف «${name.trim()}»`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={extra ? `تعديل «${extra.name}»` : shop.extras.newOne}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            {extra ? "حفظ التعديلات" : "إضافة"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="الاسم">
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`مثال: ${shop.extras.nameExample}`}
              />
            )}
          </Field>
          <Field label="التصنيف">
            {(id) => (
              <ExtraCategorySelect
                id={id}
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="اختر التصنيف"
              />
            )}
          </Field>
          <Field label={`سعر البيع (${settings.currency})`}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={`التكلفة (${settings.currency})`}
            hint="تُستخدم لحساب الربح، وتتحدّث مع كل فاتورة شراء."
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className="rounded-xl border border-line bg-white p-4">
          <Toggle
            checked={trackStock}
            onChange={setTrackStock}
            label="عدّ المخزون بالقطعة"
            description="يُخصم مع كل بيع ويُضاف مع كل فاتورة شراء. أوقفه لما يُحضَّر في المحل ولا يُعدّ."
          />
          {trackStock && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Field label="تنبيه نقص المخزون (قطعة)" hint="يظهر التنبيه عند الوصول لهذا العدد.">
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
              {!extra && (
                <Field label="المخزون الافتتاحي (قطعة)" hint="العدد الموجود الآن.">
                  {(id) => (
                    <Input
                      id={id}
                      dir="ltr"
                      inputMode="numeric"
                      value={opening}
                      onChange={(e) => setOpening(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
          )}
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Sets a counted item's stock to what is actually on the shelf. */
function CountModal({ extra, onClose, onSaved }: { extra: Extra; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(String(Math.max(extra.stock_qty, 0)));
  const [note, setNote] = useState("");
  const qty = parseCount(text);
  const diff = qty === null ? null : qty - extra.stock_qty;

  const save = async () => {
    if (qty === null) return toast("أدخل العدد بشكل صحيح", "error");
    try {
      await extrasApi.adjustStock(extra.id, qty, note);
      toast(`حُدّث مخزون «${extra.name}»`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={`جرد · ${extra.name}`}
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
        <Field
          label="العدد الفعلي (قطعة)"
          hint={
            diff !== null && diff !== 0
              ? `${diff > 0 ? "زيادة" : "نقص"} ${Math.abs(diff)} عن المسجّل (${extra.stock_qty})`
              : `المسجّل حالياً: ${extra.stock_qty}`
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
            <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تالف" />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
