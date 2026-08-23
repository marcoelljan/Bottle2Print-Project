import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import { LockPersonIcon, PrintIcon, AccountCircleIcon, ChatIcon, RecyclingIcon } from "../components/KioskIcons";
import { API } from "../config";
interface Props { onBack: () => void; }
type Tab = "logs" | "users" | "transactions" | "feedback";



interface User {
  rfid: string; name: string; studentId: string;
  credits: number; created_at: string;
}
interface Transaction {
  id: number; rfid: string; type: string; size?: string;
  height_mm?: number; weight_g?: number; credits: number; created_at: string;
}
interface Feedback {
  id: number; rfid: string | null; context: string;
  rating: number; comment: string; created_at: string;
}

export default function AdminScreen({ onBack }: Props) {
  const [token, setToken]           = useState<string | null>(null);
  const verified = token !== null;

  // password login state
  const [pwInput, setPwInput]       = useState("");
  const [pwError, setPwError]       = useState("");
  const [pwLoading, setPwLoading]   = useState(false);

  const [tab, setTab]               = useState<Tab>("logs");
  const [users, setUsers]           = useState<User[]>([]);
  const [txns, setTxns]             = useState<Transaction[]>([]);
  const [feedback, setFeedback]     = useState<Feedback[]>([]);
  const [loading, setLoading]       = useState(false);
  const [addCredits, setAddCredits] = useState<{ rfid: string; name: string } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditMsg, setCreditMsg]   = useState("");

  // helper — every admin fetch goes through this so the token is always attached
  const authFetch = (path: string, options: RequestInit = {}) => {
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

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

  const handlePasswordLogin = async () => {
    if (!pwInput) return;
    setPwLoading(true);
    setPwError("");
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwInput }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        setPwInput("");
      } else {
        setPwError(data.error ?? "Incorrect password.");
      }
    } catch {
      setPwError("Could not reach backend.");
    }
    setPwLoading(false);
  };

  useEffect(() => {
    if (verified) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "users" || tab === "logs") {
        const r = await authFetch(`/api/admin/users`);
        setUsers(await r.json());
      }
      if (tab === "transactions" || tab === "logs") {
        const r = await authFetch(`/api/admin/transactions`);
        setTxns(await r.json());
      }
      if (tab === "feedback") {
        const r = await authFetch(`/api/admin/feedback`);
        setFeedback(await r.json());
      }
    } catch {}
    setLoading(false);
  };

  const handleResetCredits = async (rfid: string) => {
    await authFetch(`/api/admin/user/${rfid}/reset-credits`, { method: "POST" });
    fetchData();
  };

  const handleDeleteUser = async (rfid: string) => {
    await authFetch(`/api/admin/user/${rfid}`, { method: "DELETE" });
    fetchData();
  };

  const handleAddCredits = async () => {
    if (!addCredits) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      setCreditMsg("Enter a valid number.");
      return;
    }
    const res = await authFetch(`/api/admin/user/${addCredits.rfid}/add-credits`, {
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

  const handleBack = () => {
    if (!verified) {
      onBack();
      return;
    }
    if (window.confirm("Log out of the admin panel?")) {
      setToken(null);
      setTab("logs");
    }
  };

  // ── login screen ───────────────────────────────────────────────────────────
  if (!verified) {
    return (
      <div style={fullScreen}>
        <BackButton onBack={handleBack} />
        <div style={headerBar}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Admin Access</div>
            <div style={headerSub}>Log in with your admin password</div>
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>

            {/* password login */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Admin password</div>
              <input
                type="password"
                value={pwInput}
                onChange={e => setPwInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handlePasswordLogin(); }}
                placeholder="Enter password"
                style={{
                  width: "100%", padding: "12px 14px", background: "#1e1e1e",
                  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
                  fontSize: 15, outline: "none", boxSizing: "border-box",
                }}
              />
              {pwError && (
                <div style={{ fontSize: 12, color: "#e74c3c" }}>{pwError}</div>
              )}
              <button
                onClick={handlePasswordLogin}
                disabled={!pwInput || pwLoading}
                style={{
                  padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                  border: "none", cursor: !pwInput || pwLoading ? "not-allowed" : "pointer",
                  background: !pwInput || pwLoading ? "#333" : "#f0a500",
                  color: !pwInput || pwLoading ? "#555" : "#000",
                }}
              >
                {pwLoading ? "Checking..." : "Log in"}
              </button>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // ── Admin panel (after verified) ───────────────────────────────────────────
  return (
    <div style={fullScreen}>
      <BackButton onBack={handleBack} />

      <div style={headerBar}>
        <LockPersonIcon size={22} color="#f0a500" />
        <div>
          <div style={headerTitle}>Admin Panel</div>
          <div style={headerSub}>Manage users, view logs and transactions</div>
        </div>
        <button onClick={fetchData} style={refreshBtn}>↻ Refresh</button>
      </div>

      {/* tabs */}
      <div style={tabBar}>
        {([["logs", <><PrintIcon size={15} /> Activity Logs</>], ["users", <><AccountCircleIcon size={15} /> Manage Users</>], ["transactions", <><RecyclingIcon size={15} /> Transactions</>], ["feedback", <><ChatIcon size={15} /> Feedback</>]] as [Tab, React.ReactNode][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtn,
            color: tab === t ? "#f0a500" : "#666",
            borderBottom: tab === t ? "2px solid #f0a500" : "2px solid transparent",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{label}</span>
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

        {/* FEEDBACK TAB */}
        {!loading && tab === "feedback" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                {
                  label: "Total feedback",
                  val: feedback.length,
                  color: "#fff",
                },
                {
                  label: "Average rating",
                  val: feedback.length
                    ? (feedback.reduce((a, f) => a + f.rating, 0) / feedback.length).toFixed(1)
                    : "—",
                  color: "#f0a500",
                },
                {
                  label: "With comments",
                  val: feedback.filter(f => f.comment && f.comment.trim().length > 0).length,
                  color: "#3498db",
                },
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
                  <tr>{["Time", "Context", "Rating", "Comment", "RFID"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {feedback.length === 0 && (
                    <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "#555" }}>No feedback yet</td></tr>
                  )}
                  {feedback.map(f => (
                    <tr key={f.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                      <td style={td}>{new Date(f.created_at).toLocaleString()}</td>
                      <td style={td}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20, fontSize: 11,
                          background: f.context === "deposit" ? "#1a3a2a" : f.context === "print" ? "#1a2a3a" : "#2a2a2a",
                          color: f.context === "deposit" ? "#2ecc71" : f.context === "print" ? "#3498db" : "#aaa",
                        }}>
                          {f.context}
                        </span>
                      </td>
                      <td style={{ ...td, color: "#f0a500", fontWeight: 700, letterSpacing: 1 }}>
                        {"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}
                      </td>
                      <td style={td}>{f.comment ? f.comment : <span style={{ color: "#444" }}>—</span>}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#666" }}>
                        {f.rfid ?? <span style={{ color: "#444" }}>anon</span>}
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
  width: "100%", maxWidth: 1024, minHeight: "100svh", background: "#1a1a1a",
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
const loginBody: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, boxSizing: "border-box",
};
const loginPanel: React.CSSProperties = {
  width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 28,
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