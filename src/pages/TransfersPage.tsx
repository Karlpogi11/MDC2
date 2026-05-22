import { friendlyError } from "@/lib/friendlyError";
import { useTableResize } from "@/components/ResizableColumns";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
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

function getAge(transfer: Transfer): string | null {
  if (transfer.status === "received" || transfer.status === "cancelled") return null;
  const from = transfer.packed_at ?? transfer.created_at;
  const ms = Date.now() - new Date(from).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const STATUS_STYLE: Record<TransferStatus, { bg: string; color: string; label: string }> = {
  draft:      { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "Draft" },
  packed:     { bg: "var(--bg-surface-elevated)", color: "var(--blue)",     label: "Packed" },
  in_transit: { bg: "var(--bg-surface-elevated)", color: "var(--muted)",    label: "In Transit" },
  received:   { bg: "var(--bg-surface-elevated)", color: "var(--text)",     label: "Received" },
  cancelled:  { bg: "var(--bg-surface-elevated)", color: "var(--negative)", label: "Cancelled" },
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

  if (error) throw new Error(friendlyError(error));
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
  const tableRef = useTableResize();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TransferStatus | "all">("all");

  const { data: transfers = [], isLoading: loading, error } = useQuery({
    queryKey: ["transfers"],
    queryFn: fetchTransfers,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
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
      const { error } = await client.rpc("transition_transfer_status", {
        p_transfer_id: id,
        p_new_status: status,
      });
      if (error) throw new Error(friendlyError(error));
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

  const fetchError = error instanceof Error ? friendlyError(error) : null;
  const filtered = statusFilter === "all" ? transfers : transfers.filter((t) => t.status === statusFilter);

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            Transfers {!loading && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--muted)" }}>({filtered.length})</span>}
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => navigate("/transfers/templates")}
              style={{ background: "var(--bg-surface)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "5px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Templates
            </button>
            <button
              type="button"
              onClick={() => navigate("/transfers/new")}
              style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              New transfer
            </button>
          </div>
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
                borderRadius: 0, padding: "5px 10px", fontSize: 13, fontWeight: statusFilter === s ? 600 : 400,
                cursor: "pointer", background: "transparent",
                color: statusFilter === s ? "var(--blue)" : "var(--text)",
                marginBottom: -1,
              }}
            >
              {s === "all" ? "All" : STATUS_STYLE[s].label}
            </button>
            ))}
        </div>

        <section className="table-card">
          <div className="table-scroll">
          <table ref={tableRef}>
            <thead>
              <tr>
                <th>Transfer #</th>
                <th>Destination</th>
                <th className="num">Items</th>
                <th>Status</th>
                <th>Age</th>
                <th>Requested by</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="empty-row">Loading…</td></tr>
              )}
              {fetchError && (
                <tr><td colSpan={8} className="empty-row" style={{ color: "var(--negative)" }}>
                  Failed to load transfers: {fetchError}
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    <FileText size={28} color="#d1d5db" style={{ marginBottom: 8 }} />
                    <p style={{ margin: "0 0 10px", color: "var(--muted)" }}>No transfers found.</p>
                    <button type="button" onClick={() => navigate("/transfers/new")}
                      style={{ background: "var(--blue)", color: "#fff", border: "none", padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Create first transfer
                    </button>
                  </td>
                </tr>
              )}
              {!loading && filtered.map((t) => {
                const s = STATUS_STYLE[t.status];
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 700, color: "var(--blue)", fontFamily: "monospace" }}>
                      {t.transfer_no}
                    </td>
                    <td>
                      {t.destination_site
                        ? <><span style={{ fontWeight: 600 }}>{t.destination_site.site_name}</span> <span style={{ color: "var(--muted)", fontSize: 11 }}>{t.destination_site.site_code}</span></>
                        : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="num">{t.item_count}</td>
                    <td>
                      <span className="status-badge" style={{ background: s.bg, color: s.color }}>
                        {s.label}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const age = getAge(t);
                        if (age === null) return <span style={{ color: "var(--muted)" }}>—</span>;
                        const overdue = age.endsWith("d") && parseInt(age) > 3;
                        return (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: overdue ? 700 : 400, color: overdue ? "var(--negative)" : "var(--muted)" }}>
                            {overdue && <span title="Overdue — in transit more than 3 days">⚠️</span>}
                            {age}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ color: "var(--muted)" }}>
                      {t.requested_by_profile?.full_name ?? t.requested_by_profile?.username ?? "—"}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{formatDate(t.created_at)}</td>
                    <td>
                      <button type="button" onClick={() => navigate(`/transfers/${t.id}`)}
                        style={{ border: "1px solid var(--line)", background: "var(--bg-surface)", padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}



