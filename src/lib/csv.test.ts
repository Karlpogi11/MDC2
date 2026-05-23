import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, normalizeCsvHeader, parseCSV, parseDelimitedRows } from "./csv";

describe("csv helpers", () => {
  it("normalizes headers for analytics column mapping", () => {
    expect(normalizeCsvHeader(" Product Code ")).toBe("product_code");
    expect(normalizeCsvHeader("Ship-To #")).toBe("shipto_");
  });

  it("parses comma CSV into normalized object rows", () => {
    expect(parseCSV("Part Number,Qty\n661-21000,2\n661-21001,1")).toEqual([
      { part_number: "661-21000", qty: "2" },
      { part_number: "661-21001", qty: "1" },
    ]);
  });

  it("keeps commas inside quoted cells", () => {
    expect(parseCSV('part_number,description\n661-21000,"Display, black"')).toEqual([
      { part_number: "661-21000", description: "Display, black" },
    ]);
  });

  it("unescapes doubled quotes inside quoted cells", () => {
    expect(parseCSV('part_number,description\n661-21000,"Battery ""A"""')).toEqual([
      { part_number: "661-21000", description: 'Battery "A"' },
    ]);
  });

  it("detects tab-delimited exports", () => {
    expect(detectCsvDelimiter("part_number\tqty\tsite_code")).toBe("\t");
    expect(parseCSV("part_number\tqty\n661-21000\t3")).toEqual([
      { part_number: "661-21000", qty: "3" },
    ]);
  });

  it("detects semicolon-delimited exports", () => {
    expect(detectCsvDelimiter("part_number;qty;site_code")).toBe(";");
    expect(parseCSV("part_number;qty\n661-21000;3")).toEqual([
      { part_number: "661-21000", qty: "3" },
    ]);
  });

  it("preserves quoted newlines in a cell", () => {
    expect(parseCSV('part_number,description\n661-21000,"line 1\nline 2"')).toEqual([
      { part_number: "661-21000", description: "line 1\nline 2" },
    ]);
  });

  it("returns raw rows for mapping previews", () => {
    expect(parseDelimitedRows('Part Number,Description\n661-21000,"Display, black"')).toEqual([
      ["Part Number", "Description"],
      ["661-21000", "Display, black"],
    ]);
  });
});
