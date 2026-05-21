import { useRef, useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/lib/useNotifications";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="icon-btn"
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
        style={{ position: "relative" }}
      >
        <Bell aria-hidden="true" />
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            width: 8, height: 8,
            background: "#ef4444", border: "1.5px solid #fff",
          }} />
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          width: 340, background: "var(--bg-surface)", border: "1px solid var(--line)",
          borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          zIndex: 200, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Notifications {unreadCount > 0 && <span style={{ fontSize: 11, background: "#ef4444", color: "#fff", borderRadius: "var(--radius)", padding: "1px 6px", marginLeft: 4 }}>{unreadCount}</span>}
            </span>
            {unreadCount > 0 && (
              <button type="button" onClick={() => void markAllRead()}
                style={{ fontSize: 11, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {notifications.length === 0 && (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                No notifications yet
              </div>
            )}
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => { if (!n.read_at) void markRead(n.id); }}
                style={{
                  padding: "12px 16px", borderBottom: "1px solid #f9fafb", cursor: n.read_at ? "default" : "pointer",
                  background: n.read_at ? "#fff" : "#f0f7ff",
                  display: "flex", gap: 10, alignItems: "flex-start",
                }}
              >
                {!n.read_at && (
                  <span style={{ width: 7, height: 7, background: "var(--blue)", flexShrink: 0, marginTop: 5 }} />
                )}
                <div style={{ flex: 1, minWidth: 0, paddingLeft: n.read_at ? 17 : 0 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: n.read_at ? 400 : 600, color: "var(--text)" }}>{n.title}</p>
                  {n.body && <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--muted)" }}>{n.body}</p>}
                  <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>{timeAgo(n.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


