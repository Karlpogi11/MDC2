export function normalizeCsvHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      count += 1;
    }
  }

  return count;
}

export function detectCsvDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(headerLine, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

export function parseDelimitedRows(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = clean.split("\n").find((line) => line.trim().length > 0) ?? "";
  const delim = delimiter ?? detectCsvDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushRow = () => {
    const trimmed = [...row, cell].map((value) => value.trim());
    if (trimmed.some((value) => value.length > 0)) {
      rows.push(trimmed);
    }
    row = [];
    cell = "";
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];

    if (ch === '"') {
      if (quoted && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === delim && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === "\n" && !quoted) {
      pushRow();
      continue;
    }

    cell += ch;
  }

  pushRow();
  return rows;
}

export function parseCSV(text: string): Record<string, string>[] {
  const rows = parseDelimitedRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeCsvHeader);
  return rows.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}
