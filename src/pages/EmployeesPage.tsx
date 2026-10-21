import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Segmented,
  Toggle,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { Role, User } from "../lib/types";

const roleLabels: Record<Role, string> = { admin: "مدير", cashier: "كاشير" };

export function EmployeesPage() {
  const { user: me } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const [data, load] = useResource(useCallback(() => api.listUsers(), []));
  const users = data ?? [];

  const remove = async (u: User) => {
    setDeleting(null);
    try {
      const result = await api.deleteUser(u.id);
      toast(result === "deactivated" ? `أُوقف حساب «${u.name}» لأن له مبيعات مسجّلة` : `حُذف «${u.name}»`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const columns: Column<User>[] = [
    {
      header: "الاسم",
      cell: (u) => (
        <span className="font-medium">
          {u.name}
          {u.id === me.id && <span className="ms-2 text-xs font-normal text-mist">(أنت)</span>}
        </span>
      ),
    },
    { header: "اسم المستخدم", cell: (u) => <span dir="ltr">{u.username}</span> },
    {
      header: "الصلاحية",
      cell: (u) => <Badge tone={u.role === "admin" ? "ink" : "neutral"}>{roleLabels[u.role]}</Badge>,
    },
    {
      header: "الحالة",
      cell: (u) => (u.active ? <Badge tone="success">نشط</Badge> : <Badge tone="danger">موقوف</Badge>),
    },
    { header: "عدد الفواتير", numeric: true, cell: (u) => u.sales_count },
    {
      header: "تاريخ الإضافة",
      cell: (u) => <span className="text-mist">{formatDateTime(u.created_at).split(" ")[0]}</span>,
    },
    {
      header: "",
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <Button tone="ghost" size="icon" onClick={() => setEditing(u)} aria-label="تعديل">
            <Pencil className="size-4" />
          </Button>
          {u.id !== me.id && (
            <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(u)} aria-label="حذف">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader
        title="الموظفون"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            موظف جديد
          </Button>
        }
      />
      <Panel className="overflow-hidden">
        <DataTable columns={columns} rows={users} rowKey={(u) => u.id} />
      </Panel>

      {editing && (
        <EmployeeForm
          user={editing === "new" ? null : editing}
          isSelf={editing !== "new" && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف الموظف"
          message={`هل تريد حذف «${deleting.name}»؟ إن كانت له فواتير مسجّلة فسيُوقف حسابه فقط حتى تبقى التقارير صحيحة.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function EmployeeForm({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "cashier");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");

  const save = async () => {
    const input = { name, username, role, active, password: password || null };
    try {
      if (user) await api.updateUser(user.id, input);
      else await api.createUser(input);
      toast(user ? "حُفظت بيانات الموظف" : "أُضيف الموظف");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={user ? `تعديل «${user.name}»` : "موظف جديد"}
      onClose={onClose}
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>{user ? "حفظ" : "إضافة الموظف"}</Button>
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم المستخدم" hint="يُستخدم لتسجيل الدخول.">
            {(id) => (
              <Input id={id} dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} />
            )}
          </Field>
          <Field
            label={user ? "كلمة مرور جديدة" : "كلمة المرور"}
            hint={user ? "اتركها فارغة لتبقى كما هي." : undefined}
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </div>
        {!isSelf && (
          <>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-2">الصلاحية</span>
              <Segmented
                value={role}
                onChange={setRole}
                options={[
                  { value: "cashier", label: "كاشير · البيع فقط" },
                  { value: "admin", label: "مدير · كل الصلاحيات" },
                ]}
              />
            </div>
            <Toggle
              checked={active}
              onChange={setActive}
              label="الحساب نشط"
              description="الحساب الموقوف لا يستطيع تسجيل الدخول."
            />
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
