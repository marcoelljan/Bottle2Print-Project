import { useEffect, useState } from "react";
import { API, WS_URL } from "../config";
import { CreditCardIcon } from "./KioskIcons";
import PINpad from "./Pinpad";

interface Props {
  onIdentified: (user: { rfid: string; name: string; studentId: string; credits: number }) => void;
  onBack?: () => void;
}

export default function RFIDprompt({ onIdentified, onBack }: Props) {
  const [pulse, setPulse] = useState(false);
  const [status, setStatus] = useState<"waiting" | "found" | "error">("waiting");
  const [msg, setMsg] = useState("");
  const [awaitingPin, setAwaitingPin] = useState(false);
  const [pinMode, setPinMode] = useState<"verify" | "new">("verify");
  const [pinError, setPinError] = useState("");
  const [verifyingPin, setVerifyingPin] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    let shouldClose = false;

    ws.onopen = () => {
      if (shouldClose) ws.close();
    };
    ws.onclose = () => {};
    ws.onerror = () => {};

    ws.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "state" && data.session?.sessionId > 0) {
          if (data.session.step === "awaiting_pin") {
            setAwaitingPin(true);
            setPinMode("verify");
            return;
          }

          if (data.session.step === "awaiting_new_pin") {
            setAwaitingPin(true);
            setPinMode("new");
            return;
          }

          if (data.session.step === "unregistered") {
            setStatus("error");
            setMsg("Card not registered. Please register first.");
            setTimeout(() => {
              setStatus("waiting");
              setMsg("");
            }, 3000);
            return;
          }

          if (data.session?.rfid && (data.session.step === "identified" || data.session.step === "ir")) {
            setStatus("found");
            setMsg(`Welcome, ${data.session.userName}`);
            try {
              const res = await fetch(`${API}/api/user/${data.session.rfid}`);
              const user = await res.json();
              setTimeout(() => {
                onIdentified({
                  rfid:      user.rfid,
                  name:      user.name,
                  studentId: user.studentId ?? "",
                  credits:   user.credits,
                });
              }, 800);
            } catch {
              setTimeout(() => {
                onIdentified({
                  rfid:      data.session.rfid,
                  name:      data.session.userName,
                  studentId: "",
                  credits:   data.session.credits,
                });
              }, 800);
            }
            ws.close();
          }
        }
      } catch {}
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        shouldClose = true;
      }
    };
  }, [onIdentified]);

  const handlePinSubmit = async (pin: string) => {
    setVerifyingPin(true);
    setPinError("");
    try {
      const endpoint = pinMode === "new" ? `${API}/api/session/update-pin` : `${API}/api/session/verify-pin`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      
      if (!res.ok || data.success === false) {
        setPinError(data.error || "Operation failed. Try again.");
      } else if (data.requiresNewPin) {
        setPinMode("new");
        setPinError("");
      } else {
        setAwaitingPin(false);
      }
    } catch {
      setPinError("Network error. Try again.");
    } finally {
      setVerifyingPin(false);
    }
  };

  if (awaitingPin) {
    return (
      <PINpad
        title={pinMode === "new" ? "Set New 6-Digit PIN" : "Enter your PIN"}
        subtitle={pinMode === "new" ? "Your PIN was reset by an admin. Please create a new PIN." : "PIN required to verify card identity"}
        length={6}
        error={pinError}
        disabled={verifyingPin}
        disabledMessage={verifyingPin ? (pinMode === "new" ? "Saving new PIN..." : "Verifying PIN...") : undefined}
        onSubmit={handlePinSubmit}
        onCancel={() => setAwaitingPin(false)}
      />
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      flex: 1, gap: 24,
    }}>
      <div style={{
        width: 100, height: 100, borderRadius: "50%",
        border: `3px solid ${status === "error" ? "#e74c3c" : "#f0a500"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: pulse ? 1 : 0.5,
        transition: "opacity 0.4s",
        boxShadow: pulse ? `0 0 24px ${status === "error" ? "#e74c3c55" : "#f0a50055"}` : "none",
      }}>
        <CreditCardIcon size={42} color={status === "error" ? "#e74c3c" : "#f0a500"} />
      </div>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 18, color: status === "error" ? "#e74c3c" : "#f0a500", fontWeight: 600 }}>
          {status === "found" ? msg : status === "error" ? msg : "Tap your RFID card"}
        </p>
        <p style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
          {status === "waiting" ? "Hold your card near the reader" : ""}
        </p>
      </div>

      {onBack && (
        <button 
          onClick={onBack} 
          style={{
            background: "transparent", border: "1px solid #3a3a3a", 
            color: "#aaa", padding: "10px 24px", borderRadius: 10, 
            cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 10
          }}
        >
          Back to payment options
        </button>
      )}
    </div>
  );
}