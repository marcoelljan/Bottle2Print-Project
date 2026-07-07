import { useEffect, useState } from "react";

interface Props {
  onIdentified: (user: { rfid: string; name: string; studentId: string; credits: number }) => void;
}

const WS_URL = "ws://localhost:4000";
const API = "http://localhost:4000";

export default function RFIDprompt({ onIdentified }: Props) {
  const [pulse, setPulse] = useState(false);
  const [status, setStatus] = useState<"waiting" | "found" | "error">("waiting");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(interval);
  }, []);

 useEffect(() => {
  
  const ws = new WebSocket(WS_URL);

  ws.onclose = () => {};
  ws.onerror = () => {};

  ws.onmessage = async (e) => {
  try {
    const data = JSON.parse(e.data);
    if (data.type === "state" && data.session?.sessionId > 0) {

      if (data.session.step === "unregistered") {
        setStatus("error");
        setMsg("Card not registered. Please register first.");
        setTimeout(() => {
          setStatus("waiting");
          setMsg("");
        }, 3000);
        return;
      }

      if (data.session?.rfid && data.session.step === "identified") {
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
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}, [onIdentified]);
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
      fontSize: 44,
      opacity: pulse ? 1 : 0.5,
      transition: "opacity 0.4s",
      boxShadow: pulse ? `0 0 24px ${status === "error" ? "#e74c3c55" : "#f0a50055"}` : "none",
    }}>
      💳
    </div>
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 18, color: status === "error" ? "#e74c3c" : "#f0a500", fontWeight: 600 }}>
        {status === "found"
          ? msg
          : status === "error"
          ? msg
          : "Tap your RFID card"}
      </p>
      <p style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
        {status === "waiting" ? "Hold your card near the reader" : ""}
      </p>
    </div>
  </div>
); }