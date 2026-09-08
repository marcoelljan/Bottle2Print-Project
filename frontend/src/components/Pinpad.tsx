import { useEffect, useState } from "react";

interface Props {
  title?: string;
  subtitle?: string;
  length?: number;
  error?: string;
  disabled?: boolean;
  disabledMessage?: string;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
}

export default function PINpad({
  title = "Enter your PIN",
  subtitle,
  length = 6,
  error,
  disabled = false,
  disabledMessage,
  onSubmit,
  onCancel,
}: Props) {
  const [digits, setDigits] = useState("");

  // Clear whatever was typed whenever a fresh error comes back, so the
  // person isn't stuck staring at dots for a PIN that already failed.
  useEffect(() => {
    if (error) setDigits("");
  }, [error]);

  const press = (d: string) => {
    if (disabled) return;
    if (digits.length >= length) return;
    const next = digits + d;
    setDigits(next);
    if (next.length === length) {
      onSubmit(next);
      setDigits("");
    }
  };

  const backspace = () => {
    if (disabled) return;
    setDigits(d => d.slice(0, -1));
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>{subtitle}</div>}

        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 18 }}>
          {Array.from({ length }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 16, height: 16, borderRadius: "50%",
                background: i < digits.length ? "#f0a500" : "transparent",
                border: `2px solid ${i < digits.length ? "#f0a500" : "#444"}`,
                transition: "background 0.15s",
              }}
            />
          ))}
        </div>

        {!disabled && error && (
          <div style={{ color: "#e74c3c", fontSize: 13, marginBottom: 14, minHeight: 16 }}>{error}</div>
        )}
        {disabled && disabledMessage && (
          <div style={{ color: "#e74c3c", fontSize: 13, marginBottom: 14, minHeight: 16 }}>{disabledMessage}</div>
        )}
        {!error && !(disabled && disabledMessage) && <div style={{ marginBottom: 14, minHeight: 16 }} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: 12, justifyContent: "center" }}>
          {keys.map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : (
              <button
                key={i}
                onClick={() => (k === "⌫" ? backspace() : press(k))}
                disabled={disabled}
                style={{
                  width: 64, height: 64, borderRadius: "50%",
                  background: "#242424", border: "1px solid #3a3a3a",
                  color: disabled ? "#555" : "#fff", fontSize: 22, fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {k}
              </button>
            )
          )}
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            style={{ marginTop: 20, background: "none", border: "none", color: "#888", fontSize: 13, cursor: "pointer" }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
};
const modal: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #333", borderRadius: 18,
  padding: "28px 32px", textAlign: "center",
};