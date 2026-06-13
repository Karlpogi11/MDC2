import { api } from "@/lib/api";
import type { InventoryRow } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In Stock", in_transit: "In Transit", transit: "In Transit",
  transferred: "Stocked Out", consumed: "Consumed", void: "Void",
};

type ExportSerial = {
  serialNumber: string;
  status: string;
  stockInAt: string | null;
  part: { partNumber: string } | null;
  site: { siteName: string } | null;
};

export function useExportInventory() {
  return async function exportCSV(sortedRows: InventoryRow[]) {
    let serials: ExportSerial[] = [];

    try {
      const partIds = sortedRows.map(r => r.partId);
      const params = new URLSearchParams();
      partIds.forEach(id => params.append("part_id", id));
      serials = await api.get<ExportSerial[]>(`/serials?${params.toString()}`);
    } catch {
      // Proceed with empty serials
    }

    const rows: string[][] = [
      ["Part Number", "Part Name", "Category", "In Stock", "Stocked Out", "Reserved", "Available",
       "Serial Number", "Serial Status", "Site", "Stock-In Date"],
    ];

    for (const row of sortedRows) {
      const partSerials = serials.filter(s => s.part?.partNumber === row.partNumber);
      if (partSerials.length === 0) {
        rows.push([row.partNumber, row.partName, row.category,
          String(row.inStock), String(row.stockedOut), String(row.reserved), String(row.available),
          "", "", "", ""]);
      } else {
        partSerials.forEach((s, i) => {
          rows.push([
            i === 0 ? row.partNumber : "",
            i === 0 ? row.partName : "",
            i === 0 ? row.category : "",
            i === 0 ? String(row.inStock) : "",
            i === 0 ? String(row.stockedOut) : "",
            i === 0 ? String(row.reserved) : "",
            i === 0 ? String(row.available) : "",
            s.serialNumber,
            STATUS_LABEL[s.status] ?? s.status,
            s.site?.siteName ?? "",
            s.stockInAt ? new Date(s.stockInAt).toLocaleDateString("en-US") : "",
          ]);
        });
      }
    }

    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
}
