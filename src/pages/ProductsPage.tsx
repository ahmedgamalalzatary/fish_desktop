import { ArchiveRestore, Pencil, Plus, Search, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { PhoneLines } from "../components/PhoneLines";
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
  Select,
  Toggle,
} from "../components/ui";
import { api } from "../lib/api";
import { formatAmount, formatPhones } from "../lib/format";
import {
  draftFromPhone,
  isBlank,
  newDraft,
  readDraft,
  repeatedSerials,
  type PhoneDraft,
} from "../lib/phones";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { PhoneInput, Product } from "../lib/types";

/** "18,500.00" or "18,500.00 – 24,000.00" for the phones of a model in stock. */
function priceRange(p: Product) {
  if (p.phones.length === 0) return "—";
  const prices = p.phones.map((x) => x.price);
  const [min, max] = [Math.min(...prices), Math.max(...prices)];
  return min === max ? formatAmount(min) : `${formatAmount(min)} – ${formatAmount(max)}`;
}

export function ProductsPage() {
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Product | null>(null);
  const [adding, setAdding] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(true), []));
  const products = useMemo(() => data ?? [], [data]);
  const active = products.filter((p) => p.active);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => p.active !== showArchived && (!q || p.name.toLowerCase().includes(q)));
  }, [products, showArchived, query]);

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
    { header: "الموديل", cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      header: "السعات المتوفرة",
      cell: (p) => {
        const storages = [...new Set(p.phones.map((x) => x.storage).filter(Boolean))];
        return storages.length ? (
          <div className="flex max-w-80 flex-wrap gap-1">
            {storages.map((s) => (
              <Badge key={s}>{s}</Badge>
            ))}
          </div>
        ) : (
          <span className="text-dim">—</span>
        );
      },
    },
    { header: "سعر البيع", numeric: true, cell: priceRange },
    {
      header: "في المخزون",
      numeric: true,
      cell: (p) =>
        p.phones.length ? (
          formatPhones(p.phones.length)
        ) : (
          <span className="font-medium text-alert">لا يوجد</span>
        ),
    },
    {
      header: "",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {p.active ? (
            <>
              <Button tone="outline" size="sm" onClick={() => setAdding(p)}>
                <Plus className="size-4" />
                إضافة أجهزة
              </Button>
              <Button tone="ghost" size="icon" onClick={() => setRenaming(p)} aria-label="تعديل الاسم">
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

  const saved = () => {
    setCreating(false);
    setRenaming(null);
    setAdding(null);
    load();
  };

  return (
    <div className="p-8">
      <PageHeader
        title="المنتجات"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            موديل جديد
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم الموديل"
            className="ps-9"
          />
        </div>
        <div className="ms-auto">
          <Toggle checked={showArchived} onChange={setShowArchived} label="عرض الأرشيف" />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {visible.length === 0 ? (
          <Empty
            title={showArchived ? "الأرشيف فارغ" : products.length ? "لا توجد نتائج" : "لا توجد موديلات بعد"}
          >
            {!showArchived &&
              products.length === 0 &&
              "أضف موديلاً باسمه الكامل، مثل «Samsung Galaxy S24 Ultra»، ثم أضف أجهزته برقم كل جهاز."}
          </Empty>
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(p) => p.id} />
        )}
      </Panel>

      {creating && <NewModelModal onClose={() => setCreating(false)} onSaved={saved} />}
      {renaming && <RenameModal product={renaming} onClose={() => setRenaming(null)} onSaved={saved} />}
      {adding && (
        <AddPhonesModal products={active} product={adding} onClose={() => setAdding(null)} onSaved={saved} />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف الموديل"
          message={`سيُحذف «${deleting.name}». إن كانت له مبيعات سابقة يُنقل إلى الأرشيف بدلاً من الحذف، فتبقى في التقارير.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** Checks the rows of a phone form; returns the inputs, or shows what is wrong and returns null. */
function useReadDrafts() {
  const toast = useToast();
  return (drafts: PhoneDraft[]): PhoneInput[] | null => {
    if (repeatedSerials(drafts).size > 0) {
      toast("رقم تسلسلي مكرر في القائمة", "error");
      return null;
    }
    const inputs: PhoneInput[] = [];
    for (const d of drafts.filter((d) => !isBlank(d))) {
      const read = readDraft(d);
      if ("error" in read) {
        toast(read.error, "error");
        return null;
      }
      inputs.push(read.input);
    }
    return inputs;
  };
}

function NewModelModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const readDrafts = useReadDrafts();
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<PhoneDraft[]>(() => [newDraft()]);
  // Set once the model is saved, so a retry after a failed phone only adds the phones.
  const [productId, setProductId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast("اسم الموديل مطلوب", "error");
    const phones = readDrafts(drafts);
    if (!phones) return;
    setBusy(true);
    try {
      let id = productId;
      if (id === null) {
        id = await api.createProduct(name);
        setProductId(id);
      }
      if (phones.length) await api.addPhones(id, phones);
      toast(
        phones.length ? `أُضيف «${name.trim()}» و${formatPhones(phones.length)}` : `أُضيف «${name.trim()}»`,
      );
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="موديل جديد"
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            حفظ
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
        <Field label="اسم الموديل" hint="الاسم الكامل كما يُباع، ويشمل الماركة.">
          {(id) => (
            <Input
              id={id}
              dir="auto"
              value={name}
              disabled={productId !== null}
              onChange={(e) => setName(e.target.value)}
              placeholder="Samsung Galaxy S24 Ultra"
              className="max-w-md text-lg"
            />
          )}
        </Field>
        <div>
          <h3 className="mb-2 text-sm font-medium text-ink-2">الأجهزة المتوفرة الآن (اختياري)</h3>
          <PhoneLines drafts={drafts} onChange={setDrafts} />
          <p className="mt-2 text-xs text-dim">
            الأجهزة المستلمة من مورد تُسجَّل من «فاتورة شراء» حتى تُضاف إلى حسابه.
          </p>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function RenameModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(product.name);
  const save = async () => {
    try {
      await api.updateProduct(product.id, name);
      toast("حُفظ الاسم");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <Modal
      title="تعديل اسم الموديل"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>حفظ</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="اسم الموديل" hint="الفواتير السابقة تحتفظ بالاسم الذي بيعت به.">
          {(id) => <Input id={id} dir="auto" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

/** Adds phones of one model without a supplier invoice. Without `product`, the model is picked here. */
export function AddPhonesModal({
  products,
  product,
  onClose,
  onSaved,
}: {
  products: Product[];
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const readDrafts = useReadDrafts();
  const [productId, setProductId] = useState(product ? String(product.id) : "");
  const [drafts, setDrafts] = useState<PhoneDraft[]>(() => {
    // Start from the model's latest phone, so its storage, color and prices are already filled in.
    const last = product?.phones[product.phones.length - 1];
    if (!last) return [newDraft()];
    return [{ ...draftFromPhone(last), serial: "", battery: "" }];
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!productId) return toast("اختر الموديل", "error");
    const phones = readDrafts(drafts);
    if (!phones) return;
    if (phones.length === 0) return toast("أضف جهازاً واحداً على الأقل", "error");
    setBusy(true);
    try {
      await api.addPhones(Number(productId), phones);
      toast(`أُضيف ${formatPhones(phones.length)} إلى المخزون`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={product ? `إضافة أجهزة · ${product.name}` : "إضافة أجهزة"}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <span className="me-auto text-sm text-dim">
            <Smartphone className="me-1 inline size-4" />
            {formatPhones(drafts.filter((d) => !isBlank(d)).length)}
          </span>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            إضافة إلى المخزون
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
        {!product && (
          <Field label="الموديل" className="max-w-md">
            {(id) => (
              <Select id={id} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="" disabled>
                  اختر الموديل
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <PhoneLines drafts={drafts} onChange={setDrafts} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
