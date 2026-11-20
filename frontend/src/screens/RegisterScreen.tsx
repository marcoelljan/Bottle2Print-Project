import { useEffect, useState, useRef } from "react";
import BackButton from "../components/BackButton";
import PINpad from "../components/Pinpad";
import { API, WS_URL } from "../config";
import { AccountCircleIcon, CreditCardIcon } from "../components/KioskIcons";
import RFIDprompt from "../components/RFIDprompt";
import KioskThemeToggle from "../components/KioskThemeToggle";

interface Props { onBack: () => void; theme: "dark" | "light"; onToggleTheme: () => void; }

type Step = "tap" | "form" | "pin" | "confirm_pin" | "saving" | "success" | "error" | "already" | "reset" | "reset_done";

export default function RegisterScreen({ onBack, theme, onToggleTheme }: Props) {
  const [step, setStep]         = useState<Step>("tap");
  const [rfid, setRfid]         = useState("");
  const [surname, setSurname]   = useState("");
  const [firstname, setFirstname] = useState("");
  const [middlename, setMiddlename] = useState("");
  const [studentId, setStudentId] = useState("");
  const [agreed, setAgreed]     = useState(false);
  const [firstPin, setFirstPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [pulse, setPulse]       = useState(false);

  const keepModeRef = useRef(false);
  useEffect(() => () => {
    fetch(`${API}/api/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "idle" }) });
  }, []);

  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const studentIdRegex = /^\d{3}-\d{5}[A-Z]$/;
  const isStudentIdValid = studentIdRegex.test(studentId.trim());
  const studentIdProblem = (() => {
    const s = studentId.trim();
    if (!s) return "Student ID is required.";
    if (!/^\d{3}-/.test(s)) return "Start with 3 digits, then a dash. Example: 123-12345M";
    if (!/^\d{3}-\d{5}/.test(s)) return "After the dash, enter 5 digits. Example: 123-12345M";
    if (s.length < 10) return "Add the last letter at the end. Example: 123-12345M";
    if (!isStudentIdValid) return "The ID must end with one capital letter and nothing after it. Example: 123-12345M";
    return "";
  })();
  const showStudentIdError = !isStudentIdValid && (attemptedSubmit || studentId.trim().length >= 10);

  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(t);
  }, []);
   
  useEffect(() => {
    if (step !== "tap") return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let handled = false;
    let shouldClose = false;

    (async () => {
      try {
        await fetch(`${API}/api/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "register" }),
        });
      } catch {}

      if (cancelled) return;

      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        if (shouldClose) ws?.close();
      };
      ws.onclose = () => {};
      ws.onerror = () => {};

           ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (handled || msg.type !== "state" || !msg.session || !(msg.session.sessionId > 0)) return;

          const { step: s, rfid: scanned } = msg.session;

          // Reset-PIN flow
          if (s === "awaiting_new_pin") {
            handled = true;
            keepModeRef.current = true;
            ws?.close();
            setRfid(scanned);
            setStep("reset");
            return;
          }

          // Normal registration flow
          if ((s === "identified" || s === "already_registered") && scanned) {
            handled = true;
            await handleCardDetected(scanned, ws);
          }
        } catch {}
      };
    })();

    return () => {
      cancelled = true;
      if (!keepModeRef.current) {
        fetch(`${API}/api/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "idle" }),
        });
      }
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          shouldClose = true;
        }
      }
    };
  }, [step]);

  const handleCardDetected = async (scannedRfid: string, socket?: WebSocket | null) => {
    let userData = null;
    try {
      const userRes = await fetch(`${API}/api/user/${scannedRfid}`);
      if (userRes.ok) {
        userData = await userRes.json();
      }
    } catch {}

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    if (userData && userData.hasPin) {
      setRfid(scannedRfid);
      setStep("already");
      return;
    }

    setRfid(scannedRfid);
    setSurname(userData?.surname ?? "");
    setFirstname(userData?.firstname ?? "");
    setMiddlename(userData?.middlename ?? "");
    setStudentId(userData?.studentId ? userData.studentId.toUpperCase() : "");
    setAttemptedSubmit(false);
    setStep("form");
  };

  const handleProceedToPin = () => {
    setAttemptedSubmit(true);
    if (!surname.trim() || !firstname.trim() || !isStudentIdValid || !agreed) return;
    setFirstPin("");
    setPinError("");
    setStep("pin");
  };

  const handleFirstPinSubmit = (enteredPin: string) => {
    setFirstPin(enteredPin);
    setPinError("");
    setStep("confirm_pin");
  };

  const handleConfirmPinSubmit = async (confirmedPin: string) => {
    if (confirmedPin !== firstPin) {
      setPinError("PINs do not match. Please try again.");
      setFirstPin("");
      setStep("pin");
      return;
    }

    setStep("saving");
    try {
      const res = await fetch(`${API}/api/user/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          rfid, 
          surname: surname.trim(), 
          firstname: firstname.trim(), 
          middlename: middlename.trim(), 
          studentId: studentId.trim().toUpperCase(),
          pin: confirmedPin 
        }),
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

  const isFormValid = surname.trim() && firstname.trim() && isStudentIdValid && agreed;

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={headerBar}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><AccountCircleIcon size={22} color="#f0a500" /></span>
        <div>
          <div style={headerTitle}>Register RFID</div>
          <div style={headerSub}>Link a new card to your account</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <KioskThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </div>

      <div className="kiosk-page-scroll" style={body}>
        {step === "tap" && (
          <div style={{ width: "100%", minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, textAlign: "center" }}>
            <div style={{
              width: 150, height: 150, borderRadius: "50%",
              border: `4px solid #f0a500`,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: pulse ? 1 : 0.4,
              transition: "opacity 0.4s",
              boxShadow: pulse ? "0 0 32px #f0a50055" : "none",
            }}>
              <CreditCardIcon size={64} color="#f0a500" />
            </div>
            <div>
              <div style={{ fontSize: 28, color: "var(--kiosk-accent-text)", fontWeight: 700 }}>Tap your RFID card</div>
              <div style={{ fontSize: 18, color: "var(--kiosk-muted)", marginTop: 10 }}>Hold your card near the reader to begin</div>
            </div>
          </div>
        )}

        {step === "form" && (
          <div style={card}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Enter your details</div>
              <div style={{ fontSize: 12, color: "var(--kiosk-muted-dim)" }}>RFID: {rfid}</div>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Surname (Last Name) <span style={{ color: "var(--kiosk-danger-text)" }}>*</span></label>
              <input
                value={surname}
                onChange={e => setSurname(e.target.value)}
                onFocus={e => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
                placeholder="e.g. Dela Cruz"
                className="registration-field"
                style={{
                  ...input,
                  borderColor: attemptedSubmit && !surname.trim() ? "#e74c3c" : "var(--kiosk-border-strong)"
                }}
              />
              {attemptedSubmit && !surname.trim() && (
                <div style={{ fontSize: 10, color: "var(--kiosk-danger-text)", marginTop: 3 }}>Surname is required.</div>
              )}
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Firstname <span style={{ color: "var(--kiosk-danger-text)" }}>*</span></label>
              <input
                value={firstname}
                onChange={e => setFirstname(e.target.value)}
                onFocus={e => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
                placeholder="e.g. Juan"
                className="registration-field"
                style={{
                  ...input,
                  borderColor: attemptedSubmit && !firstname.trim() ? "#e74c3c" : "var(--kiosk-border-strong)"
                }}
              />
              {attemptedSubmit && !firstname.trim() && (
                <div style={{ fontSize: 10, color: "var(--kiosk-danger-text)", marginTop: 3 }}>Firstname is required.</div>
              )}
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Middlename (Full or Initial, Optional)</label>
              <input
                value={middlename}
                onChange={e => setMiddlename(e.target.value)}
                onFocus={e => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
                placeholder="e.g. Santos or S."
                className="registration-field"
                style={input}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Student ID Layout (e.g. 123-12345M) <span style={{ color: "var(--kiosk-danger-text)" }}>*</span></label>
              <input
                data-kb="digits"
                value={studentId}
                onChange={e => setStudentId(e.target.value.toUpperCase())}
                onFocus={e => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
                placeholder="123-12345M"
                className="registration-field"
                style={{
                  ...input,
                  borderColor: showStudentIdError ? "#e74c3c" : "var(--kiosk-border-strong)"
                }}
              />
               {showStudentIdError && (
                <div style={{ fontSize: 11, color: "var(--kiosk-danger-text)", marginTop: 3 }}>{studentIdProblem}</div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, textAlign: "left" }}>
              <input
                type="checkbox"
                id="terms"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--kiosk-accent-text)" }}
              />
              <label htmlFor="terms" style={{ fontSize: 11, color: attemptedSubmit && !agreed ? "var(--kiosk-danger-text)" : "var(--kiosk-muted-secondary)", lineHeight: 1.4, cursor: "pointer" }}>
                I agree to the <strong style={{ color: "var(--kiosk-muted)" }}>Data Privacy Policy</strong>. I consent to the collection of my credentials and recycling metrics for tracking. <span style={{ color: "var(--kiosk-danger-text)" }}>*</span>
              </label>
            </div>
                           {attemptedSubmit && !isFormValid && (
              <div style={{ fontSize: 12, color: "var(--kiosk-danger-text)", marginBottom: 10, textAlign: "left" }}>
                Please fix the highlighted fields before continuing.
              </div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep("tap")} style={ghostBtn}>Cancel</button>
              <button
                onClick={handleProceedToPin}
                style={{
                  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 700,
                  fontSize: 15, border: "none", cursor: "pointer",
                  background: isFormValid ? "#f0a500" : "var(--kiosk-accent-text)",
                  color: "black",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "pin" && (
          <PINpad
            title="Create your 6-digit PIN"
            subtitle="You will use this PIN to log in and transfer credits"
            length={6}
            error={pinError}
            onSubmit={handleFirstPinSubmit}
            onCancel={() => setStep("form")}
          />
        )}

        {step === "confirm_pin" && (
          <PINpad
            title="Confirm your 6-digit PIN"
            subtitle="Re-enter your PIN to verify"
            length={6}
            error={pinError}
            onSubmit={handleConfirmPinSubmit}
            onCancel={() => setStep("pin")}
          />
        )}

                {step === "reset" && (
          <RFIDprompt onIdentified={() => { keepModeRef.current = false; setStep("reset_done"); }} />
        )}
        {step === "reset_done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, color: "var(--kiosk-success-text)", fontWeight: 700, marginBottom: 16 }}>New PIN saved</div>
            <button onClick={onBack} style={doneBtn}>Done</button>
          </div>
        )}

        {step === "saving" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "var(--kiosk-accent-text)" }}>Saving account & PIN...</div>
          </div>
        )}

        {step === "success" && (
          <div style={{ width: "100%", minHeight: "100%", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div style={{ fontSize: 28, color: "var(--kiosk-success-text)", fontWeight: 700, marginBottom: 10 }}>Registered!</div>
            <div style={{ fontSize: 18, color: "var(--kiosk-muted)", marginBottom: 6 }}>{surname}, {firstname} {middlename}</div>
            <div style={{ fontSize: 15, color: "var(--kiosk-muted-secondary)", marginBottom: 26 }}>Student ID: {studentId}</div>
            <button onClick={onBack} style={doneBtn}>Done</button>
          </div>
        )}

        {step === "already" && (
          <div style={{ width: "100%", minHeight: "100%", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div style={{ fontSize: 20, color: "var(--kiosk-accent-text)", fontWeight: 700, marginBottom: 8 }}>Card already registered</div>
            <div style={{ fontSize: 17, color: "var(--kiosk-muted)", marginBottom: 24, maxWidth: 480 }}>
              This RFID card is already linked to an account.
            </div>
            <button onClick={onBack} style={doneBtn}>Back to home</button>
          </div>
        )}

        {step === "error" && (
          <div style={{ width: "100%", minHeight: "100%", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div style={{ fontSize: 20, color: "var(--kiosk-danger-text)", fontWeight: 700, marginBottom: 8 }}>Registration failed</div>
            <div style={{ fontSize: 17, color: "var(--kiosk-muted)", marginBottom: 24, maxWidth: 480 }}>{errorMsg}</div>
            <button onClick={() => setStep("form")} style={doneBtn}>Try again</button>
          </div>
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
  padding: "14px 24px", borderBottom: "1px solid var(--kiosk-surface-hover)",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "var(--kiosk-text)" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "var(--kiosk-muted-dim)" };
const body: React.CSSProperties = {
  flex: 1, minHeight: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16,
  overflowY: "auto",
};
const card: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14,
  padding: "20px 28px", width: "100%", maxWidth: 460,
  boxSizing: "border-box",
};
const fieldGroup: React.CSSProperties = { marginBottom: 12 };
const fieldLabel: React.CSSProperties = { fontSize: 11, color: "var(--kiosk-muted-secondary)", display: "block", marginBottom: 4 };
const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "var(--kiosk-input)",
  border: "1px solid var(--kiosk-border-strong)", borderRadius: 8, color: "var(--kiosk-text)",
  fontSize: 16, outline: "none", boxSizing: "border-box",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "var(--kiosk-muted)",
  border: "1px solid var(--kiosk-border-strong)", cursor: "pointer",
};
const doneBtn: React.CSSProperties = {
  padding: "12px 40px", borderRadius: 10, background: "var(--kiosk-accent-text)",
  color: "#000", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer",
};
