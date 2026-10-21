import type { Category } from "../lib/types";
import { Select } from "./ui";

/** Category picker that shows sub-categories indented under their parent. */
export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder,
  topLevelOnly,
  id,
  className,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  topLevelOnly?: boolean;
  id?: string;
  className?: string;
}) {
  const parents = categories.filter((c) => c.parent_id === null);
  return (
    <Select
      id={id}
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{placeholder}</option>
      {parents.map((p) => [
        <option key={p.id} value={p.id}>
          {p.name}
        </option>,
        ...(topLevelOnly
          ? []
          : categories
              .filter((c) => c.parent_id === p.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {"   — "}
                  {c.name}
                </option>
              ))),
      ])}
    </Select>
  );
}
