import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A readable message from anything thrown (Errors, PostgREST error objects, strings). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === "string" ? m : String(err)
}

/** "Maya Chen" → "Maya"; blank → fallback. */
export function firstName(fullName: string | null | undefined, fallback = ""): string {
  return fullName?.trim().split(/\s+/)[0] || fallback
}

/** A comma-separated env value as a trimmed, lowercased list. */
export function envList(value: string | undefined, fallback = ""): string[] {
  return (value ?? fallback)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Case-insensitive exact email match. `ilike` alone isn't exact — `_` is a
 * LIKE wildcard and valid in emails — so confirm each hit with this.
 */
export function sameEmail(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase()
}
