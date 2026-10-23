import type { ReactNode } from "react";
import { formatDateTime, isoDate } from "../lib/format";
import type { Settings } from "../lib/types";
import type { DocumentSection } from "../lib/document";
import { cx } from "../lib/cx";

const formatDay = (iso: string) => iso.split("-").reverse().join("/");

/** A4 print/PDF layout for any report: letterhead, period, key figures, then tables. */
export function ReportDocument({
  settings,
  title,
  from,
  to,
  figures = [],
  sections,
}: {
  settings: Settings;
  title: string;
  from?: string;
  to?: string;
  figures?: { label: string; value: ReactNode }[];
  sections: DocumentSection[];
}) {
  const now = new Date();
  const generated = formatDateTime(`${isoDate(now)} ${now.toTimeString().slice(0, 8)}`);
  return (
    <div dir="rtl" className="bg-white font-sans text-[11px] leading-5 text-black">
      <header className="flex items-end justify-between border-b-2 border-black pb-2">
        <div>
          <div className="font-display text-2xl leading-8">{settings.shop_name}</div>
          {(settings.shop_address || settings.shop_phone) && (
            <div className="text-[10px]">
              {settings.shop_address} {settings.shop_phone && <span dir="ltr">{settings.shop_phone}</span>}
            </div>
          )}
        </div>
        <div className="text-end">
          <div className="text-base font-bold">{title}</div>
          {from && to && (
            <div>
              الفترة: {formatDay(from)}
              {from !== to && ` إلى ${formatDay(to)}`}
            </div>
          )}
          <div className="text-[10px] text-neutral-600">تاريخ الطباعة: {generated}</div>
        </div>
      </header>

      {figures.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded border border-neutral-400 bg-neutral-400">
          {figures.map((f) => (
            <div key={f.label} className="bg-white px-2 py-1.5">
              <div className="text-[10px] text-neutral-600">{f.label}</div>
              <div className="text-sm font-bold">{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {sections.map((s, i) => (
        <section key={i} className="mt-4 break-inside-auto">
          {s.title && <h2 className="mb-1 text-[13px] font-bold">{s.title}</h2>}
          {s.rows.length === 0 ? (
            <p className="text-neutral-600">لا توجد بيانات في هذه الفترة.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead className="table-header-group">
                <tr>
                  {s.columns.map((c) => (
                    <th
                      key={c.header}
                      className={cx(
                        "border-b border-black bg-neutral-100 px-1.5 py-1 font-semibold",
                        c.numeric ? "text-end" : "text-start",
                      )}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((row, r) => (
                  <tr key={r} className="break-inside-avoid">
                    {s.columns.map((c) => (
                      <td
                        key={c.header}
                        className={cx("border-b border-neutral-300 px-1.5 py-1", c.numeric && "text-end")}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {s.columns.some((c) => c.total !== undefined) && (
                <tfoot className="table-row-group">
                  <tr className="font-bold">
                    {s.columns.map((c) => (
                      <td
                        key={c.header}
                        className={cx("border-t border-black px-1.5 py-1", c.numeric && "text-end")}
                      >
                        {c.total}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
