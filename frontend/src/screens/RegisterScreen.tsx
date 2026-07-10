import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import { API, WS_URL } from "../config";

interface Props { onBack: () => void; }

type Step = "tap" | "form" | "saving" | "success" | "error" | "already";


export default function RegisterScreen({ onBack }: Props) {
  const [step, setStep]         = useState<Step>("tap");
  const [rfid, setRfid]         = useState("");
  const [name, setName]         = useState("");
  const [studentId, setStudentId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [pulse, setPulse]       = useState(false);

  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(t);
  }, []);
   
  useEffect(() => {
  if (step !== "tap") return;

  let cancelled = false;
  let ws: WebSocket | null = null;
  let handled = false;

  (async () => {
    try {
      // Wait for the mode switch (and the session reset it triggers)
      // to fully complete on the backend BEFORE opening the socket.
      await fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "register" }),
      });
    } catch {
      // even if this fails, still try to proceed
    }

    if (cancelled) return;

    ws = new WebSocket(WS_URL);
    ws.onclose = () => {};
    ws.onerror = () => {};

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (handled || msg.type !== "state" || !msg.session?.rfid || msg.session.sessionId === 0) return;

        if (msg.session.step === "already_registered") {
          handled = true;
          ws?.close();
          setRfid(msg.session.rfid);
          setStep("already");
          return;
        }

        if (msg.session.step === "identified") {
          handled = true;
          ws?.close();
          setRfid(msg.session.rfid);
          setName(
            msg.session.userName && msg.session.userName !== "User"
              ? msg.session.userName : ""
          );
          setStep("form");
          return;
        }
      } catch {}
    };
  })();

  return () => {
    cancelled = true;
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "idle" }),
    });
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  };
}, [step]);
  const handleSave = async () => {
    if (!name.trim() || !studentId.trim()) return;
    setStep("saving");
    try {
      const res = await fetch(`${API}/api/user/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid, name: name.trim(), studentId: studentId.trim() }),
      });
      if (res.ok) {
        setStep("success");
      } else {
        const d = await res.json();
        setErrorMsg(d.error ?? "Registration failed.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Could not reach backend.");
      setStep("error");
    }
  };

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={headerBar}>
        <span style={{ fontSize: 22 }}>👤</span>
        <div>
          <div style={headerTitle}>Register RFID</div>
          <div style={headerSub}>Link a new card to your account</div>
        </div>
      </div>

      <div style={body}>

        {/* tap card */}
        {step === "tap" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%",
              border: `3px solid #f0a500`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 44, opacity: pulse ? 1 : 0.4,
              transition: "opacity 0.4s",
              boxShadow: pulse ? "0 0 24px #f0a50055" : "none",
            }}>
              💳
            </div>
            <div>
              <div style={{ fontSize: 18, color: "#f0a500", fontWeight: 600 }}>Tap your RFID card</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>Hold your card near the reader to begin</div>
            </div>
          </div>
        )}

        {/* form */}
        {step === "form" && (
          <div style={card}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Enter your details</div>
              <div style={{ fontSize: 12, color: "#555" }}>RFID: {rfid}</div>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Full name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Juan dela Cruz"
                style={input}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Student ID</label>
              <input
                value={studentId}
                onChange={e => setStudentId(e.target.value)}
                placeholder="e.g. 2023-00001"
                style={input}
              />
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <button onClick={() => setStep("tap")} style={ghostBtn}>Cancel</button>
              <button
                onClick={handleSave}
                disabled={!name.trim() || !studentId.trim()}
                style={{
                  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 700,
                  fontSize: 15, border: "none", cursor: name.trim() && studentId.trim() ? "pointer" : "not-allowed",
                  background: name.trim() && studentId.trim() ? "#f0a500" : "#333",
                  color: name.trim() && studentId.trim() ? "#000" : "#555",
                }}
              >
                Register
              </button>
            </div>
          </div>
        )}

        {/* saving */}
        {step === "saving" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 18, color: "#f0a500" }}>Saving...</div>
          </div>
        )}

        {/* success */}
        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, color: "#2ecc71", fontWeight: 700, marginBottom: 8 }}>Registered!</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 8 }}>{name}</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 24 }}>Student ID: {studentId}</div>
            <button onClick={onBack} style={doneBtn}>Done</button>
          </div>
        )}

        {/* already registered */}
        {step === "already" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>ℹ️</div>
            <div style={{ fontSize: 20, color: "#f0a500", fontWeight: 700, marginBottom: 8 }}>Card already registered</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>
              This RFID card is already linked to an account.
            </div>
            <button onClick={onBack} style={doneBtn}>Back to home</button>
          </div>
        )}

        {/* error */}
        {step === "error" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 20, color: "#e74c3c", fontWeight: 700, marginBottom: 8 }}>Registration failed</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>{errorMsg}</div>
            <button onClick={() => setStep("form")} style={doneBtn}>Try again</button>
          </div>
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
const card: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "28px 32px", width: "100%", maxWidth: 460,
};
const fieldGroup: React.CSSProperties = { marginBottom: 16 };
const fieldLabel: React.CSSProperties = { fontSize: 12, color: "#888", display: "block", marginBottom: 6 };
const input: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "#1e1e1e",
  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
  fontSize: 15, outline: "none",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};
const doneBtn: React.CSSProperties = {
  padding: "12px 40px", borderRadius: 10, background: "#f0a500",
  color: "#000", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer",
};
