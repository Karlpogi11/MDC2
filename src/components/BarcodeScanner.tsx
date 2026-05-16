import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { X, Camera } from "lucide-react";

type Props = {
  onScan: (value: string) => void;
  onClose: () => void;
};

export function BarcodeScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
        if (result) {
          onScan(result.getText());
          // Brief pause before next scan
          setScanning(false);
          setTimeout(() => setScanning(true), 1000);
        }
        if (err && !(err.message?.includes("No MultiFormat"))) {
          // Ignore "no barcode found" errors — they fire continuously
        }
      })
      .then(() => setScanning(true))
      .catch((e: Error) => {
        if (e.message?.includes("Permission")) {
          setError("Camera permission denied. Allow camera access and try again.");
        } else {
          setError(e.message ?? "Camera unavailable.");
        }
      });

    return () => {
      BrowserMultiFormatReader.releaseAllStreams();
    };
  }, [onScan]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ position: "relative", width: "min(400px, 90vw)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
            <Camera size={18} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {scanning ? "Scanning…" : "Starting camera…"}
            </span>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
            <X size={16} />
          </button>
        </div>

        {/* Viewfinder */}
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000" }}>
          <video ref={videoRef} style={{ width: "100%", display: "block" }} />
          {/* Scan line overlay */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            border: "2px solid rgba(255,255,255,0.3)", borderRadius: 12,
          }}>
            <div style={{
              position: "absolute", left: "10%", right: "10%", top: "50%",
              height: 2, background: "rgba(0,229,176,0.8)",
              boxShadow: "0 0 8px rgba(0,229,176,0.6)",
              animation: "scanline 2s ease-in-out infinite",
            }} />
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef2f2", borderRadius: 8, color: "#b91c1c", fontSize: 13 }}>
            {error}
          </div>
        )}

        <p style={{ marginTop: 12, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          Point camera at barcode or QR code
        </p>
      </div>

      <style>{`
        @keyframes scanline {
          0%, 100% { transform: translateY(-40px); opacity: 0.4; }
          50% { transform: translateY(40px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
