import { useEffect, useState } from "react";

const WS_URL = `ws://${window.location.host}/ws`;

type StepStatus = "pending" | "running" | "pass" | "fail";
interface Step { id: string; label: string; status: StepStatus; detail?: string; }
interface Session {
  rfid: string | null;
  userName: string | null;
  credits: number;
  step: string;
  steps: Step[];
  heightMm: number | null;
  weightG: number | null;
  size: string | null;
  result: "accepted" | "rejected" | null;
  errorMsg: string | null;
}

const STEP_ICONS: Record<string, string> = {
  ir:         "📡",
  capacitive: "🔎",
  tof:        "📏",
  loadcell:   "⚖️",
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "#444",
  running: "#f0a500",
  pass:    "#2ecc71",
  fail:    "#e74c3c",
};

export default function DepositFlow() {
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") setSession(msg.session);
    };
    return () => ws.close();
  }, []);

  const step = session?.step ?? "idle";

  return (
    <div style={{
      minHeight: 600, width: 1024, background: "#1a1a1a",
      color: "#fff", fontFamily: "sans-serif",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "2rem", boxSizing: "border-box",
    }}>

      {/* header */}
      <div style={{ position: "absolute", top: 16, right: 20, fontSize: 12, color: connected ? "#2ecc71" : "#e74c3c" }}>
        ● {connected ? "Online" : "Offline"}
      </div>

      {/* IDLE — waiting for RFID */}
      {step === "idle" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>♻️</div>
          <h2 style={{ fontSize: 28, color: "#f0a500", marginBottom: 8 }}>Deposit Bottles</h2>
          <p style={{ color: "#aaa", fontSize: 16 }}>Tap your RFID card to open the gate</p>
        </div>
      )}

      {/* GATE OPEN — waiting for bottle */}
      {step === "gate_open" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🚪</div>
          <h2 style={{ fontSize: 24, color: "#f0a500" }}>Gate open</h2>
          <p style={{ color: "#ccc", fontSize: 16, marginBottom: 8 }}>
            Welcome, <strong>{session?.userName}</strong>
          </p>
          <p style={{ color: "#aaa", fontSize: 15 }}>Insert your bottle now</p>
          <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>Gate closes in 10 seconds if no bottle detected</p>
        </div>
      )}

      {/* VALIDATION IN PROGRESS */}
      {["ir", "capacitive", "tof", "loadcell"].includes(step) && (
        <div style={{ width: "100%", maxWidth: 600 }}>
          <h2 style={{ textAlign: "center", fontSize: 22, color: "#f0a500", marginBottom: 24 }}>
            Validating bottle...
          </h2>
          {session?.steps.map(s => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "14px 20px", marginBottom: 12,
              background: "#2a2a2a", borderRadius: 10,
              border: `1.5px solid ${STATUS_COLOR[s.status]}`,
              transition: "border-color 0.3s",
            }}>
              <span style={{ fontSize: 24 }}>{STEP_ICONS[s.id]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</div>
                {s.detail && <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{s.detail}</div>}
              </div>
              <div style={{ fontSize: 20 }}>
                {s.status === "pending" && <span style={{ color: "#555" }}>○</span>}
                {s.status === "running" && <span style={{ color: "#f0a500" }}>◌</span>}
                {s.status === "pass"    && <span style={{ color: "#2ecc71" }}>✓</span>}
                {s.status === "fail"    && <span style={{ color: "#e74c3c" }}>✗</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RESULT — accepted */}
      {step === "result" && session?.result === "accepted" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontSize: 26, color: "#2ecc71", marginBottom: 8 }}>Bottle accepted!</h2>
          <p style={{ color: "#ccc", fontSize: 16 }}>
            Size: <strong style={{ color: "#f0a500" }}>{session.size}</strong>
            {" · "}Height: {session.heightMm}mm
            {" · "}Weight: {session.weightG}g
          </p>
          <div style={{
            marginTop: 24, padding: "16px 32px",
            background: "#2a2a2a", borderRadius: 12,
            border: "1.5px solid #2ecc71", display: "inline-block",
          }}>
            <div style={{ fontSize: 13, color: "#aaa" }}>Total credits</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: "#f0a500" }}>{session.credits}</div>
          </div>
          <p style={{ color: "#555", fontSize: 13, marginTop: 16 }}>Returning to home screen...</p>
        </div>
      )}

      {/* RESULT — rejected */}
      {step === "result" && session?.result === "rejected" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontSize: 26, color: "#e74c3c", marginBottom: 8 }}>Bottle rejected</h2>
          <p style={{ color: "#aaa", fontSize: 15, maxWidth: 420, margin: "0 auto" }}>
            {session.errorMsg}
          </p>
          <p style={{ color: "#555", fontSize: 13, marginTop: 20 }}>Returning to home screen...</p>
        </div>
      )}

      {/* TIMEOUT */}
      {step === "idle" && session?.errorMsg && (
        <p style={{ color: "#e74c3c", fontSize: 14, marginTop: 16 }}>{session.errorMsg}</p>
      )}

    </div>
  );
}