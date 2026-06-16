import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { X } from "lucide-react";

const COURIER_OPTIONS = [
  "Lalamove",
  "Pickup by Utility",
  "Other",
];

type Props = {
  transfer: {
    id: string;
    transferNo: string;
    invoiceRef?: string | null;
    courierName?: string | null;
    trackingNumber?: string | null;
    fixablySeries?: string | null;
    items?: { qty: number; part: { partNumber: string; partName: string } | null; serial: { serialNumber: string } | null }[];
    destinationSite: { siteName: string } | null;
    createdAt: string;
  };
  onClose: () => void;
  onBooked: () => void;
};

export function ShipmentBookingPanel({ transfer, onClose, onBooked }: Props) {
  const [courier, setCourier] = useState(transfer.courierName ?? "");
  const [tracking, setTracking] = useState(transfer.trackingNumber ?? "");
  const [fixablySeries, setFixablySeries] = useState(transfer.fixablySeries ?? "");
  const [riderName, setRiderName] = useState("");
  const [customCourier, setCustomCourier] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPickup = courier === "Pickup by Utility";
  const isOther = courier === "Other";
  const trackingRequired = !isPickup;
  const effectiveCourier = isOther ? customCourier.trim() : courier.trim();
  const canSubmit = effectiveCourier && (!trackingRequired || tracking.trim()) && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      await api.post(`/shipments/${transfer.id}/book`, {
        courierName: effectiveCourier + (isPickup && riderName.trim() ? ` (${riderName.trim()})` : ""),
        trackingNumber: isPickup ? (riderName.trim() || "Utility pickup") : tracking.trim(),
        fixablySeries: fixablySeries.trim() || null,
      });
      onBooked();
    } catch (err: any) {
      setError(err?.message ?? "Failed to book courier");
    }
    setSaving(false);
  }

  const totalQty = transfer.items ? transfer.items.reduce((sum, i) => sum + i.qty, 0) : 0;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100 }} />
      <div role="dialog" aria-modal="true" aria-label="Book courier"
        style={{
          position: "fixed", top: 0, right: 0, width: 420, height: "100vh",
          background: "var(--bg-surface)", zIndex: 101,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "monospace" }}>{transfer.transferNo}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{transfer.destinationSite?.siteName ?? "—"}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={(e) => void handleSubmit(e)} style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {/* Parts summary */}
          <div style={{ marginBottom: 24, border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
            <div style={{ padding: "10px 14px 6px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Items ({transfer.items?.length ?? "?"})</div>
            <div style={{ padding: "0 14px" }}>
              {transfer.items && transfer.items.slice(0, 10).map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text)", marginBottom: 3 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{item.part?.partNumber ?? "—"}</span>
                  <span style={{ color: "var(--muted)" }}>x{item.qty}</span>
                </div>
              ))}
              {transfer.items && transfer.items.length > 10 && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>+{transfer.items.length - 10} more items</div>
              )}
              {!transfer.items && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading items…</div>
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, padding: "6px 14px 10px", fontSize: 12, fontWeight: 700, color: "var(--text)", display: "flex", justifyContent: "space-between" }}>
              <span>Total units</span>
              <span>{totalQty}</span>
            </div>
          </div>

          {/* Courier */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
              Courier <span style={{ color: "var(--negative)" }}>*</span>
            </label>
            <select
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              required
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
            >
              <option value="">Select courier…</option>
              {COURIER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Custom courier name (Other only) */}
          {isOther && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                Courier name <span style={{ color: "var(--negative)" }}>*</span>
              </label>
              <input
                value={customCourier}
                onChange={(e) => setCustomCourier(e.target.value)}
                placeholder="Enter courier name"
                required
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
              />
            </div>
          )}

          {/* Tracking number (not for Pickup by Utility) */}
          {!isPickup && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>
                Tracking / Waybill {isOther && <span style={{ color: "var(--negative)" }}>*</span>}
              </label>
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder={isOther ? "Enter waybill number" : "Tracking number"}
                required={trackingRequired}
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
              />
            </div>
          )}

          {/* Utility name (Pickup by Utility only) */}
          {isPickup && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>Utility name</label>
              <input
                value={riderName}
                onChange={(e) => setRiderName(e.target.value)}
                style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
              />
            </div>
          )}

          {/* Fixably series */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 5 }}>Fixably series <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
            <input
              value={fixablySeries}
              onChange={(e) => setFixablySeries(e.target.value)}
              placeholder="e.g. iPhone 15 Pro Max"
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--bg-surface)", outline: "none" }}
            />
          </div>

          {/* Next steps */}
          <div style={{ marginBottom: 20, padding: "10px 14px", border: "1px solid var(--line)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            An operator will pack the items and mark them <strong style={{ color: "var(--text)" }}>ready to dispatch</strong>. Come back here to confirm dispatch once packed.
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: "8px 12px", border: "1px solid var(--negative)", borderRadius: "var(--radius)", color: "var(--negative)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, border: "1px solid var(--line)", background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit}
              style={{ flex: 1, background: canSubmit ? "var(--blue)" : "var(--bg-surface)", color: canSubmit ? "#fff" : "var(--muted)", border: canSubmit ? "none" : "1px solid var(--line)", borderRadius: "var(--radius)", padding: "7px 0", fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed" }}>
              {saving ? "Booking…" : "Confirm Booking"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}