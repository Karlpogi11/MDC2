export function bodyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string");
      if (typeof first === "string") return first;
    }
  }
  return undefined;
}

export function bodyBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = bodyString(value)?.trim().toLowerCase();
    if (!text) continue;
    if (["false", "0", "no", "off"].includes(text)) return false;
    if (["true", "1", "yes", "on"].includes(text)) return true;
  }
  return undefined;
}

export function bodyNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = bodyString(value)?.trim();
    if (!text) continue;
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function bodyStringArray(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const items = value
        .map((item) => bodyString(item)?.trim())
        .filter((item): item is string => Boolean(item));
      return items;
    }

    const text = bodyString(value)?.trim();
    if (!text) continue;

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => bodyString(item)?.trim())
          .filter((item): item is string => Boolean(item));
      }
    } catch {
      // Fall back to comma-separated text.
    }

    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}
