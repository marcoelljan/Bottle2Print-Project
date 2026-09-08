import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import PINpad from "../components/Pinpad";
import { API, WS_URL } from "../config";
import { AccountCircleIcon, CreditCardIcon } from "../components/KioskIcons";

interface Props { onBack: () => void; }

type Step = "tap" | "form" | "pin" | "confirm_pin" | "saving" | "success" | "error" | "already";

// Helper function to capitalize the first letter of each word (Title Case)
const formatTitleCase = (str: string) => {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
};

export default function RegisterScreen({ onBack }: Props) {
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

  // Student ID Regex Pattern: Matches format like 123-12345M (3 digits, hyphen, 5 digits, 1 uppercase letter)
  const studentIdRegex = /^\d{3}-\d{5}[A-Z]$/;
  const isStudentIdValid = studentIdRegex.test(studentId.trim());

  // Only show the red error if they have typed a full length code (or more) and it's invalid
  const showStudentIdError = studentId.trim().length >= 10 && !isStudentIdValid;

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
          if (handled || msg.type !== "state" || !msg.session?.rfid || msg.session.sessionId === 0) return;

          const scannedRfid = msg.session.rfid;

          let userData = null;
          try {
            const userRes = await fetch(`${API}/api/user/${scannedRfid}`);
            if (userRes.ok) {
              userData = await userRes.json();
            }
          } catch {}

          if (userData && userData.pin_hash) {
            handled = true;
            ws?.close();
            setRfid(scannedRfid);
            setStep("already");
            return;
          }

          handled = true;
          ws?.close();
          setRfid(scannedRfid);
          setSurname(userData?.surname ? formatTitleCase(userData.surname) : "");
          setFirstname(userData?.firstname ? formatTitleCase(userData.firstname) : "");
          setMiddlename(userData?.middlename ? formatTitleCase(userData.middlename) : "");
          setStudentId(userData?.studentId ? userData.studentId.toUpperCase() : "");
          setStep("form");
          return;
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
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          shouldClose = true;
        }
      }
    };
  }, [step]);

  const handleProceedToPin = () => {
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
      </div>

      <div style={body}>

        {/* tap card */}
        {step === "tap" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%",
              border: `3px solid #f0a500`,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: pulse ? 1 : 0.4,
              transition: "opacity 0.4s",
              boxShadow: pulse ? "0 0 24px #f0a50055" : "none",
            }}>
              <CreditCardIcon size={42} color="#f0a500" />
            </div>
            <div>
              <div style={{ fontSize: 18, color: "#f0a500", fontWeight: 600 }}>Tap your RFID card</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>Hold your card near the reader to begin</div>
            </div>

          </div>
        )}

        {/* form without guidelines */}
        {step === "form" && (
          <div style={card}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Enter your details</div>
              <div style={{ fontSize: 12, color: "#555" }}>RFID: {rfid}</div>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Surname (Last Name)</label>
              <input
                value={surname}
                onChange={e => setSurname(formatTitleCase(e.target.value))}
                placeholder="e.g. Dela Cruz"
                style={input}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Firstname</label>
              <input
                value={firstname}
                onChange={e => setFirstname(formatTitleCase(e.target.value))}
                placeholder="e.g. Juan"
                style={input}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Middlename (Full or Initial, Optional)</label>
              <input
                value={middlename}
                onChange={e => setMiddlename(formatTitleCase(e.target.value))}
                placeholder="e.g. Santos or S."
                style={input}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Student ID Layout (e.g. 123-12345M)</label>
              <input
                value={studentId}
                onChange={e => setStudentId(e.target.value.toUpperCase())}
                placeholder="123-12345M"
                style={{
                  ...input,
                  borderColor: showStudentIdError ? "#e74c3c" : "#3a3a3a"
                }}
              />
              {showStudentIdError && (
                <div style={{ fontSize: 10, color: "#e74c3c", marginTop: 4 }}>
                  Invalid format. Expected layout: 123-12345M
                </div>
              )}
            </div>

            {/* Data Privacy & Terms and Agreement Checkbox */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, textAlign: "left" }}>
              <input
                type="checkbox"
                id="terms"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                style={{ marginTop: 3, cursor: "pointer", accentColor: "#f0a500" }}
              />
              <label htmlFor="terms" style={{ fontSize: 11, color: "#888", lineHeight: 1.4, cursor: "pointer" }}>
                I agree to the <strong style={{ color: "#aaa" }}>Data Privacy Policy</strong>. I consent to the collection of my credentials and recycling metrics for tracking.
              </label>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep("tap")} style={ghostBtn}>Cancel</button>
              <button
                onClick={handleProceedToPin}
                disabled={!isFormValid}
                style={{
                  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 700,
                  fontSize: 15, border: "none", cursor: isFormValid ? "pointer" : "not-allowed",
                  background: isFormValid ? "#f0a500" : "#333",
                  color: isFormValid ? "#000" : "#555",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* PIN creation modal (Step 1) */}
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

        {/* PIN confirmation modal (Step 2) */}
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

        {/* saving */}
        {step === "saving" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, color: "#f0a500" }}>Saving account & PIN...</div>
          </div>
        )}

        {/* success */}
        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, color: "#2ecc71", fontWeight: 700, marginBottom: 8 }}>Registered!</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 4 }}>{surname}, {firstname} {middlename}</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 24 }}>Student ID: {studentId}</div>
            <button onClick={onBack} style={doneBtn}>Done</button>
          </div>
        )}

        {/* already registered */}
        {step === "already" && (
          <div style={{ textAlign: "center" }}>
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
  width: "100%", height: "100%", flex: 1, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const headerBar: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const body: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
  overflow: "hidden",
};
const card: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "20px 28px", width: "100%", maxWidth: 460,
  maxHeight: "100%", overflowY: "auto", boxSizing: "border-box",
};
const fieldGroup: React.CSSProperties = { marginBottom: 12 };
const fieldLabel: React.CSSProperties = { fontSize: 11, color: "#888", display: "block", marginBottom: 4 };
const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "#1e1e1e",
  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
  fontSize: 14, outline: "none", boxSizing: "border-box",
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