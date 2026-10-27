import { ArchiveRestore, ChevronLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { PhoneLines } from "../components/PhoneLines";
import { AddPhonesModal, ModelPhonesModal } from "../components/PhoneModals";
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
import { formatAmount, formatPhones } from "../lib/format";
import { newDraft, useReadDrafts, type PhoneDraft } from "../lib/phones";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { Product } from "../lib/types";

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
  // An id rather than the product, so the window shows fresh phones after each reload.
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(true), []));
  const products = useMemo(() => data ?? [], [data]);
  const active = products.filter((p) => p.active);
  const viewing = products.find((p) => p.id === viewingId);

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
          <span className="text-muted">—</span>
        );
      },
    },
    { header: "سعر البيع", numeric: true, cell: priceRange },
    {
      header: "في المخزون",
      numeric: true,
      cell: (p) =>
        p.phones.length ? (
          <span className="inline-flex items-center gap-1 font-medium underline decoration-line underline-offset-4">
            {formatPhones(p.phones.length)}
            <ChevronLeft className="size-4 text-muted" />
          </span>
        ) : (
          <span className="font-medium text-danger">لا يوجد</span>
        ),
    },
    {
      header: "",
      cell: (p) => (
        // The row opens the model's phones; its buttons do their own thing.
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
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
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(p) => p.id}
            onRowClick={(p) => setViewingId(p.id)}
          />
        )}
      </Panel>

      {creating && <NewModelModal onClose={() => setCreating(false)} onSaved={saved} />}
      {renaming && <RenameModal product={renaming} onClose={() => setRenaming(null)} onSaved={saved} />}
      {viewing && <ModelPhonesModal product={viewing} onClose={() => setViewingId(null)} onChanged={load} />}
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
          <p className="mt-2 text-xs text-muted">
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
