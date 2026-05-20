import type { InventoryRow } from "@/types";

type SerialRow = {
  serial_number: string;
  status: string;
  stock_in_at: string | null;
  parts: { part_number: string } | null;
  sites: { site_name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In Stock", in_transit: "In Transit", transit: "In Transit",
  transferred: "Stocked Out", consumed: "Consumed", void: "Void",
};

export function useExportInventory() {
  return function exportCSV(sortedRows: InventoryRow[], serials: SerialRow[]) {
    const rows: string[][] = [
      ["Part Number", "Part Name", "Category", "In Stock", "Reserved", "Available",
       "Serial Number", "Serial Status", "Site", "Stock-In Date"],
    ];

    for (const row of sortedRows) {
      const partSerials = serials.filter(s => s.parts?.part_number === row.partNumber);
      if (partSerials.length === 0) {
        rows.push([row.partNumber, row.partName, row.category,
          String(row.inStock), String(row.committed), String(row.available),
          "", "", "", ""]);
      } else {
        partSerials.forEach((s, i) => {
          rows.push([
            i === 0 ? row.partNumber : "",
            i === 0 ? row.partName : "",
            i === 0 ? row.category : "",
            i === 0 ? String(row.inStock) : "",
            i === 0 ? String(row.committed) : "",
            i === 0 ? String(row.available) : "",
            s.serial_number,
            STATUS_LABEL[s.status] ?? s.status,
            s.sites?.site_name ?? "",
            s.stock_in_at ? new Date(s.stock_in_at).toLocaleDateString("en-US") : "",
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
