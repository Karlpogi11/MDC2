export type InventoryRow = {
  partId: string;
  partName: string;
  partNumber: string;
  category: string;
  partType: "product" | "material" | "unknown";
  inStock: number;
  committed: number;
  available: number;
  lastStockInAt: string | null;
  lastStockOutAt: string | null;
};

export type InventorySource = "supabase" | "demo";

export type InventoryQueryResult = {
  rows: InventoryRow[];
  source: InventorySource;
};
