import { useEffect, useRef, useState } from "react";
import BackButton from "../components/BackButton";

interface Props { onBack: () => void; }
type Tab = "logs" | "users" | "transactions";

const API = "http://localhost:4000";
const WS_URL = "ws://localhost:4000";

interface User {
  rfid: string; name: string; studentId: string;
  credits: number; created_at: string;
}
interface Transaction {
  id: number; rfid: string; type: string; size?: string;
  height_mm?: number; weight_g?: number; credits: number; created_at: string;
}

export default function AdminScreen({ onBack }: Props) {
  const [verified, setVerified]     = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [pulse, setPulse]           = useState(false);
  const [tab, setTab]               = useState<Tab>("logs");
  const [users, setUsers]           = useState<User[]>([]);
  const [txns, setTxns]             = useState<Transaction[]>([]);
  const [loading, setLoading]       = useState(false);
  const [addCredits, setAddCredits] = useState<{ rfid: string; name: string } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditMsg, setCreditMsg]   = useState("");
 const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // pulse animation for RFID waiting
  useEffect(() => {
    pulseRef.current = setInterval(() => setPulse(p => !p), 900);
    return () => { if (pulseRef.current) clearInterval(pulseRef.current); };
  }, []);

  // set mode to admin while on this screen
  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

 const [retryKey, setRetryKey] = useState(0); 

useEffect(() => {
  if (verified) return;
  const ws = new WebSocket(WS_URL);
 ws.onmessage = async (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (
      msg.type === "state" &&
      msg.session?.rfid &&
      msg.session.step === "identified" &&
      msg.session.sessionId > 0  // ← sessionId instead of timestamp
    ) {
      const tappedRfid = msg.session.rfid;
      ws.close();
      const res = await fetch(`${API}/api/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid: tappedRfid }),
      });
      if (res.ok) {
        setVerified(true);
        setVerifyError("");
      } else {
        setVerifyError("Access denied. Not an admin card.");
        setTimeout(() => {
          setVerifyError("");
          setRetryKey(k => k + 1);
        }, 3000);
      }
    }
  } catch {}
};
return () => {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
};
}, [verified, retryKey]); // retryKey forces a fresh WebSocket on each retry

  useEffect(() => {
    if (verified) fetchData();
  }, [verified, tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "users" || tab === "logs") {
        const r = await fetch(`${API}/api/admin/users`);
        setUsers(await r.json());
      }
      if (tab === "transactions" || tab === "logs") {
        const r = await fetch(`${API}/api/admin/transactions`);
        setTxns(await r.json());
      }
    } catch {}
    setLoading(false);
  };

  const handleResetCredits = async (rfid: string) => {
    await fetch(`${API}/api/admin/user/${rfid}/reset-credits`, { method: "POST" });
    fetchData();
  };

  const handleDeleteUser = async (rfid: string) => {
    await fetch(`${API}/api/admin/user/${rfid}`, { method: "DELETE" });
    fetchData();
  };

  const handleAddCredits = async () => {
    if (!addCredits) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      setCreditMsg("Enter a valid number.");
      return;
    }
    const res = await fetch(`${API}/api/admin/user/${addCredits.rfid}/add-credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (data.success) {
      setCreditMsg(`✅ Added ${amount} credits. New total: ${data.credits}`);
      fetchData();
      setTimeout(() => {
        setAddCredits(null);
        setCreditAmount("");
        setCreditMsg("");
      }, 2000);
    } else {
      setCreditMsg(`❌ ${data.error}`);
    }
  };

  // ── RFID verification screen ───────────────────────────────────────────────
  if (!verified) {
    return (
      <div style={fullScreen}>
        <BackButton onBack={onBack} />
        <div style={headerBar}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={headerTitle}>Admin Access</div>
            <div style={headerSub}>Tap admin RFID card to authenticate</div>
          </div>
        </div>
        <div style={body}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%",
              border: `3px solid ${verifyError ? "#e74c3c" : "#f0a500"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 44,
              opacity: pulse ? 1 : 0.4,
              transition: "opacity 0.4s",
              boxShadow: pulse ? `0 0 24px ${verifyError ? "#e74c3c55" : "#f0a50055"}` : "none",
            }}>
              🔒
            </div>
            <div>
              <div style={{ fontSize: 18, color: verifyError ? "#e74c3c" : "#f0a500", fontWeight: 600 }}>
                {verifyError || "Tap your admin card"}
              </div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
                Only authorized admin cards can access this panel
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Admin panel (after verified) ───────────────────────────────────────────
  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={headerBar}>
        <span style={{ fontSize: 22 }}>🔒</span>
        <div>
          <div style={headerTitle}>Admin Panel</div>
          <div style={headerSub}>Manage users, view logs and transactions</div>
        </div>
        <button onClick={fetchData} style={refreshBtn}>↻ Refresh</button>
      </div>

      {/* tabs */}
      <div style={tabBar}>
        {([["logs", "📋 Activity Logs"], ["users", "👥 Manage Users"], ["transactions", "📊 Transactions"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtn,
            color: tab === t ? "#f0a500" : "#666",
            borderBottom: tab === t ? "2px solid #f0a500" : "2px solid transparent",
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={body}>
        {loading && <div style={{ color: "#666", fontSize: 14 }}>Loading...</div>}

        {/* LOGS TAB */}
        {!loading && tab === "logs" && (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>{["Time", "RFID", "Type", "Detail", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {txns.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No activity yet</td></tr>}
                {txns.map(t => (
                  <tr key={t.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                    <td style={td}>{new Date(t.created_at).toLocaleString()}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{t.rfid}</td>
                    <td style={td}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 20, fontSize: 11,
                        background: t.type === "deposit" ? "#1a3a2a" : t.type === "admin_credit" ? "#1a2a3a" : "#1a1a3a",
                        color: t.type === "deposit" ? "#2ecc71" : t.type === "admin_credit" ? "#3498db" : "#e74c3c",
                      }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={td}>{t.type === "deposit" ? `${t.size ?? "—"} · ${t.height_mm ?? "—"}mm · ${t.weight_g ?? "—"}g` : "—"}</td>
                    <td style={{ ...td, color: t.type === "print" ? "#e74c3c" : "#2ecc71", fontWeight: 700 }}>
                      {t.type === "print" ? `-${t.credits}` : `+${t.credits}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* USERS TAB */}
        {!loading && tab === "users" && (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>{["Name", "Student ID", "RFID", "Credits", "Registered", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#555" }}>No users yet</td></tr>}
                {users.map(u => (
                  <tr key={u.rfid} style={{ borderBottom: "1px solid #2a2a2a" }}>
                    <td style={td}>{u.name}</td>
                    <td style={td}>{u.studentId || <span style={{ color: "#444" }}>—</span>}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{u.rfid}</td>
                    <td style={{ ...td, color: "#f0a500", fontWeight: 700 }}>{u.credits}</td>
                    <td style={{ ...td, fontSize: 11, color: "#555" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => { setAddCredits({ rfid: u.rfid, name: u.name }); setCreditAmount(""); setCreditMsg(""); }}
                          style={actionBtn("#1a2a3a", "#3498db")}
                        >
                          + Credits
                        </button>
                        <button onClick={() => handleResetCredits(u.rfid)} style={actionBtn("#333", "#aaa")}>Reset</button>
                        <button onClick={() => handleDeleteUser(u.rfid)} style={actionBtn("#3a1a1a", "#e74c3c")}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {!loading && tab === "transactions" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Total users",       val: users.length,                                          color: "#fff" },
                { label: "Bottles deposited", val: txns.filter(t => t.type === "deposit").length,         color: "#2ecc71" },
                { label: "Print jobs",        val: txns.filter(t => t.type === "print").length,           color: "#3498db" },
                { label: "Credits earned",    val: txns.filter(t => t.type !== "print").reduce((a, t) => a + t.credits, 0), color: "#f0a500" },
              ].map(s => (
                <div key={s.label} style={statCard}>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>{["#", "Time", "RFID", "Type", "Size", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {txns.map(t => (
                    <tr key={t.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={{ ...td, color: "#555" }}>{t.id}</td>
                      <td style={td}>{new Date(t.created_at).toLocaleString()}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>{t.rfid}</td>
                      <td style={td}>{t.type}</td>
                      <td style={td}>{t.size ?? "—"}</td>
                      <td style={{ ...td, color: t.type === "print" ? "#e74c3c" : "#2ecc71", fontWeight: 700 }}>
                        {t.type === "print" ? `-${t.credits}` : `+${t.credits}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add credits modal */}
      {addCredits && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Add Credits</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>{addCredits.name}</div>
            <input
              type="number"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              placeholder="Enter amount"
              min={1}
              style={{
                width: "100%", padding: "12px 14px", background: "#1e1e1e",
                border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
                fontSize: 18, textAlign: "center", outline: "none", marginBottom: 12,
              }}
            />
            {creditMsg && (
              <div style={{ fontSize: 13, color: creditMsg.startsWith("✅") ? "#2ecc71" : "#e74c3c", marginBottom: 12 }}>
                {creditMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setAddCredits(null); setCreditAmount(""); setCreditMsg(""); }} style={ghostBtn}>
                Cancel
              </button>
              <button onClick={handleAddCredits} style={confirmBtn}>
                Add Credits
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: 1024, height: 600, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
};
const headerBar: React.CSSProperties = {
  padding: "12px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const tabBar: React.CSSProperties = { display: "flex", borderBottom: "1px solid #2a2a2a", paddingLeft: 24 };
const tabBtn: React.CSSProperties = {
  padding: "10px 20px", background: "none", border: "none",
  cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "color 0.2s",
};
const body: React.CSSProperties = {
  flex: 1, overflow: "hidden", padding: "16px 24px",
  display: "flex", flexDirection: "column",
};
const tableWrap: React.CSSProperties = {
  flex: 1, overflow: "auto", borderRadius: 10, border: "1px solid #2a2a2a",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", color: "#555",
  fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
  background: "#1e1e1e", borderBottom: "1px solid #2a2a2a",
  position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "10px 14px", color: "#ccc", verticalAlign: "middle" };
const actionBtn = (bg: string, color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 6, border: "none",
  background: bg, color, fontSize: 11, cursor: "pointer", fontWeight: 600,
});
const statCard: React.CSSProperties = {
  background: "#242424", border: "1px solid #2a2a2a", borderRadius: 10, padding: "14px 16px",
};
const refreshBtn: React.CSSProperties = {
  marginLeft: "auto", padding: "6px 14px", borderRadius: 8,
  background: "#2a2a2a", border: "1px solid #3a3a3a",
  color: "#aaa", fontSize: 12, cursor: "pointer",
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 340, width: "100%",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 700,
  fontSize: 14, background: "#f0a500", color: "#000",
  border: "none", cursor: "pointer",
};