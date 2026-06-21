import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

function DrawerRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", width: 100, flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontFamily: mono ? "monospace" : "inherit", flex: 1, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

export function SerialLookupDrawer({ serialNumber, onClose }: { serialNumber: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void load();
  }, [serialNumber]);

  async function load() {
    setLoading(true); setNotFound(false);

    try {
      const row = await api.get(`/serials/${encodeURIComponent(serialNumber)}`);
      if (!row) { setNotFound(true); setLoading(false); return; }

      const items = await api.get(`/serials/${(row as any).id}/transfer-history`);
      setData({ ...row, transfer_items: items ?? [] });
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  }

  const part = data ? (Array.isArray(data.parts) ? data.parts[0] : data.parts) : null;
  const site = data ? (Array.isArray(data.sites) ? data.sites[0] : data.sites) : null;
  const transfers = data ? (data.transfer_items ?? []).map((ti: any) => {
    const t = Array.isArray(ti.transfers) ? ti.transfers[0] : ti.transfers;
    const dest = t ? (Array.isArray(t.sites) ? t.sites[0] : t.sites) : null;
    return { ...t, dest_name: dest?.siteName ?? "—" };
  }) : [];

  return (
    <>
      <div onClick={handleClose} className={"drawer-backdrop" + (closing ? " closing" : "")} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200 }} />
      <aside className={"drawer-panel" + (closing ? " closing" : "")} style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 360,
        background: "var(--bg-surface)", borderLeft: "1px solid var(--line)",
        zIndex: 201, display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Serial Lookup</div>
          <button type="button" onClick={handleClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div className="blue-rule" style={{ margin: 0 }} />

        <div style={{ padding: "16px 20px", flex: 1 }}>
          {loading && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
          {notFound && <div style={{ fontSize: 13, color: "var(--muted)" }}>Serial not found in inventory.</div>}
          {data && (
            <div>
              <DrawerRow label="Serial" value={serialNumber} mono />
              <DrawerRow label="Status" value={data.status?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} />
              {part && <DrawerRow label="Part Name" value={part.partName} />}
              {part && <DrawerRow label="Part #" value={part.partNumber} mono />}
              <DrawerRow label="Location" value={site ? `${site.siteName}${site.siteCode ? ` (${site.siteCode})` : ""}` : "DC"} />
              <DrawerRow label="Stocked In" value={data.stock_in_at ? new Date(data.stock_in_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }) : "—"} />
            </div>
          )}
          {transfers.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Transfer History</div>
              {transfers.map((t: any, i: number) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t.transfer_no}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>→ {t.dest_name} · {t.status}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.created_at ? new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
