import { useState, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import { API } from "../config";
import { CreditCardIcon } from "../components/KioskIcons";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

export default function CheckBalanceScreen({ onBack }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [allTxns, setAllTxns] = useState<any[]>([]);

  // Transfer modal state (Name typing & search)
  const [showTransfer, setShowTransfer] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<any | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferMsg, setTransferMsg] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "balance" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
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
      setAllTxns(data);
      setHistory(data.slice(0, 5));
    } catch {}
  };

  // Search users as you type name/ID
  useEffect(() => {
    if (!searchQuery.trim() || !user) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/user/search?query=${encodeURIComponent(searchQuery)}&senderRfid=${user.rfid}`);
        const data = await res.json();
        setSearchResults(data);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, user]);

  const handleTransfer = async () => {
    if (!user || !selectedRecipient || !transferAmount) return;
    const amount = parseInt(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferMsg("Enter a valid credit amount.");
      return;
    }

    setTransferLoading(true);
    setTransferMsg("");

    try {
      const res = await fetch(`${API}/api/user/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderRfid: user.rfid,
          recipientRfid: selectedRecipient.rfid,
          amount,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser({ ...user, credits: data.newCredits });
        setTransferMsg(`Successfully transferred ${amount} credits to ${selectedRecipient.name}!`);
        setTimeout(() => {
          setShowTransfer(false);
          setSearchQuery("");
          setSelectedRecipient(null);
          setTransferAmount("");
          setTransferMsg("");
          handleIdentified(user);
        }, 2000);
      } else {
        setTransferMsg(`${data.error ?? "Transfer failed."}`);
      }
    } catch {
      setTransferMsg("Could not reach backend.");
    }
    setTransferLoading(false);
  };

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><CreditCardIcon size={22} color="#f0a500" /></span>
        <div>
          <div style={headerTitle}>Check Balance</div>
          <div style={headerSub}>View your print credits & recycling history</div>
        </div>
      </div>

      <div style={body}>
        {!user ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 400 }}>
            <RFIDprompt onIdentified={handleIdentified} />
            
            {/* DEV BYPASS BUTTON FOR TESTING */}
            <button
              onClick={() => handleIdentified({
                rfid: "TEST_RFID_123",
                name: "Test Student (Dev)",
                studentId: "2026-0001",
                credits: 50
              })}
              style={{
                padding: "10px 16px", borderRadius: 8, background: "#222",
                border: "1px dashed #f0a500", color: "#f0a500", fontSize: 13,
                cursor: "pointer", fontWeight: 600, width: "100%"
              }}
            >
              ⚡ [Dev Bypass] Tap Test User Account
            </button>
          </div>
        ) : (
            <div style={scrollWrap}>

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

              {/* Action buttons (Transfer Credits) */}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => { setShowTransfer(true); setTransferMsg(""); setSearchQuery(""); setSelectedRecipient(null); setTransferAmount(""); }}
                  style={{
                    flex: 1, padding: "12px", borderRadius: 10, background: "#2a2a2a",
                    border: "1px solid #3a3a3a", color: "#f0a500", fontWeight: 700, fontSize: 14, cursor: "pointer"
                  }}
                >
                   Transfer Credits to Another User
                </button>
              </div>

              {/* credit & impact info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={statCard}>
                  <div style={statLabel}>Bottles deposited</div>
                  <div style={statVal}>{allTxns.filter(h => h.type === "deposit").length}</div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>Plastic Deposited</div>
                  <div style={{ ...statVal, fontSize: 20, color: "#2ecc71" }}>
                    {(allTxns.filter(h => h.type === "deposit").reduce((a, h) => a + (h.weight_g ?? 0), 0) / 1000).toFixed(2)} kg
                  </div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>Print jobs done</div>
                  <div style={statVal}>{allTxns.filter(h => h.type === "print").length}</div>
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
                          {h.type === "deposit" && `♻️ Bottle deposited (${h.size ?? "—"}, ${h.weight_g ?? 0}g)`}
                          {h.type === "print" && `🖨️ Print job voucher`}
                          {h.type === "transfer_out" && `Transferred credits`}
                          {h.type === "transfer_in" && `Received credits`}
                        </div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{new Date(h.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{ fontWeight: 700, color: h.type === "deposit" || h.type === "transfer_in" ? "#2ecc71" : "#e74c3c", fontSize: 14 }}>
                        {h.type === "deposit" || h.type === "transfer_in" ? `+${h.credits}` : `-${h.credits}`}
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

      {/* Transfer Credits Modal (Name Search Typing) */}
      {showTransfer && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontSize: 36, marginBottom: 12 }}></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Transfer Credits</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>Type recipient's name or student ID</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Find Recipient</div>
                {selectedRecipient ? (
                  <div style={{ 
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", background: "#1e3a2a", border: "1px solid #2ecc71", borderRadius: 8 
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{selectedRecipient.name}</div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>ID: {selectedRecipient.studentId || "None"} · Balance: {selectedRecipient.credits}</div>
                    </div>
                    <button 
                      onClick={() => { setSelectedRecipient(null); setSearchQuery(""); }} 
                      style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 700 }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Type name or student ID..."
                      style={inputStyle}
                      autoFocus
                    />
                    {searchResults.length > 0 && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, background: "#222",
                        border: "1px solid #444", borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 150, overflowY: "auto"
                      }}>
                        {searchResults.map(r => (
                          <div
                            key={r.rfid}
                            onClick={() => { setSelectedRecipient(r); setSearchResults([]); }}
                            style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #333", fontSize: 13 }}
                          >
                            <div style={{ fontWeight: 700, color: "#fff" }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>ID: {r.studentId || "None"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedRecipient && (
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>Amount to Transfer</div>
                  <input
                    type="number"
                    value={transferAmount}
                    onChange={e => setTransferAmount(e.target.value)}
                    placeholder="Enter credit amount"
                    min={1}
                    max={user?.credits ?? 0}
                    style={inputStyle}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {transferMsg && (
              <div style={{ fontSize: 13, color: transferMsg.startsWith("Successfully") ? "#2ecc71" : "#e74c3c", marginTop: 12 }}>
                {transferMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowTransfer(false)} style={ghostBtn}>Cancel</button>
              <button onClick={handleTransfer} disabled={transferLoading || !selectedRecipient || !transferAmount} style={confirmBtn}>
                {transferLoading ? "Sending..." : "Confirm Transfer"}
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
const header: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const body: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
  overflow: "hidden",
};
const scrollWrap: React.CSSProperties = {
  width: "100%", maxWidth: 580, maxHeight: 520, overflowY: "auto",
  display: "flex", flexDirection: "column", gap: 16,
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
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 380, width: "100%",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "#1e1e1e",
  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
  fontSize: 15, outline: "none", boxSizing: "border-box",
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