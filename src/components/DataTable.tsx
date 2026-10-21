import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Numbers read best aligned to the end of the cell. */
  numeric?: boolean;
  /** Shown in the footer row when any column defines one. */
  total?: ReactNode;
}

/** On-screen table used by admin pages and reports. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
}) {
  const hasTotals = columns.some((c) => c.total !== undefined);
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.header}
              className={cx(
                "sticky top-0 border-b border-line bg-white px-4 py-2.5 font-medium text-mist",
                c.numeric ? "text-end" : "text-start",
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            onClick={onRowClick && (() => onRowClick(row))}
            className={cx("hover:bg-frost", onRowClick && "cursor-pointer")}
          >
            {columns.map((c) => (
              <td key={c.header} className={cx("border-b border-line/70 px-4 py-3", c.numeric && "text-end")}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {hasTotals && (
        <tfoot>
          <tr className="font-semibold">
            {columns.map((c) => (
              <td key={c.header} className={cx("px-4 py-3", c.numeric && "text-end")}>
                {c.total}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
