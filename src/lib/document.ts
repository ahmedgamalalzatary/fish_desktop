import type { Column } from "../components/DataTable";

export interface DocumentSection<T = unknown> {
  title?: string;
  columns: Column<T>[];
  rows: T[];
}

/** Shorthand that keeps the row type checked while erasing it for the section list. */
export const section = <T>(s: DocumentSection<T>) => s as DocumentSection;
