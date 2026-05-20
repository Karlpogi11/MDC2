import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Props = {
  partId: string;
  partName: string;
  partNumber: string;
  reservedCount: number;
  onClose: () => void;
};

type ReservedItemRow = {
  transferItemId: string;
  qty: number;
  serialId: string | null;
  serialNumber: string | null;
  serialStatus: string | null;
  stockInAt: string | null;
  transferNo: string;
  transferStatus: "draft" | "packed";
  transferAt: string;
  destinationSiteName: string | null;
};

const TRANSFER_STATUS_STYLE: Record<ReservedItemRow["transferStatus"], { bg: string; color: string; label: string }> = {
  draft: { bg: "#f3f4f6", color: "#6b7a8d", label: "Draft" },
  packed: { bg: "#dbeafe", color: "#1d4ed8", label: "Packed" },
};

const RESERVED_DRAWER_CACHE = new Map<string, ReservedItemRow[]>();
const RESERVED_QUERY_MARGIN = 20;
const RESERVED_QUERY_MIN = 25;
const RESERVED_QUERY_MAX = 500;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReservedSerialDrawer({ partId, partName, partNumber, reservedCount, onClose }: Props) {
  const [rows, setRows] = useState<ReservedItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }

    const cached = RESERVED_DRAWER_CACHE.get(partId);
    if (cached) {
      setRows(cached);
      setLoading(false);
    }

    const rowLimit = Math.min(
      Math.max(reservedCount + RESERVED_QUERY_MARGIN, RESERVED_QUERY_MIN),
      RESERVED_QUERY_MAX,
    );

    let mounted = true;
    void client
      .from("transfer_items")
      .select(`
        id, qty, serial_id,
        serial_numbers(id, serial_number, status, stock_in_at),
        transfers!inner(id, transfer_no, status, created_at, packed_at, destination_site:sites!destination_site_id(site_name))
      `)
      .eq("part_id", partId)
      .in("transfers.status", ["draft", "packed"])
      .limit(rowLimit)
      .then(({ data, error }) => {
        if (!mounted) return;

        if (error) {
          if (!cached) setRows([]);
          setLoading(false);
          return;
        }

        const mapped = (data ?? [])
          .map((row: any): ReservedItemRow | null => {
            const serial = Array.isArray(row.serial_numbers) ? row.serial_numbers[0] : row.serial_numbers;
            const transfer = Array.isArray(row.transfers) ? row.transfers[0] : row.transfers;
            const destinationSite = Array.isArray(transfer?.destination_site) ? transfer.destination_site[0] : transfer?.destination_site;

            if (!transfer?.transfer_no) return null;
            if (transfer.status !== "draft" && transfer.status !== "packed") return null;

            return {
              transferItemId: row.id,
              qty: row.qty ?? 1,
              serialId: serial?.id ?? null,
              serialNumber: serial?.serial_number ?? null,
              serialStatus: serial?.status ?? null,
              stockInAt: serial?.stock_in_at ?? null,
              transferNo: transfer.transfer_no,
              transferStatus: transfer.status,
              transferAt: transfer.packed_at ?? transfer.created_at,
              destinationSiteName: destinationSite?.site_name ?? null,
            };
          })
          .filter((row): row is ReservedItemRow => row !== null)
          .sort((a, b) => b.transferAt.localeCompare(a.transferAt));

        RESERVED_DRAWER_CACHE.set(partId, mapped);
        setRows(mapped);
        setLoading(false);
      });

    setTimeout(() => searchRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => {
      mounted = false;
      window.removeEventListener("keydown", handler);
    };
  }, [partId, onClose, reservedCount]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      (row.serialNumber ?? "").toLowerCase().includes(q) ||
      row.transferNo.toLowerCase().includes(q) ||
      (row.destinationSiteName ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const serializedReservedQty = rows.reduce((sum, row) => sum + (row.serialId ? row.qty : 0), 0);
  const nonSerializedReservedQty = rows.reduce((sum, row) => sum + (row.serialId ? 0 : row.qty), 0);
  const filteredQty = filteredRows.reduce((sum, row) => sum + row.qty, 0);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 620, background: "#fff", zIndex: 101, display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: "#f7f7f7", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Reserved Items</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{partName}</span>
                <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--blue)", background: "#eff6ff", padding: "1px 6px", borderRadius: "var(--radius-sm)", display: "inline-block" }}>{partNumber}</span>
                <span style={{ fontSize: 11, color: "#6b7a8d" }}>{reservedCount} reserved total</span>
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6b7a8d", padding: 4 }}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div style={{ padding: "10px 20px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} color="#9ca3af" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial, transfer no., destination..."
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px 7px 30px", fontSize: 12, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Loading reserved items...</div>}
          {!loading && filteredRows.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              {search ? `No reserved items matching "${search}"` : "No reserved items found for draft/packed transfers."}
            </div>
          )}
          {!loading && filteredRows.map((row, i) => {
            const meta = TRANSFER_STATUS_STYLE[row.transferStatus];
            return (
              <div key={row.transferItemId} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 12, padding: "10px 20px", borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: row.serialNumber ? "monospace" : undefined, fontWeight: 600, fontSize: 12, color: row.serialNumber ? "var(--blue)" : "#374151", marginBottom: 2 }}>
                    {row.serialNumber ?? "No serial assigned"}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>
                    {row.serialNumber ? `Stocked in ${formatDate(row.stockInAt)}` : `Qty ${row.qty}`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{row.transferNo}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{formatDate(row.transferAt)}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: meta.bg, color: meta.color, whiteSpace: "nowrap" }}>
                    {meta.label}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#374151" }}>
                  {row.destinationSiteName ?? "—"}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", background: "#f7f7f7", flexShrink: 0, fontSize: 12, color: "#6b7a8d", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{!loading && `Showing ${filteredRows.length} rows (${filteredQty} qty)`}</span>
          {!loading && <span>Serialized: {serializedReservedQty} | Non-serialized: {nonSerializedReservedQty} | Total: {reservedCount}</span>}
        </div>
      </div>
    </>
  );
}
