import { useState, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";


interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }


const API = "http://localhost:4000";


export default function CheckBalanceScreen({ onBack }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<any[]>([]);


  useEffect(() => {
    fetch("http://localhost:4000/api/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "balance" }),
    });
    return () => {
      fetch("http://localhost:4000/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

  
  
  const handleIdentified = async (u: User) => {
    setUser(u);
    try {
      const res = await fetch(`${API}/api/user/${u.rfid}/transactions`);
      const data = await res.json();
      setHistory(data.slice(0, 5));
    } catch {}
  };

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22 }}>💳</span>
        <div>
          <div style={headerTitle}>Check Balance</div>
          <div style={headerSub}>View your print credits</div>
        </div>
      </div>

      <div style={body}>
        {!user
          ? <RFIDprompt onIdentified={handleIdentified} />
          : (
            <div style={{ width: "100%", maxWidth: 580, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* profile card */}
              <div style={profileCard}>
                <div style={avatar}>{user.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>ID: {user.studentId || "Not set"}</div>
                  <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>RFID: {user.rfid}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#666" }}>Available credits</div>
                  <div style={{ fontSize: 40, fontWeight: 800, color: "#f0a500", lineHeight: 1.1 }}>{user.credits}</div>
                  <div style={{ fontSize: 11, color: "#555" }}>credits</div>
                </div>
              </div>

              {/* credit info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={statCard}>
                  <div style={statLabel}>Bottles deposited</div>
                  <div style={statVal}>{history.filter(h => h.type === "deposit").length}</div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>Print jobs done</div>
                  <div style={statVal}>{history.filter(h => h.type === "print").length}</div>
                </div>
              </div>

              {/* recent activity */}
              {history.length > 0 && (
                <div style={{ background: "#242424", border: "1px solid #333", borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 12, fontWeight: 600, letterSpacing: 1 }}>
                    RECENT ACTIVITY
                  </div>
                  {history.map((h, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 0", borderBottom: i < history.length - 1 ? "1px solid #2a2a2a" : "none",
                    }}>
                      <div>
                        <div style={{ fontSize: 13, color: "#ccc" }}>
                          {h.type === "deposit" ? `♻️ Bottle deposited (${h.size ?? "—"})` : `🖨️ Print job (${h.pages ?? h.credits} page${h.credits > 1 ? "s" : ""})`}
                        </div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{new Date(h.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{ fontWeight: 700, color: h.type === "deposit" ? "#2ecc71" : "#e74c3c", fontSize: 14 }}>
                        {h.type === "deposit" ? `+${h.credits}` : `-${h.credits}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={onBack} style={backBtn}>Done</button>
            </div>
          )
        }
      </div>
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: 1024, height: 600, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
};
const header: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const body: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const profileCard: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "20px 24px", display: "flex", alignItems: "center", gap: 16,
};
const avatar: React.CSSProperties = {
  width: 52, height: 52, borderRadius: "50%", background: "#f0a500",
  color: "#000", fontWeight: 800, fontSize: 22,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const statCard: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 12,
  padding: "14px 18px",
};
const statLabel: React.CSSProperties = { fontSize: 11, color: "#666", marginBottom: 4 };
const statVal: React.CSSProperties = { fontSize: 26, fontWeight: 700, color: "#fff" };
const backBtn: React.CSSProperties = {
  padding: "12px", borderRadius: 10, background: "#f0a500",
  color: "#000", fontWeight: 700, fontSize: 15, border: "none",
  cursor: "pointer", width: "100%",
};
