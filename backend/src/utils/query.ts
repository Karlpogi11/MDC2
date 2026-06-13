export function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

export function queryBoolean(value: unknown, defaultValue = false): boolean {
  const text = queryString(value);
  if (text === undefined) return defaultValue;
  return text !== "false";
}

export function queryActiveFilter(value: unknown, defaultValue = true): boolean | null {
  const text = queryString(value)?.trim().toLowerCase();
  if (!text) return defaultValue;
  if (text === "all" || text === "*") return null;
  if (["true", "1", "yes", "on", "active"].includes(text)) return true;
  if (["false", "0", "no", "off", "inactive"].includes(text)) return false;
  return defaultValue;
}

export function queryNumber(value: unknown, defaultValue: number): number {
  const text = queryString(value);
  if (text === undefined || text.trim() === "") return defaultValue;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
