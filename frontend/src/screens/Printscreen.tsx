import { useState, useRef, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API, WS_URL } from "../config";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

type Step = "rfid" | "qr" | "confirm" | "printing" | "success" | "error";

// Mirrors the backend's parsePageRange logic — used only to compute
// a live, client-side cost preview before the user hits Print.
function countSelectedPages(range: string, total: number): number | null {
  if (range === "all" || range.trim() === "") return total;
  const pages = new Set<number>();
  for (const part of range.split(",").map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const start = parseInt(m[1]);
    const end = m[2] ? parseInt(m[2]) : start;
    if (start < 1 || end < start || end > total) return null;
    for (let i = start; i <= end; i++) pages.add(i);
  }
  return pages.size || null;
}

export default function PrintScreen({ onBack }: Props) {
  const [step, setStep] = useState<Step>("rfid");
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<"bw" | "color">("bw");
  const [pageRange, setPageRange] = useState<"all" | string>("all");
  const [customRange, setCustomRange] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showNoCredit, setShowNoCredit] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [, setJobOutput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "print" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

  // WebSocket listener — waits for the phone's upload to arrive
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "qr-upload" && msg.sessionId === sessionId) {
          setFileName(msg.fileName);
          setPageCount(msg.pageCount ?? 1);
          setColorMode("bw");
          setPageRange("all");
          setCustomRange("");
          setStep("confirm");
        }
      } catch {}
    };
    return () => ws.close();
  }, [sessionId]);

  const handleIdentified = async (u: User) => {
    setUser(u);
    try {
      const res = await fetch(`${API}/api/print/qr-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid: u.rfid }),
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      setQrImage(data.qrImage);
      setStep("qr");
    } catch {
      setErrorMsg("Could not reach backend to generate QR code.");
      setStep("error");
    }
  };

  // NEW — cost now depends on how many pages are actually selected, not the total
  const activeRange = pageRange === "all" ? "all" : customRange;
  const selectedPageCount = countSelectedPages(activeRange, pageCount ?? 1);
  const rangeIsValid = selectedPageCount !== null;
  const creditsPerPage = colorMode === "color" ? 8 : 3;
  const creditCost = (selectedPageCount ?? 0) * creditsPerPage;
  const hasEnough = user && rangeIsValid && user.credits >= creditCost;

  const handleConfirmClick = () => {
    if (!user || pageCount === null || !rangeIsValid) return;
    if (user.credits < creditCost) {
      setShowNoCredit(true);
      return;
    }
    handlePrint();
  };

  const handlePrint = async () => {
    if (!sessionId) return;
    setStep("printing");
    try {
      const res = await fetch(`${API}/api/print/qr-confirm/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colorMode,
          pageRange: pageRange === "all" ? "all" : customRange,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setJobOutput(data.output ?? "");
        setStep("success");
        setShowFeedback(true);
      } else {
        setErrorMsg(data.error ?? "Print failed.");
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

      <div style={header}>
        <span style={{ fontSize: 22 }}>🖨️</span>
        <div>
          <div style={headerTitle}>Print</div>
          <div style={headerSub}>Scan the QR code to send your file</div>
        </div>
      </div>

      <div style={body}>

        {/* STEP 1 — RFID */}
        {step === "rfid" && <RFIDprompt onIdentified={handleIdentified} />}

        {/* STEP 2 — QR code, waiting for phone upload */}
        {step === "qr" && (
          <div style={card}>
            <div style={userBadge}>
              <span style={{ fontSize: 20 }}>👤</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{user?.name}</div>
                <div style={{ fontSize: 12, color: "#f0a500" }}>{user?.credits} credits available</div>
              </div>
            </div>

            <div style={divider} />

            <div style={{ textAlign: "center" }}>
              <p style={label}>Scan this code with your phone</p>
              <p style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
                Connect to the kiosk Wi-Fi if prompted, then upload your file
              </p>
              {qrImage && (
                <div style={{ background: "#fff", padding: 16, borderRadius: 12, display: "inline-block" }}>
                  <img src={qrImage} alt="QR code" style={{ width: 220, height: 220, display: "block" }} />
                </div>
              )}
              <p style={{ fontSize: 12, color: "#666", marginTop: 16 }}>
                Waiting for upload...
              </p>
            </div>
          </div>
        )}

        {/* STEP 3 — Confirm (after phone upload arrives) */}
        {step === "confirm" && (
          <div style={card}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Confirm print job</div>
            </div>

            <div style={infoRow}>
              <span style={infoLabel}>File</span>
              <span style={infoVal}>{fileName}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Pages</span>
              <span style={infoVal}>{pageCount}</span>
            </div>

            <div style={{ ...infoRow, alignItems: "center" }}>
              <span style={infoLabel}>Print type</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setColorMode("bw")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: colorMode === "bw" ? "1.5px solid #f0a500" : "1px solid #3a3a3a",
                    background: colorMode === "bw" ? "#2a2410" : "transparent",
                    color: colorMode === "bw" ? "#f0a500" : "#888",
                    cursor: "pointer",
                  }}
                >
                  B&W · 3/pg
                </button>
                <button
                  onClick={() => setColorMode("color")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: colorMode === "color" ? "1.5px solid #f0a500" : "1px solid #3a3a3a",
                    background: colorMode === "color" ? "#2a2410" : "transparent",
                    color: colorMode === "color" ? "#f0a500" : "#888",
                    cursor: "pointer",
                  }}
                >
                  Color · 8/pg
                </button>
              </div>
            </div>

            {/* NEW — page range picker */}
            <div style={{ ...infoRow, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <span style={infoLabel}>What to print</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPageRange("all")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: pageRange === "all" ? "1.5px solid #f0a500" : "1px solid #3a3a3a",
                    background: pageRange === "all" ? "#2a2410" : "transparent",
                    color: pageRange === "all" ? "#f0a500" : "#888",
                    cursor: "pointer",
                  }}
                >
                  All {pageCount} pages
                </button>
                <button
                  onClick={() => setPageRange("custom")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: pageRange !== "all" ? "1.5px solid #f0a500" : "1px solid #3a3a3a",
                    background: pageRange !== "all" ? "#2a2410" : "transparent",
                    color: pageRange !== "all" ? "#f0a500" : "#888",
                    cursor: "pointer",
                  }}
                >
                  Custom range
                </button>
              </div>

              {pageRange !== "all" && (
                <div>
                  <input
                    value={customRange}
                    onChange={e => setCustomRange(e.target.value)}
                    placeholder={`e.g. 1-3,5 (out of ${pageCount})`}
                    style={{
                      width: "100%", padding: "8px 10px", background: "#1e1e1e",
                      border: `1px solid ${customRange && !rangeIsValid ? "#e74c3c" : "#3a3a3a"}`,
                      borderRadius: 6, color: "#fff", fontSize: 13, outline: "none",
                    }}
                  />
                  {customRange && !rangeIsValid && (
                    <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 4 }}>
                      Invalid range — this document has {pageCount} page(s).
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={infoRow}>
              <span style={infoLabel}>Credits to deduct</span>
              <span style={{ ...infoVal, color: "#e74c3c", fontWeight: 700 }}>{creditCost}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Credits after print</span>
              <span style={{ ...infoVal, color: "#f0a500", fontWeight: 700 }}>{(user?.credits ?? 0) - creditCost}</span>
            </div>
            {!hasEnough && (
              <div style={{ fontSize: 12, color: "#e74c3c", marginTop: 8 }}>
                Not enough credits for this job.
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button onClick={() => setStep("qr")} style={ghostBtn}>Back</button>
              <button onClick={handleConfirmClick} style={primaryBtn(true)}>Print now</button>
            </div>
          </div>
        )}

        {/* STEP 4 — Printing */}
        {step === "printing" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16, animation: "pulse 1s infinite" }}>🖨️</div>
            <div style={{ fontSize: 20, color: "#f0a500", fontWeight: 600 }}>Sending to printer...</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Please wait</div>
          </div>
        )}

        {/* STEP 5 — Success */}
        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, color: "#2ecc71", fontWeight: 700, marginBottom: 8 }}>Print job sent!</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>
              {creditCost} credit{creditCost > 1 ? "s" : ""} deducted — {(user?.credits ?? 0) - creditCost} remaining
            </div>
            <button onClick={onBack} style={primaryBtn(true)}>Back to home</button>
          </div>
        )}

        {/* STEP error */}
        {step === "error" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 20, color: "#e74c3c", fontWeight: 700, marginBottom: 8 }}>Print failed</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>{errorMsg}</div>
            <button onClick={() => setStep("qr")} style={primaryBtn(true)}>Try again</button>
          </div>
        )}
      </div>

      {/* Not enough credits popup */}
      {showNoCredit && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "#e74c3c" }}>Not enough credits</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 6 }}>
              This job needs <strong style={{ color: "#fff" }}>{creditCost} credits</strong>
            </div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>
              You have <strong style={{ color: "#f0a500" }}>{user?.credits} credits</strong>
            </div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
              Deposit {creditCost - (user?.credits ?? 0)} more bottle{creditCost - (user?.credits ?? 0) > 1 ? "s" : ""} to unlock this print job.
            </div>
            <button onClick={() => setShowNoCredit(false)} style={primaryBtn(true)}>OK</button>
          </div>
        </div>
      )}

      {showFeedback && (
        <FeedBackModal
          context="print"
          rfid={user?.rfid}
          onClose={() => setShowFeedback(false)}
        />
      )}
    </div>
  );
}

// ── shared styles ─────────────────────────────────────────────────────────────
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
const card: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "28px 32px", width: "100%", maxWidth: 520,
};
const userBadge: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  background: "#1e1e1e", borderRadius: 10, padding: "10px 16px",
};
const divider: React.CSSProperties = { height: 1, background: "#333", margin: "16px 0" };
const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#ccc" };
const infoRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between",
  borderBottom: "1px solid #2a2a2a", padding: "10px 0",
};
const infoLabel: React.CSSProperties = { fontSize: 13, color: "#666" };
const infoVal: React.CSSProperties = { fontSize: 13, color: "#fff" };
const primaryBtn = (active: boolean): React.CSSProperties => ({
  width: "100%", padding: "13px", borderRadius: 10, fontWeight: 700,
  fontSize: 15, background: active ? "#f0a500" : "#333",
  color: active ? "#000" : "#555", cursor: active ? "pointer" : "not-allowed",
  border: "none", marginTop: 8,
});
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "13px", borderRadius: 10, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "36px 40px", textAlign: "center", maxWidth: 380, width: "100%",
};