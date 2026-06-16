import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/AppLayout";
import { ShipmentBookingPanel } from "@/components/ShipmentBookingPanel";
import { Truck, Package, Clock, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";

type PendingTransfer = {
  id: string;
  transferNo: string;
  invoiceRef: string | null;
  fixablySeries: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  status: "draft" | "packed";
  packedAt: string | null;
  bookedAt: string | null;
  createdAt: string;
  destSiteName: string;
  destSiteCode: string;
  reqFullName: string | null;
  bookedByName: string | null;
  itemCount: number;
  totalUnits: number;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ageColor(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = diff / 3600000;
  if (hours < 2) return "var(--blue)";
  if (hours < 24) return "#ca8a04";
  return "var(--negative)";
}

export function ShipmentsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"booking" | "dispatch">("booking");
  const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingTransfer, setBookingTransfer] = useState<PendingTransfer | null>(null);
  const [dispatching, setDispatching] = useState<Set<string>>(new Set());
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const needsBooking = transfers.filter((t) => t.status === "draft");
  const readyToDispatch = transfers.filter((t) => t.status === "packed");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/shipments/pending");
      setTransfers((res as any)?.data ?? []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Poll every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleDispatch(id: string) {
    setDispatching((prev) => new Set(prev).add(id));
    setActionMsg(null);
    try {
      const res = await api.post(`/shipments/${id}/dispatch`, {});
      const ok = (res as any)?.ok === true;
      setActionMsg({ text: ok ? "Dispatched! Email sent." : "Dispatch completed.", ok });
      await load();
    } catch (err: any) {
      setActionMsg({ text: err?.message ?? "Dispatch failed", ok: false });
    }
    setDispatching((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const pendingCount = needsBooking.length + readyToDispatch.length;

  return (
    <AppLayout>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Truck size={22} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            Shipments
          </h1>
          {pendingCount > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: "var(--radius-pill)", background: "var(--blue)", color: "#fff" }}>
              {pendingCount} pending
            </span>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--line)" }}>
          <button type="button" onClick={() => setTab("booking")}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, color: tab === "booking" ? "var(--blue)" : "var(--muted)", background: "transparent", border: "none", borderBottom: tab === "booking" ? "2px solid var(--blue)" : "2px solid transparent", cursor: "pointer" }}>
            Needs Booking
            {needsBooking.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: "50%", padding: "1px 6px" }}>{needsBooking.length}</span>}
          </button>
          <button type="button" onClick={() => setTab("dispatch")}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, color: tab === "dispatch" ? "var(--blue)" : "var(--muted)", background: "transparent", border: "none", borderBottom: tab === "dispatch" ? "2px solid var(--blue)" : "2px solid transparent", cursor: "pointer" }}>
            Ready to Dispatch
            {readyToDispatch.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: "50%", padding: "1px 6px" }}>{readyToDispatch.length}</span>}
          </button>
        </div>

        {actionMsg && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-surface-elevated)", border: `1px solid ${actionMsg.ok ? "var(--blue)" : "var(--negative)"}`, borderRadius: "var(--radius)", color: actionMsg.ok ? "var(--text)" : "var(--negative)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            {actionMsg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {actionMsg.text}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            <div style={{ marginBottom: 8, fontSize: 12 }}>Loading pending shipments…</div>
          </div>
        )}

        {/* Needs Booking Tab */}
        {!loading && tab === "booking" && (
          <>
            {needsBooking.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
                <Package size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>No transfers needing booking</div>
                <div style={{ fontSize: 13 }}>All draft transfers have been assigned a courier.</div>
              </div>
            ) : (
              <div className="table-card">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transfer #</th>
                        <th>Invoice ref</th>
                        <th>Destination</th>
                        <th className="num">Parts</th>
                        <th className="num">Age</th>
                        <th style={{ width: 120 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {needsBooking.map((t) => (
                        <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/transfers/${t.id}`)}>
                          <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", fontSize: 13 }}>{t.transferNo}</td>
                          <td style={{ fontFamily: "monospace", color: "var(--muted)", fontSize: 12 }}>{t.invoiceRef ?? "—"}</td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.destSiteName}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{t.destSiteCode}</div>
                          </td>
                          <td className="num" style={{ fontSize: 13 }}>{t.itemCount} types · {t.totalUnits} units</td>
                          <td className="num" style={{ fontSize: 13, color: ageColor(t.createdAt), fontWeight: 600 }}>
                            <Clock size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                            {timeAgo(t.createdAt)}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => setBookingTransfer(t)}
                              style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                              Book Courier
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Ready to Dispatch Tab */}
        {!loading && tab === "dispatch" && (
          <>
            {readyToDispatch.length === 0 ? (
              <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
                <Truck size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>No transfers ready to dispatch</div>
                <div style={{ fontSize: 13 }}>Packed transfers waiting for courier handoff will appear here.</div>
              </div>
            ) : (
              <div className="table-card">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transfer #</th>
                        <th>Invoice ref</th>
                        <th>Destination</th>
                        <th>Courier</th>
                        <th>Tracking</th>
                        <th className="num">Packed</th>
                        <th style={{ width: 100 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {readyToDispatch.map((t) => (
                        <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/transfers/${t.id}`)}>
                          <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)", fontSize: 13 }}>{t.transferNo}</td>
                          <td style={{ fontFamily: "monospace", color: "var(--muted)", fontSize: 12 }}>{t.invoiceRef ?? "—"}</td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.destSiteName}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{t.destSiteCode}</div>
                          </td>
                          <td style={{ fontSize: 13 }}>{t.courierName ?? "—"}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>{t.trackingNumber ?? "—"}</td>
                          <td className="num" style={{ fontSize: 13, color: t.packedAt ? ageColor(t.packedAt) : "var(--muted)" }}>
                            {t.packedAt ? timeAgo(t.packedAt) : "—"}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => void handleDispatch(t.id)}
                              disabled={dispatching.has(t.id)}
                              style={{ background: dispatching.has(t.id) ? "var(--bg-surface-elevated)" : "var(--blue)", color: dispatching.has(t.id) ? "var(--muted)" : "#fff", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: dispatching.has(t.id) ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                              {dispatching.has(t.id) ? "Dispatching…" : "Dispatch"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Booking panel */}
      {bookingTransfer && (
        <ShipmentBookingPanel
          transfer={bookingTransfer}
          onClose={() => setBookingTransfer(null)}
          onBooked={() => { setBookingTransfer(null); void load(); }}
        />
      )}
    </AppLayout>
  );
}