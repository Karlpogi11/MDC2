import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FileText } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { AppLayout } from "@/components/AppLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type TransferStatus = "draft" | "packed" | "in_transit" | "received" | "cancelled";

type Transfer = {
  id: string;
  transfer_no: string;
  status: TransferStatus;
  destination_site: { site_name: string; site_code: string } | null;
  requested_by_profile: { full_name: string | null; username: string | null } | null;
  created_at: string;
  packed_at: string | null;
  item_count: number;
};

const STATUS_STYLE: Record<TransferStatus, { bg: string; color: string; label: string }> = {
  draft:      { bg: "#f3f4f6", color: "#6b7a8d", label: "Draft" },
  packed:     { bg: "#dbeafe", color: "#1d4ed8", label: "Packed" },
  in_transit: { bg: "#fef9c3", color: "#a16207", label: "In Transit" },
  received:   { bg: "#dcfce7", color: "#15803d", label: "Received" },
  cancelled:  { bg: "#fee2e2", color: "#b91c1c", label: "Cancelled" },
};

async function fetchTransfers(): Promise<Transfer[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("transfers")
    .select(`
      id, transfer_no, status, created_at, packed_at,
      destination_site:sites!destination_site_id(site_name, site_code),
      requested_by_profile:profiles!requested_by(full_name, username),
      transfer_items(id)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  if (!data) return [];

  return data.map((t: any) => ({
    id: t.id,
    transfer_no: t.transfer_no,
    status: t.status,
    destination_site: Array.isArray(t.destination_site) ? t.destination_site[0] ?? null : t.destination_site,
    requested_by_profile: Array.isArray(t.requested_by_profile) ? t.requested_by_profile[0] ?? null : t.requested_by_profile,
    created_at: t.created_at,
    packed_at: t.packed_at,
    item_count: Array.isArray(t.transfer_items) ? t.transfer_items.length : 0,
  }));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function TransfersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TransferStatus | "all">("all");

  const { data: transfers = [], isLoading: loading, error } = useQuery({
    queryKey: ["transfers"],
    queryFn: fetchTransfers,
  });

  // Realtime: invalidate on any transfer insert/update
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    const channel = client
      .channel("transfers-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [queryClient]);

  // Optimistic status update mutation
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TransferStatus }) => {
      const client = getSupabaseClient();
      if (!client) throw new Error("Not configured");
      const { error } = await client.from("transfers").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["transfers"] });
      const previous = queryClient.getQueryData<Transfer[]>(["transfers"]);
      queryClient.setQueryData<Transfer[]>(["transfers"], (old = []) =>
        old.map((t) => t.id === id ? { ...t, status } : t)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["transfers"], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["transfers"] }),
  });

  const fetchError = error instanceof Error ? error.message : null;
  const filtered = statusFilter === "all" ? transfers : transfers.filter((t) => t.status === statusFilter);

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1a2a3a" }}>
            Transfers {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7a8d" }}>({filtered.length})</span>}
          </h1>
          <button
            type="button"
            onClick={() => navigate("/transfers/new")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            <Plus size={15} /> New transfer
          </button>
        </div>

        {/* Status filter tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
          {(["all", "draft", "packed", "in_transit", "received", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                border: "none", borderBottom: `2px solid ${statusFilter === s ? "var(--blue)" : "transparent"}`,
                borderRadius: 0, padding: "8px 14px", fontSize: 13, fontWeight: statusFilter === s ? 600 : 400,
                cursor: "pointer", background: "transparent",
                color: statusFilter === s ? "var(--blue)" : "#6b7a8d",
                marginBottom: -1,
              }}
            >
              {s === "all" ? "All" : STATUS_STYLE[s].label}
            </button>
            ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: "65vh", overflowY: "auto" }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                {["Transfer #", "Destination", "Items", "Status", "Requested by", "Date", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7a8d", background: "#f9fafb", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ padding: "32px 16px", textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
              )}
              {fetchError && (
                <tr><td colSpan={7} style={{ padding: "20px 16px", textAlign: "center", color: "#b91c1c", fontSize: 13 }}>
                  Failed to load transfers: {fetchError}
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center" }}>
                    <FileText size={32} color="#d1d5db" style={{ marginBottom: 12 }} />
                    <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>No transfers found.</p>
                    <button type="button" onClick={() => navigate("/transfers/new")}
                      style={{ marginTop: 12, background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Create first transfer
                    </button>
                  </td>
                </tr>
              )}
              {!loading && filtered.map((t) => {
                const s = STATUS_STYLE[t.status];
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid #f9fafb" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: "var(--blue)", fontFamily: "monospace" }}>
                      {t.transfer_no}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#374151" }}>
                      {t.destination_site
                        ? <><span style={{ fontWeight: 600 }}>{t.destination_site.site_name}</span> <span style={{ color: "#9ca3af", fontSize: 11 }}>{t.destination_site.site_code}</span></>
                        : <span style={{ color: "#9ca3af" }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#374151" }}>{t.item_count}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "var(--radius-pill)", fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#6b7a8d" }}>
                      {t.requested_by_profile?.full_name ?? t.requested_by_profile?.username ?? "—"}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#6b7a8d", whiteSpace: "nowrap" }}>{formatDate(t.created_at)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <button type="button" onClick={() => navigate(`/transfers/${t.id}`)}
                        style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
