import { Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { PeriodPicker } from "../components/PeriodPicker";
import { presetRange, type Preset } from "../lib/periods";
import { ReportDocument } from "../components/ReportDocument";
import {
  Button,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  PageHeader,
  Panel,
  Screen,
  Select,
} from "../components/ui";
import { api } from "../lib/api";
import { section } from "../lib/document";
import { expenseByUserColumns, expenseColumns, expensesByUser } from "../lib/expenses";
import { formatAmount, formatMoney, isoDate, parseMoney } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import type { Expense } from "../lib/types";

/** Reasons that come up every month; tapping one fills the reason field. */
const commonReasons = ["إيجار", "كهرباء", "إنترنت", "مياه", "مواصلات", "صيانة", "بوفيه"];

export function ExpensesPage() {
  const { user, settings } = useSession();
  const toast = useToast();
  const isAdmin = user.role === "admin";
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState(presetRange("today"));
  const [userId, setUserId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  // Cashiers always get their own expenses of today from the backend, whatever is sent.
  const [data, load] = useResource(
    useCallback(
      () => Promise.all([api.listExpenses(range, userId), isAdmin ? api.listUsers() : Promise.resolve([])]),
      [range, userId, isAdmin],
    ),
  );
  const [expenses, users] = useMemo(() => data ?? [[], []], [data]);
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const amount = parseMoney(amountText);
  const canSave = amount !== null && amount > 0 && reason.trim() !== "" && !busy;

  const save = async () => {
    if (!canSave || amount === null) return;
    setBusy(true);
    try {
      await api.createExpense(amount, reason.trim());
      toast(`سُجّل مصروف ${formatMoney(amount, settings.currency)}`);
      setAmountText("");
      setReason("");
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: Expense) => {
    setDeleting(null);
    try {
      await api.deleteExpense(e.id);
      toast("حُذف المصروف");
      load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const today = isoDate(new Date());
  const columns: Column<Expense>[] = [
    ...expenseColumns(expenses),
    {
      header: "",
      cell: (e) =>
        (isAdmin || e.created_at.startsWith(today)) && (
          <div className="flex justify-end">
            <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(e)} aria-label="حذف">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
    },
  ];

  const byUser = expensesByUser(expenses);
  const fileRange = range.from === range.to ? range.from : `${range.from}_${range.to}`;

  return (
    <div className="p-8">
      <PageHeader
        title="المصروفات"
        actions={
          isAdmin && (
            <ExportButtons
              disabled={expenses.length === 0}
              fileName={`مصروفات-${fileRange}`}
              document={() => (
                <ReportDocument
                  settings={settings}
                  title="تقرير المصروفات"
                  from={range.from}
                  to={range.to}
                  figures={[
                    { label: "إجمالي المصروفات", value: formatMoney(total, settings.currency) },
                    { label: "عدد المصروفات", value: expenses.length },
                  ]}
                  sections={[
                    section({ title: "حسب الموظف", columns: expenseByUserColumns(byUser), rows: byUser }),
                    section({ title: "المصروفات", columns: expenseColumns(expenses), rows: expenses }),
                  ]}
                />
              )}
            />
          )
        }
      />

      {/* New expense: one line, always on top, so recording one takes seconds. */}
      <Panel className="mb-6 p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-wrap items-end gap-4"
        >
          <Field label="المبلغ" className="w-44">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                dir="ltr"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
                className="h-11 text-lg"
              />
            )}
          </Field>
          <Field label="السبب" className="min-w-64 flex-1">
            {(id) => (
              <Input
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثلاً: فاتورة كهرباء شهر أكتوبر"
                maxLength={200}
                className="h-11"
              />
            )}
          </Field>
          <Button type="submit" size="md" className="h-11" disabled={!canSave}>
            تسجيل المصروف
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {commonReasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="h-7 rounded-full border border-line px-3 text-xs text-ink-2 transition-colors hover:border-ink-3/40 hover:bg-glass"
            >
              {r}
            </button>
          ))}
          <span className="ms-auto text-xs text-dim">يُسجَّل باسم {user.name}</span>
        </div>
      </Panel>

      {isAdmin ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker preset={preset} range={range} onChange={(p, r) => (setPreset(p), setRange(r))} />
          <Select
            className="w-48"
            value={userId ?? ""}
            onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
            aria-label="الموظف"
          >
            <option value="">كل الموظفين</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <h2 className="mb-4 font-semibold">مصروفاتك اليوم</h2>
      )}

      <div className="grid grid-cols-[1fr_280px] items-start gap-6">
        <Panel className="overflow-hidden">
          {expenses.length ? (
            <DataTable columns={columns} rows={expenses} rowKey={(e) => e.id} />
          ) : (
            <Empty title="لا توجد مصروفات في هذه الفترة">
              سجّل المبلغ والسبب في الأعلى، ويظهر المصروف هنا وفي التقارير.
            </Empty>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Screen
            size="md"
            label={`إجمالي المصروفات · ${expenses.length}`}
            value={formatAmount(total)}
            unit={settings.currency}
          />
          {isAdmin && byUser.length > 0 && (
            <Panel className="p-4">
              <h3 className="mb-2 text-sm font-semibold">حسب الموظف</h3>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {byUser.map((u) => (
                  <li key={u.user_id} className="flex justify-between py-2">
                    <span>{u.name}</span>
                    <span className="font-medium">{formatAmount(u.amount)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="حذف المصروف"
          message={`سيُحذف مصروف «${deleting.reason}» بمبلغ ${formatMoney(deleting.amount, settings.currency)}، ويختفي من التقارير.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
