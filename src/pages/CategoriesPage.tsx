import { CornerDownLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { CategorySelect } from "../components/CategorySelect";
import { Button, ConfirmDialog, Empty, Field, Input, Modal, PageHeader, Panel } from "../components/ui";
import { api } from "../lib/api";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { Category } from "../lib/types";

type Editing = { category: Category | null; parentId: number | null };

export function CategoriesPage() {
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const [data, load] = useResource(useCallback(() => api.listCategories(), []));
  const categories = data ?? [];

  const parents = categories.filter((c) => c.parent_id === null);

  const remove = async (c: Category) => {
    setDeleting(null);
    try {
      await api.deleteCategory(c.id);
      toast(`حُذف «${c.name}»`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const row = (c: Category, sub: boolean) => (
    <li key={c.id} className={`group flex items-center gap-3 px-5 py-3 hover:bg-frost ${sub ? "ps-12" : ""}`}>
      {sub && <CornerDownLeft className="size-4 -scale-x-100 text-mist/60" />}
      <span className={sub ? "text-ink-2" : "font-semibold"}>{c.name}</span>
      <span className="text-xs text-mist">{c.product_count} منتج</span>
      <div className="ms-auto flex gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!sub && (
          <Button tone="ghost" size="sm" onClick={() => setEditing({ category: null, parentId: c.id })}>
            <Plus className="size-4" />
            تصنيف فرعي
          </Button>
        )}
        <Button
          tone="ghost"
          size="icon"
          onClick={() => setEditing({ category: c, parentId: c.parent_id })}
          aria-label="تعديل"
        >
          <Pencil className="size-4" />
        </Button>
        <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(c)} aria-label="حذف">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );

  return (
    <div className="max-w-4xl p-8">
      <PageHeader
        title="التصنيفات"
        actions={
          <Button onClick={() => setEditing({ category: null, parentId: null })}>
            <Plus className="size-4" />
            تصنيف رئيسي
          </Button>
        }
      />
      <Panel className="overflow-hidden">
        {parents.length === 0 ? (
          <Empty title="لا توجد تصنيفات بعد">
            ابدأ بتصنيفات رئيسية مثل «أسماك» و«جمبري» و«مأكولات بحرية»، ثم أضف تحتها تصنيفات فرعية مثل «أسماك
            نيلية».
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {parents.map((p) => (
              <li key={p.id}>
                <ul className="divide-y divide-line/60">
                  {row(p, false)}
                  {categories.filter((c) => c.parent_id === p.id).map((c) => row(c, true))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <CategoryForm
          editing={editing}
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
          title="حذف التصنيف"
          message={`هل تريد حذف «${deleting.name}»؟ لا يمكن حذف تصنيف به منتجات أو تصنيفات فرعية.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
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
  editing: Editing;
  categories: Category[];
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
      if (editing.category) await api.updateCategory(editing.category.id, name, parentId);
      else await api.createCategory(name, parentId);
      toast(editing.category ? "حُفظ التصنيف" : "أُضيف التصنيف");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const title = editing.category
    ? "تعديل التصنيف"
    : parentId === null
      ? "تصنيف رئيسي جديد"
      : "تصنيف فرعي جديد";
  return (
    <Modal
      title={title}
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
              <CategorySelect
                id={id}
                topLevelOnly
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
