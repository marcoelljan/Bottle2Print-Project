import { useEffect, useState, useRef } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API, WS_URL } from "../config";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

type StepStatus = "pending" | "running" | "pass" | "fail";
interface SensorStep { id: string; label: string; status: StepStatus; detail?: string; }

interface Session {
  rfid: string | null;
  userName: string | null;
  credits: number;
  step: string;
  steps: SensorStep[];
  heightMm: number | null;
  weightG: number | null;
  size: string | null;
  result: "accepted" | "rejected" | null;
  errorMsg: string | null;
}


const STEP_ICONS: Record<string, string> = {
  ir: "📡", capacitive: "🔎", tof: "📏", loadcell: "⚖️",
};
const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "#3a3a3a", running: "#f0a500", pass: "#2ecc71", fail: "#e74c3c",
};

export default function DepositScreen({ onBack }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const feedbackShownRef = useRef(false);

  const step = session?.step ?? "idle";

 useEffect(() => {
  fetch(`${API}/api/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "deposit" }),
  });
  return () => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "idle" }),
    });
  };
}, []);
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") setSession(msg.session);
      } catch {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (step === "result" && session?.result === "accepted" && !feedbackShownRef.current) {
      feedbackShownRef.current = true;
      setShowFeedback(true);
    }
  }, [step, session?.result]);

  const handleIdentified = (u: User) => setUser(u);

  const inValidation = ["ir", "capacitive", "tof", "loadcell"].includes(step);

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={headerBar}>
        <span style={{ fontSize: 22 }}>♻️</span>
        <div>
          <div style={headerTitle}>Deposit Bottles</div>
          <div style={headerSub}>Earn print credits</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: connected ? "#2ecc71" : "#e74c3c", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#2ecc71" : "#e74c3c", display: "inline-block" }} />
          {connected ? "Online" : "Offline"}
        </div>
      </div>

      <div style={body}>

        {/* tap card first if not yet identified */}
       {!user && (step === "idle" || step === "unregistered") && !session?.errorMsg && <RFIDprompt onIdentified={handleIdentified} />}
        {/* gate open — insert bottle */}
        {user && step === "gate_open" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🚪</div>
            <div style={{ fontSize: 22, color: "#f0a500", fontWeight: 700 }}>Gate open</div>
            <div style={{ fontSize: 15, color: "#ccc", marginTop: 8 }}>
              Welcome, <strong>{session?.userName ?? user.name}</strong>
            </div>
            <div style={{ fontSize: 14, color: "#aaa", marginTop: 6 }}>Insert your bottle now</div>
            <div style={{ fontSize: 12, color: "#444", marginTop: 6 }}>Gate closes automatically after 10 seconds</div>
          </div>
        )}

        {/* validation steps */}
        {inValidation && (
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 16, color: "#f0a500", fontWeight: 700 }}>Validating bottle...</div>
            </div>
            {session?.steps.map(s => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 18px", marginBottom: 10,
                background: "#242424", borderRadius: 10,
                border: `1.5px solid ${STATUS_COLOR[s.status]}`,
                transition: "border-color 0.3s",
              }}>
                <span style={{ fontSize: 22, width: 28, textAlign: "center" }}>{STEP_ICONS[s.id]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                  {s.detail && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{s.detail}</div>}
                </div>
                <div style={{ fontSize: 20, width: 24, textAlign: "center" }}>
                  {s.status === "pending" && <span style={{ color: "#444" }}>○</span>}
                  {s.status === "running" && <span style={{ color: "#f0a500" }}>◌</span>}
                  {s.status === "pass"    && <span style={{ color: "#2ecc71" }}>✓</span>}
                  {s.status === "fail"    && <span style={{ color: "#e74c3c" }}>✗</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* result — accepted */}
        {step === "result" && session?.result === "accepted" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 24, color: "#2ecc71", fontWeight: 700, marginBottom: 6 }}>Bottle accepted!</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 20 }}>
              Size: <strong style={{ color: "#f0a500" }}>{session.size}</strong>
              {" · "}{session.heightMm}mm · {session.weightG}g
            </div>
            <div style={creditBox}>
              <div style={{ fontSize: 12, color: "#666" }}>Total credits</div>
              <div style={{ fontSize: 44, fontWeight: 800, color: "#f0a500" }}>{session.credits}</div>
            </div>
            <div style={{ fontSize: 12, color: "#444", marginTop: 14 }}>Returning to home screen...</div>
          </div>
        )}

        {/* result — rejected */}
        {step === "result" && session?.result === "rejected" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>❌</div>
            <div style={{ fontSize: 22, color: "#e74c3c", fontWeight: 700, marginBottom: 8 }}>Bottle rejected</div>
            <div style={{ fontSize: 14, color: "#aaa", maxWidth: 400, margin: "0 auto 20px" }}>
              {session.errorMsg}
            </div>
            <div style={{ fontSize: 12, color: "#444" }}>Returning to home screen...</div>
          </div>
        )}

        {/* timeout */}
        {step === "idle" && session?.errorMsg && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⏱️</div>
            <div style={{ fontSize: 16, color: "#e74c3c" }}>{session.errorMsg}</div>
            <button onClick={onBack} style={{ ...backBtn, marginTop: 20, maxWidth: 200 }}>Go back</button>
          </div>
        )}

        {showFeedback && (
          <FeedBackModal
            context="deposit"
            rfid={user?.rfid ?? session?.rfid}
            onClose={() => setShowFeedback(false)}
          />
        )}
      </div>
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: 1024, height: 600, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
};
const headerBar: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const body: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const creditBox: React.CSSProperties = {
  display: "inline-block", background: "#242424", border: "1.5px solid #2ecc71",
  borderRadius: 14, padding: "14px 40px", textAlign: "center",
};
const backBtn: React.CSSProperties = {
  width: "100%", padding: "12px", borderRadius: 10,
  background: "#f0a500", color: "#000", fontWeight: 700,
  fontSize: 15, border: "none", cursor: "pointer",
};
