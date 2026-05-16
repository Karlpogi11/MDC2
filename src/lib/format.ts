/** Normalizes any case string to Title Case: "BATTERY" → "Battery", "battery pack" → "Battery Pack" */
export function toCapitalized(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
