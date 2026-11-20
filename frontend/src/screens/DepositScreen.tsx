import { useEffect, useState, useRef } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API, WS_URL } from "../config";
import type { Screen } from "../App";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  RecyclingIcon,
  CreditCardIcon,
  CreditCardOffIcon,
  RulerIcon,
  ScaleIcon,
  SearchIcon,
  SignalIcon,
  XCircleIcon,
} from "../components/KioskIcons";
import useKioskControls from "../components/useKioskControls";

interface Props { onBack: () => void; onNavigate: (s: Screen, params?: any) => void; }
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
  depositBottleCount: number;
  depositCreditsEarned: number;
  depositCo2Grams: number;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  ir: <SignalIcon size={22} />, capacitive: <SearchIcon size={22} />, tof: <RulerIcon size={22} />, loadcell: <ScaleIcon size={22} />,
};
const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "var(--kiosk-border-strong)", running: "var(--kiosk-accent-text)", pass: "var(--kiosk-success-text)", fail: "var(--kiosk-danger-text)",
};

export default function DepositScreen({ onBack, onNavigate }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [showRfidPrompt, setShowRfidPrompt] = useState(false);
  const [finishDestination, setFinishDestination] = useState<"print" | "home" | null>(null);
  const [finishError, setFinishError] = useState("");
  const feedbackShownRef = useRef(false);

  const step = session?.step ?? "idle";
  const off = useKioskControls();
  const depositOff = "deposit" in off;
  const rfidBlocked = depositOff || "rfid" in off;
  const rfidReason = off.deposit ?? off.rfid ?? "";
  const guestReason = off.deposit ?? "";
  const tileOff: React.CSSProperties = { opacity: 0.45, cursor: "not-allowed" };

    useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "idle" }),   // cards are ignored until the user picks "Tap RFID Card"
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
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "state") setSession(msg.session);
        } catch {}
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (step === "session_summary" && !guestMode && !feedbackShownRef.current) {
      feedbackShownRef.current = true;
      setShowFeedback(true);
    }
  }, [step, guestMode]);

  const handleIdentified = (u: User) => {
    feedbackShownRef.current = false;
    setFinishError("");
    setUser(u);
  };

  const handleGuestStart = async () => {
    try {
      const res = await fetch(`${API}/api/deposit/guest-start`, { method: "POST" });
      if (!res.ok) throw new Error("Could not start guest deposit.");
      feedbackShownRef.current = false;
      setFinishError("");
      setFinishDestination(null);
      setGuestMode(true);
      setUser({ rfid: "GUEST", name: "Guest", studentId: "", credits: 0 });
    } catch {
      setFinishError("Could not start guest deposit. Please try again.");
    }
  };

      const handlePickRfid = async () => {
    try {
      await fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "deposit" }),
      });
    } catch {}
    setShowRfidPrompt(true);
  };

  const handleFinishRfid = async () => {
    setFinishError("");
    try {
      const res = await fetch(`${API}/api/deposit/finish`, { method: "POST" });
      if (!res.ok) throw new Error("Could not finish deposit.");
    } catch {
      setFinishError("Could not finish depositing. Please try again.");
    }
  };

  const handleDoneDepositing = async () => {
    setFinishError("");
    try {
      const res = await fetch(`${API}/api/deposit/guest-stop`, { method: "POST" });
      if (!res.ok) throw new Error("Could not finish guest deposit.");
    } catch {
      setFinishError("Could not finish depositing. Please try again.");
      return;
    }
    const credits = session?.credits || 0;
    localStorage.setItem("guestCredits", String(credits));
    const destination = credits > 0 ? "print" : "home";
    setFinishDestination(destination);
    if (!feedbackShownRef.current) {
      feedbackShownRef.current = true;
      setShowFeedback(true);
    } else if (destination === "print") {
      onNavigate("print", { credits, isGuest: true });
    } else {
      onBack();
    }
  };

  const inValidation = ["ir", "capacitive", "tof", "loadcell", "storing"].includes(step);

    const wasActiveRef = useRef(false);
  useEffect(() => {
    if (step !== "idle" && step !== "unregistered") wasActiveRef.current = true;
    else if (wasActiveRef.current && user && !guestMode) onBack();
  }, [step]);

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={headerBar}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><RecyclingIcon size={24} color="#f0a500" /></span>
        <div style={{ width: "max-content", textAlign: "center" }}>
          <div style={headerTitle}>Deposit Bottles</div>
          <div style={headerSub}>Earn print credits</div>
        </div>
        {guestMode && (
          <div style={guestBadge}>
            Your credits: <strong style={{ color: "var(--kiosk-accent-text)", fontSize: 16 }}>{session?.credits ?? 0}</strong>
          </div>
        )}
        <div style={{ marginLeft: guestMode ? 14 : "auto", fontSize: 11, color: connected ? "var(--kiosk-success-text)" : "var(--kiosk-danger-text)", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#2ecc71" : "var(--kiosk-danger-text)", display: "inline-block" }} />
          {connected ? "Online" : "Offline"}
        </div>
      </div>

      <div className="kiosk-page-scroll" style={body}>
        {finishError && (
          <div style={{ position: "absolute", top: 72, left: 16, right: 16, zIndex: 5, textAlign: "center", color: "var(--kiosk-danger-text)", fontSize: 13 }}>
            {finishError}
          </div>
        )}
        {!user && !guestMode && !showRfidPrompt && (step === "idle" || step === "unregistered") && !session?.errorMsg && (
          <div style={{ textAlign: "center", width: "100%", maxWidth: 760, alignSelf: "center", marginBlock: "auto" }}>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 22 }}>How would you like to deposit?</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 640, margin: "0 auto" }}>
            <button
  onClick={() => { if (!rfidBlocked) handlePickRfid(); }}
  disabled={rfidBlocked}
  style={{ ...choiceTileStyle, ...(rfidBlocked ? tileOff : {}) }}
>
  <div style={tileIconWrap}><CreditCardIcon size={28} color={rfidBlocked ? "var(--kiosk-muted-low)" : "var(--kiosk-accent-text)"} /></div>
  <div style={{ textAlign: "left" }}>
    <div style={{ ...tileLabel, color: rfidBlocked ? "var(--kiosk-muted-secondary)" : "var(--kiosk-text)" }}>Tap RFID Card</div>
    <div style={{ ...tileSub, color: rfidBlocked ? "var(--kiosk-accent-text)" : "var(--kiosk-muted-low)" }}>
      {rfidBlocked ? rfidReason : "Use your registered card"}
    </div>
  </div>
</button>

<button
  onClick={() => { if (!depositOff) handleGuestStart(); }}
  disabled={depositOff}
  style={{ ...choiceTileStyle, ...(depositOff ? tileOff : {}) }}
>
  <div style={tileIconWrap}><CreditCardOffIcon size={28} color={depositOff ? "var(--kiosk-muted-low)" : "var(--kiosk-accent-text)"} /></div>
  <div style={{ textAlign: "left" }}>
    <div style={{ ...tileLabel, color: depositOff ? "var(--kiosk-muted-secondary)" : "var(--kiosk-text)" }}>Continue as Guest</div>
    <div style={{ ...tileSub, color: depositOff ? "var(--kiosk-accent-text)" : "var(--kiosk-muted-low)" }}>
      {depositOff ? guestReason : "No RFID card needed"}
    </div>
  </div>
</button>
            </div>
          </div>
        )}

        {!user && showRfidPrompt && ["idle", "unregistered", "awaiting_pin", "awaiting_new_pin"].includes(step) && !session?.errorMsg && (
          <RFIDprompt onIdentified={handleIdentified} />
        )}

        {user && step === "gate_open" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 16 }}><RecyclingIcon size={64} color="#f0a500" /></div>
            <div style={{ fontSize: 28, color: "var(--kiosk-accent-text)", fontWeight: 700 }}>Gate open</div>
            <div style={{ fontSize: 15, color: "var(--kiosk-text-secondary)", marginTop: 8 }}>
              Welcome, <strong>{session?.userName ?? user.name}</strong>
            </div>
            <div style={{ fontSize: 14, color: "var(--kiosk-muted)", marginTop: 6 }}>Insert your bottle now</div>
            <div style={{ fontSize: 12, color: "var(--kiosk-muted-faint)", marginTop: 6 }}>Gate closes automatically after 10 seconds</div>
          </div>
        )}

        {inValidation && (
          <div style={{ width: "100%", maxWidth: 680, alignSelf: "center", marginBlock: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 20, color: "var(--kiosk-accent-text)", fontWeight: 700 }}>
                {step === "storing"
                  ? "Moving bottle to storage..."
                  : step === "ir" && session?.steps[0]?.status === "pending"
                    ? "Ready for a bottle"
                    : "Validating bottle..."}
              </div>
              {step === "ir" && session?.steps[0]?.status === "pending" && (
                <div style={{ fontSize: 15, color: "var(--kiosk-muted)", marginTop: 8 }}>Insert your bottle now.</div>
              )}
            </div>
            {session?.steps.map(s => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "18px 22px", marginBottom: 12,
                background: "var(--kiosk-surface)", borderRadius: 10,
                border: `1.5px solid ${STATUS_COLOR[s.status]}`,
                transition: "border-color 0.3s",
              }}>
                <span style={{ display: "flex", width: 28, justifyContent: "center", color: "var(--kiosk-accent-text)" }}>{STEP_ICONS[s.id]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{s.label}</div>
                  {s.detail && <div style={{ fontSize: 13, color: "var(--kiosk-muted)", marginTop: 3 }}>{s.detail}</div>}
                </div>
                <div style={{ display: "flex", width: 24, justifyContent: "center" }}>
                  {s.status === "pending" && <ClockIcon size={20} color="var(--kiosk-muted-faint)" />}
                  {s.status === "running" && <ClockIcon size={20} color="#f0a500" />}
                  {s.status === "pass"    && <CheckCircleIcon size={20} color="#2ecc71" />}
                  {s.status === "fail"    && <XCircleIcon size={20} color="#e74c3c" />}
                </div>
              </div>
            ))}
            {step === "storing" && (
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--kiosk-muted)", marginTop: 6 }}>
                Credits are added once the bottle is confirmed
              </div>
            )}
          </div>
        )}

        {step === "session_summary" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 12 }}><CheckCircleIcon size={64} color="#2ecc71" /></div>
            <div style={{ fontSize: 28, color: "var(--kiosk-success-text)", fontWeight: 700, marginBottom: 10 }}>Deposit complete</div>
            <div style={{ fontSize: 18, color: "var(--kiosk-text-secondary)", marginBottom: 24 }}>
              {session?.depositBottleCount ?? 0} bottle(s) · +{session?.depositCreditsEarned ?? 0} credits
            </div>
            <button onClick={onBack} style={{ ...backBtn, maxWidth: 260 }}>Done</button>
          </div>
        )}

        {["gate_open", "ir", "result"].includes(step) && (guestMode || (!!session?.rfid && session.rfid !== "GUEST")) && (
          <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center" }}>
            <button
              onClick={guestMode ? handleDoneDepositing : handleFinishRfid}
              style={{ ...backBtn, maxWidth: 260 }}
            >
              {guestMode
                ? (session?.credits ?? 0) > 0 ? `Done — Go to Print (${session?.credits} credits)` : "Finish depositing"
                : "Finish depositing"}
            </button>
          </div>
        )}

        {step === "result" && session?.result === "accepted" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 12 }}><CheckCircleIcon size={64} color="#2ecc71" /></div>
            <div style={{ fontSize: 30, color: "var(--kiosk-success-text)", fontWeight: 700, marginBottom: 8 }}>Bottle accepted!</div>
            <div style={{ fontSize: 18, color: "var(--kiosk-text-secondary)", marginBottom: 24 }}>
              Size: <strong style={{ color: "var(--kiosk-accent-text)" }}>{session.size}</strong>
              {" · "}{session.heightMm != null ? (session.heightMm / 10).toFixed(1) : "—"} cm · {session.weightG}g
            </div>
            <div style={creditBox}>
              <div style={{ fontSize: 16, color: "var(--kiosk-text-secondary)" }}>Total credits</div>
              <div style={{ fontSize: 54, fontWeight: 800, color: "var(--kiosk-accent-text)" }}>{session.credits}</div>
            </div>
            <div style={{ fontSize: 16, color: "var(--kiosk-accent-text)", marginTop: 18 }}>
              Please wait until the gate finishes moving before inserting another bottle.
            </div>
          </div>
        )}

        {step === "result" && session?.result === "rejected" && (
          <div style={{ flex: 1, alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div style={{ marginBottom: 12 }}><XCircleIcon size={64} color="#e74c3c" /></div>
            <div style={{ fontSize: 22, color: "var(--kiosk-danger-text)", fontWeight: 700, marginBottom: 8 }}>Bottle rejected</div>
            <div style={{ fontSize: 14, color: "var(--kiosk-muted)", maxWidth: 400, margin: "0 auto 20px" }}>
              {session.errorMsg}
            </div>
            {!!(session.heightMm || session.weightG) && (
              <div style={{ fontSize: 13, color: "var(--kiosk-accent-text)", marginBottom: 16 }}>
                {session.heightMm ? `Height ${(session.heightMm / 10).toFixed(1)} cm` : ""}
                {session.heightMm && session.weightG ? " · " : ""}
                {session.weightG ? `Weight ${session.weightG}g` : ""}
              </div>
            )}
            <div style={{ fontSize: 13, color: "var(--kiosk-accent-text)" }}>
              Please wait until the gate finishes moving before inserting another bottle.
            </div>
          </div>
        )}

        {step === "idle" && session?.errorMsg && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 12 }}><AlertTriangleIcon size={48} color="#e74c3c" /></div>
            <div style={{ fontSize: 16, color: "var(--kiosk-danger-text)" }}>{session.errorMsg}</div>
            <button onClick={onBack} style={{ ...backBtn, marginTop: 20, maxWidth: 200 }}>Go back</button>
          </div>
        )}

        {showFeedback && (
          <FeedBackModal
            context="deposit"
            rfid={user?.rfid ?? session?.rfid}
            onClose={() => {
              setShowFeedback(false);
              if (finishDestination === "print") onNavigate("print", { credits: session?.credits || 0, isGuest: true });
              if (finishDestination === "home") onBack();
            }}
          />
        )}
      </div>
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: "100%", height: "100%", flex: 1, background: "var(--kiosk-bg)",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const headerBar: React.CSSProperties = {
  padding: "16px 24px", borderBottom: "1px solid var(--kiosk-surface-hover)",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 19, color: "var(--kiosk-text)" };
const headerSub: React.CSSProperties = { fontSize: 14, color: "var(--kiosk-muted)" };
const body: React.CSSProperties = {
  flex: 1, minHeight: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16,
  overflowY: "auto",
};
const creditBox: React.CSSProperties = {
  display: "inline-block", background: "var(--kiosk-surface)", border: "1.5px solid #2ecc71",
  borderRadius: 14, padding: "14px 40px", textAlign: "center",
};
const backBtn: React.CSSProperties = {
  width: "100%", minHeight: 56, padding: "14px", borderRadius: 10,
  background: "var(--kiosk-accent-text)", color: "#000", fontWeight: 700,
  fontSize: 18, border: "none", cursor: "pointer",
};
const choiceTileStyle: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14,
  padding: "24px", display: "flex", alignItems: "center",
  gap: 20, cursor: "pointer", textAlign: "left", minHeight: 136, boxShadow: "none",
};
const tileIconWrap: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 12, background: "var(--kiosk-bg)",
  border: "1px solid var(--kiosk-border-strong)", display: "flex", alignItems: "center",
  justifyContent: "center", flexShrink: 0,
};
const tileLabel: React.CSSProperties = { fontSize: 21, fontWeight: 700, color: "var(--kiosk-text)", marginBottom: 6 };
const tileSub: React.CSSProperties = { fontSize: 15, color: "var(--kiosk-muted)" };
const guestBadge: React.CSSProperties = {
  marginLeft: "auto", padding: "6px 14px", borderRadius: 999,
  background: "var(--kiosk-surface)", border: "1.5px solid #f0a500",
  fontSize: 12, color: "var(--kiosk-text-secondary)", display: "flex", alignItems: "center", gap: 8,
};