import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Truck, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/useBranding";

const ERROR_MESSAGES: Record<string, string> = {
  TRANSFER_NOT_FOUND: "Transfer not found. The link may be invalid.",
  INVALID_TOKEN: "Invalid or expired receipt link.",
  TOKEN_EXPIRED: "This receipt link has expired. Contact DC to resend.",
  INVALID_STATUS: "This transfer is not ready to receive.",
};

export function ReceivePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { state: authState } = useAuth();
  const isLoggedIn = authState.status === "authenticated";

  const [transferNo, setTransferNo] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [sourceSite, setSourceSite] = useState("");
  const [destSite, setDestSite] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    if (token) {
      // Public token-based access
      api.get(`/receive/transfer/${id}?token=${token}`)
        .then((data: any) => {
          if (data.status === "received") {
            setDone(true); setTransferNo(data.transfer_no); setInvoiceRef(data.invoice_ref ?? "");
            setLoading(false); return;
          }
          if (data.status !== "in_transit") {
            setError(`Transfer is "${data.status}" — not ready to receive.`);
            setLoading(false); return;
          }
          setTransferNo(data.transfer_no);
          setInvoiceRef(data.invoice_ref ?? "");
          setSourceSite(data.source_site_name ?? "DC");
          setDestSite(data.destination_site_name ?? "—");
          setLoading(false);
        })
        .catch((err: any) => {
          const raw = err?.message ?? "TRANSFER_NOT_FOUND";
          const code = Object.keys(ERROR_MESSAGES).find((k) => raw.includes(k)) ?? "TRANSFER_NOT_FOUND";
          if ((code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") && isLoggedIn) {
            loadAuthenticated(id);
            return;
          }
          setError(ERROR_MESSAGES[code] ?? raw);
          setLoading(false);
        });
    } else if (isLoggedIn) {
      loadAuthenticated(id);
    } else {
      setError("Access denied. Use the link from your email.");
      setLoading(false);
    }
  }, [id, token, isLoggedIn]);

  function loadAuthenticated(transferId: string) {
    api.get(`/transfers/${transferId}`)
      .then((d: any) => {
        if (d.status === "received") { setDone(true); setTransferNo(d.transfer_no); setInvoiceRef(d.invoice_ref ?? ""); setLoading(false); return; }
        if (d.status !== "in_transit") { setError(`Transfer is "${d.status}" — not ready to receive.`); setLoading(false); return; }
        setTransferNo(d.transfer_no);
        setInvoiceRef(d.invoice_ref ?? "");
        setSourceSite(d.source_site_name ?? "DC");
        setDestSite(d.destination_site_name ?? "—");
        setLoading(false);
      })
      .catch(() => {
        setError("Transfer not found.");
        setLoading(false);
      });
  }

  async function handleConfirm() {
    setSubmitting(true); setError(null);

    try {
      if (token) {
        // Token-based confirm for unauthenticated path
        await api.post(`/receive/transfer/${id}/confirm`, { token });
      } else {
        // Authenticated path
        await api.put(`/transfers/${id}/status`, { status: "received" });
      }
      setDone(true); setSubmitting(false);
    } catch (err: any) {
      const raw = err?.message ?? "An error occurred";
      if (token) {
        const code = Object.keys(ERROR_MESSAGES).find((k) => raw.includes(k));
        setError(code ? ERROR_MESSAGES[code] : raw);
      } else {
        setError(raw);
      }
      setSubmitting(false);
    }
  }

  const confirmDisabled = submitting;

  // ── Token / unauthenticated path: standalone page ─────────────────────────
  if (!isLoggedIn || token) {
    if (loading) return <StandalonePage><p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p></StandalonePage>;
    if (error) return (
      <StandalonePage>
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", padding: "14px 18px", color: "#b91c1c", fontSize: 14 }}>{error}</div>
      </StandalonePage>
    );
    if (done) return (
      <StandalonePage>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 16 }} />
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Receipt Confirmed</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{invoiceRef || transferNo} has been marked as received.</p>
        </div>
      </StandalonePage>
    );
    return (
      <StandalonePage>
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Transfer</p>
          <p style={{ margin: "0 0 12px", fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{invoiceRef || transferNo}</p>
          <p style={{ margin: "0 0 2px", fontSize: 11, color: "var(--muted)" }}>From <strong style={{ color: "var(--text)" }}>{sourceSite}</strong> · To <strong style={{ color: "var(--text)" }}>{destSite}</strong></p>
        </div>

        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderLeft: "4px solid #f59e0b", padding: "12px 14px", marginBottom: 24, fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
          ⚠ Verify all items against the <strong>packing list</strong> before confirming. This action cannot be undone.
        </div>

        {error && <div role="alert" style={{ marginBottom: 16, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <button type="button" onClick={() => void handleConfirm()} disabled={confirmDisabled}
          style={{ width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, background: confirmDisabled ? "#d1d5db" : "#15803d", color: confirmDisabled ? "#6b7280" : "#fff", border: "none", cursor: confirmDisabled ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Confirming..." : "Confirm Received"}
        </button>
      </StandalonePage>
    );
  }

  // ── Authenticated DC staff path ───────────────────────────────────────────
  if (loading) return <AppLayout><div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div></AppLayout>;
  if (error) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 24px" }}>
        <div role="alert" style={{ padding: "14px 18px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 13 }}>{error}</div>
      </main>
    </AppLayout>
  );
  if (done) return (
    <AppLayout>
      <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
        <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 16 }} />
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Receipt Confirmed</h1>
        <p style={{ margin: "0 0 28px", color: "var(--muted)", fontSize: 14 }}>{invoiceRef || transferNo} has been marked as received.</p>
      </main>
    </AppLayout>
  );

  return (
    <AppLayout>
      <main style={{ maxWidth: 520, margin: "40px auto", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Truck size={18} color="var(--blue)" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: "monospace" }}>{invoiceRef || transferNo}</h1>
          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", background: "var(--bg-surface-elevated)", color: "var(--muted)" }}>In Transit</span>
        </div>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--muted)" }}>From <strong style={{ color: "var(--text)" }}>{sourceSite}</strong> · To <strong style={{ color: "var(--text)" }}>{destSite}</strong></p>

        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderLeft: "4px solid #f59e0b", padding: "14px 16px", marginBottom: 24, fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
          ⚠ Verify all items against the <strong>packing list</strong> before confirming receipt. This action cannot be undone.
        </div>

        {error && <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 13 }}>{error}</div>}

        <button type="button" onClick={() => void handleConfirm()} disabled={confirmDisabled}
          style={{ width: "100%", padding: "13px", fontSize: 14, fontWeight: 700, background: confirmDisabled ? "#d1d5db" : "#15803d", color: confirmDisabled ? "#9ca3af" : "#fff", border: "none", cursor: confirmDisabled ? "not-allowed" : "pointer" }}>
          {submitting ? "Confirming..." : "Confirm Received"}
        </button>
      </main>
    </AppLayout>
  );
}

function StandalonePage({ children }: { children: React.ReactNode }) {
  const { brandName } = useBranding();
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-surface-elevated)", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px", fontFamily: "Inter, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 32, height: 32, background: "var(--nav-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Truck size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{brandName ?? "MDC Inventory"}</span>
        </div>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--line)", padding: 24 }}>
          {children}
        </div>
      </div>
    </div>
  );
}



