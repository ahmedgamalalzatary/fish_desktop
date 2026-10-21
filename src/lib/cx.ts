import { twMerge } from "tailwind-merge";

/** Joins class names, skipping falsy ones; later Tailwind classes override earlier conflicting ones. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  twMerge(parts.filter(Boolean).join(" "));
