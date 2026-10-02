import { useState, useRef, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API, WS_URL } from "../config";
import {
  CheckCircleIcon,
  ClockIcon,
  PrintIcon,
  RulerIcon,
  ScaleIcon,
  SearchIcon,
  SignalIcon,
  XCircleIcon,
} from "../components/KioskIcons";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

type Step = "choice" | "rfid" | "qr" | "confirm" | "guest-deposit" | "printing" | "success" | "error";
type PaperSize = "A4" | "Letter" | "Long";
type Layout = "portrait" | "landscape";

type SensorStepStatus = "pending" | "running" | "pass" | "fail";
interface SensorStep { id: string; label: string; status: SensorStepStatus; detail?: string; }
interface KioskSession {
  rfid: string | null;
  step: string;
  steps: SensorStep[];
  credits: number;
  result: "accepted" | "rejected" | null;
  errorMsg: string | null;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  ir: <SignalIcon size={22} />, capacitive: <SearchIcon size={22} />, tof: <RulerIcon size={22} />, loadcell: <ScaleIcon size={22} />,
};
const STATUS_COLOR: Record<SensorStepStatus, string> = {
  pending: "#3a3a3a", running: "#f0a500", pass: "#2ecc71", fail: "#e74c3c",
};

const PAPER_SIZES: { value: PaperSize; label: string; sub: string }[] = [
  { value: "Letter", label: "Short", sub: "8.5 × 11 in" },
  { value: "A4",     label: "A4",    sub: "8.27 × 11.69 in" },
  { value: "Long",   label: "Long",  sub: "8.5 × 13 in" },
];

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
  const [step, setStep] = useState<Step>("qr");
  const [, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [supportsLandscape, setSupportsLandscape] = useState<boolean>(false);
  const [colorMode, setColorMode] = useState<"bw" | "color">("bw");
  const [paperSize, setPaperSize] = useState<PaperSize>("Letter");
  const [layout, setLayout] = useState<Layout>("portrait");
  const [pageRange, setPageRange] = useState<"all" | string>("all");
  const [customRange, setCustomRange] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [kioskSession, setKioskSession] = useState<KioskSession | null>(null);
  const [invoice, setInvoice] = useState<any | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const autoPrintFiredRef = useRef(false);

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

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "qr-upload" && msg.sessionId === sessionId) {
          setFileName(msg.fileName);
          setPageCount(msg.pageCount ?? 1);

          // Determine if file supports landscape (e.g. check if it's not a certificate or portrait-bound document)
          const nameLower = (msg.fileName ?? "").toLowerCase();
          const isPortraitOnly = nameLower.includes("certificate") || nameLower.includes("registration");
          setSupportsLandscape(!isPortraitOnly);
          setLayout("portrait");

          setColorMode("bw");
          setPaperSize("Letter");
          setPageRange("all");
          setCustomRange("");
          setStep("confirm");
        }
        if (msg.type === "state") {
          setKioskSession(msg.session);
        }
      } catch {}
    };
    return () => ws.close();
  }, [sessionId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/print/qr-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        setSessionId(data.sessionId);
        setQrImage(data.qrImage);
        setStep("qr");
      } catch {
        setErrorMsg("Could not reach backend to generate QR code.");
        setStep("error");
      }
    })();
  }, []);

  const handleIdentified = async (u: User) => {
    setUser(u);
    try {
      if (sessionId) {
        await fetch(`${API}/api/print/qr-attach/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rfid: u.rfid }),
        });
        
        try {
          const r = await fetch(`${API}/api/user/${u.rfid}`);
          const userData = await r.json();
          setUser(userData);
        } catch {}

        handlePrint();
        return;
      }
    } catch {
      setErrorMsg("Could not process RFID print payment.");
      setStep("error");
    }
  };

  const handleGuestChoice = async () => {
    try {
      if (sessionId) {
        await fetch(`${API}/api/print/qr-attach/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rfid: "GUEST" }),
        });
        const statusRes = await fetch(`${API}/api/deposit/guest-status`);
        const status = await statusRes.json();
        const guestUser: User = { rfid: "GUEST", name: "Guest", studentId: "", credits: status.credits ?? 0 };
        setUser(guestUser);
        if (guestUser.credits < creditCost) {
          startGuestDeposit();
        } else {
          handlePrint();
        }
        return;
      }
    } catch {
      setErrorMsg("Could not attach guest session.");
      setStep("error");
    }
  };

  const activeRange = pageRange === "all" ? "all" : customRange;
  const selectedPageCount = countSelectedPages(activeRange, pageCount ?? 1);
  const rangeIsValid = selectedPageCount !== null;
  const creditsPerPage = colorMode === "color" ? 8 : 3;
  const creditCost = (selectedPageCount ?? 0) * creditsPerPage;

  const startGuestDeposit = async () => {
    autoPrintFiredRef.current = false;
    try {
      await fetch(`${API}/api/deposit/guest-start`, { method: "POST" });
      setStep("guest-deposit");
    } catch {
      setErrorMsg("Could not start bottle deposit.");
      setStep("error");
    }
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
          paperSize,
          layout: supportsLandscape ? layout : "portrait",
          pageRange: pageRange === "all" ? "all" : customRange,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInvoice({
          creditsCharged: data.creditsCharged ?? creditCost,
          pagesPrinted: data.pagesPrinted ?? selectedPageCount,
          colorMode: data.colorMode ?? colorMode,
          paperSize: data.paperSize ?? paperSize,
          layout: supportsLandscape ? layout : "portrait",
          output: data.output ?? "",
        });
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

  useEffect(() => {
    if (step !== "guest-deposit" || !kioskSession) return;
    if (autoPrintFiredRef.current) return;
    if (kioskSession.credits >= creditCost) {
      autoPrintFiredRef.current = true;
      (async () => {
        await fetch(`${API}/api/deposit/guest-stop`, { method: "POST" });
        setUser(u => (u ? { ...u, credits: kioskSession.credits } : u));
        handlePrint();
      })();
    }
  }, [kioskSession, step, creditCost]);

  const cancelGuestDeposit = async () => {
    await fetch(`${API}/api/deposit/guest-stop`, { method: "POST" });
    setStep("confirm");
  };

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><PrintIcon size={24} color="#f0a500" /></span>
        <div>
          <div style={headerTitle}>Print</div>
          <div style={headerSub}>Scan the QR code to send your file</div>
        </div>
      </div>

      <div style={body}>
        {step === "qr" && (
          <div style={card}>
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
              <p style={{ fontSize: 12, color: "#666", marginTop: 16 }}>Waiting for upload...</p>
            </div>
          </div>
        )}

        {step === "rfid" && (
          <RFIDprompt 
            onIdentified={handleIdentified} 
            onBack={() => setStep("confirm")} 
          />
        )}

        {step === "confirm" && (
          <div style={splitContainer}>
            {/* Left Column: Live Preview with toolbar/navbars hidden */}
            <div style={previewPane}>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6, fontWeight: 600 }}>
                {selectedPageCount ?? 0} sheet{(selectedPageCount ?? 0) === 1 ? "" : "s"} of paper preview
              </div>
              {sessionId && (
                <div style={previewFrameWrapper}>
                  <iframe
                    src={`${API}/api/print/preview/${sessionId}#toolbar=0&navpanes=0`}
                    title="Print preview"
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "none",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Right Column: Touch-Optimized Settings Pane */}
            <div style={settingsPane}>
              <div style={{ fontSize: 16, fontWeight: 700, textAlign: "center" }}>Print Settings</div>

              <div style={infoRow}>
                <span style={infoLabel}>File</span>
                <span style={{ ...infoVal, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
              </div>

              <div style={{ ...infoRow, alignItems: "center" }}>
                <span style={infoLabel}>Pages</span>
                <select
                  value={pageRange === "all" ? "all" : "custom"}
                  onChange={e => setPageRange(e.target.value === "all" ? "all" : "custom")}
                  style={selectStyle}
                >
                  <option value="all">All ({pageCount})</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>

              {pageRange !== "all" && (
                <div style={{ padding: "4px 0", borderBottom: "1px solid #2a2a2a" }}>
                  <input
                    value={customRange}
                    onChange={e => setCustomRange(e.target.value)}
                    placeholder={`e.g. 1-3,5 (out of ${pageCount})`}
                    style={{
                      width: "100%", padding: "5px 8px", background: "#1e1e1e",
                      border: `1px solid ${customRange && !rangeIsValid ? "#e74c3c" : "#3a3a3a"}`,
                      borderRadius: 6, color: "#fff", fontSize: 12, outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {customRange && !rangeIsValid && (
                    <div style={{ fontSize: 10, color: "#e74c3c", marginTop: 2 }}>
                      Invalid range ({pageCount} pages max).
                    </div>
                  )}
                </div>
              )}

              {/* Conditional Layout Row: Only appears if supportsLandscape is true */}
              {supportsLandscape && (
                <div style={{ ...infoRow, alignItems: "center" }}>
                  <span style={infoLabel}>Layout</span>
                  <select
                    value={layout}
                    onChange={e => setLayout(e.target.value as Layout)}
                    style={selectStyle}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              )}

              <div style={{ ...infoRow, alignItems: "center" }}>
                <span style={infoLabel}>Paper size</span>
                <select
                  value={paperSize}
                  onChange={e => setPaperSize(e.target.value as PaperSize)}
                  style={selectStyle}
                >
                  {PAPER_SIZES.map(ps => (
                    <option key={ps.value} value={ps.value}>{ps.label} ({ps.sub})</option>
                  ))}
                </select>
              </div>

              <div style={{ ...infoRow, alignItems: "center" }}>
                <span style={infoLabel}>Print type</span>
                <select
                  value={colorMode}
                  onChange={e => setColorMode(e.target.value as "bw" | "color")}
                  style={selectStyle}
                >
                  <option value="bw">B&amp;W · 3/pg</option>
                  <option value="color">Color · 8/pg</option>
                </select>
              </div>

              <div style={{ ...infoRow, borderBottom: "none" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>Total Cost</span>
                <span style={{ fontSize: 15, color: "#e74c3c", fontWeight: 700 }}>{creditCost} credits</span>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep("qr")} style={ghostBtn}>Cancel</button>
                <button
                  onClick={() => setStep("rfid")}
                  style={primaryBtn(rangeIsValid)}
                  disabled={!rangeIsValid}
                >
                  RFID &amp; PIN
                </button>
                <button
                  onClick={handleGuestChoice}
                  style={{ ...primaryBtn(rangeIsValid), background: rangeIsValid ? "#2ecc71" : "#333", color: rangeIsValid ? "#000" : "#555" }}
                  disabled={!rangeIsValid}
                >
                  Non-RFID (Bottles)
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "guest-deposit" && (
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, color: "#f0a500", fontWeight: 700 }}>Insert bottles to pay for this job</div>
              <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>
                Need <strong style={{ color: "#fff" }}>{creditCost}</strong> credits — you have{" "}
                <strong style={{ color: "#2ecc71" }}>{kioskSession?.credits ?? 0}</strong>
              </div>
            </div>

            {["ir", "capacitive", "tof", "loadcell"].includes(kioskSession?.step ?? "") && (
              kioskSession?.steps.map(s => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px", marginBottom: 10,
                  background: "#242424", borderRadius: 10,
                  border: `1.5px solid ${STATUS_COLOR[s.status]}`,
                  transition: "border-color 0.3s",
                }}>
                  <span style={{ display: "flex", width: 28, justifyContent: "center", color: "#f0a500" }}>{STEP_ICONS[s.id]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                    {s.detail && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{s.detail}</div>}
                  </div>
                  <div style={{ display: "flex", width: 24, justifyContent: "center" }}>
                    {s.status === "pending" && <ClockIcon size={20} color="#444" />}
                    {s.status === "running" && <ClockIcon size={20} color="#f0a500" />}
                    {s.status === "pass"    && <CheckCircleIcon size={20} color="#2ecc71" />}
                    {s.status === "fail"    && <XCircleIcon size={20} color="#e74c3c" />}
                  </div>
                </div>
              ))
            )}

            <button onClick={cancelGuestDeposit} style={{ ...ghostBtn, width: "100%", marginTop: 16 }}>
              Cancel — back to job summary
            </button>
          </div>
        )}

        {step === "printing" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}><PrintIcon size={56} color="#f0a500" /></div>
            <div style={{ fontSize: 20, color: "#f0a500", fontWeight: 600 }}>Sending to printer...</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Please wait</div>
          </div>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, color: "#2ecc71", fontWeight: 700, marginBottom: 8 }}>Print job sent!</div>
            {invoice && (
              <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24, textAlign: "left", maxWidth: 480, margin: "0 auto 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Pages printed</div><div style={{ fontWeight: 700 }}>{invoice.pagesPrinted}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Credits charged</div><div style={{ fontWeight: 700, color: "#e74c3c" }}>-{invoice.creditsCharged}</div>
                </div>
              </div>
            )}
            <button onClick={onBack} style={primaryBtn(true)}>Back to home</button>
          </div>
        )}

        {step === "error" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, color: "#e74c3c", fontWeight: 700, marginBottom: 8 }}>Print failed</div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>{errorMsg}</div>
            <button onClick={() => setStep("confirm")} style={primaryBtn(true)}>Back to job summary</button>
          </div>
        )}
      </div>

      {showFeedback && (
        <FeedBackModal context="print" onClose={() => setShowFeedback(false)} />
      )}
    </div>
  );
}

const fullScreen: React.CSSProperties = {
  width: "100%", height: "100%", flex: 1, background: "#1a1a1a",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const header: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid #2a2a2a",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "#fff" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "#555" };
const body: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflow: "hidden",
};
const card: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "24px 28px", width: "100%", maxWidth: 520, maxHeight: "100%", overflowY: "auto", boxSizing: "border-box",
};
const splitContainer: React.CSSProperties = {
  display: "flex", gap: 20, width: "100%", maxWidth: 960, height: "100%", maxHeight: 540, boxSizing: "border-box",
};
const previewPane: React.CSSProperties = {
  flex: 1.2, display: "flex", flexDirection: "column", background: "#242424", border: "1px solid #333", borderRadius: 14, padding: 16, boxSizing: "border-box", overflow: "hidden",
};
const previewFrameWrapper: React.CSSProperties = {
  flex: 1, background: "#fff", borderRadius: 8, overflow: "hidden", border: "1px solid #333", width: "100%",
};
const settingsPane: React.CSSProperties = {
  flex: 1, background: "#242424", border: "1px solid #333", borderRadius: 14, padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#ccc" };
const infoRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", borderBottom: "1px solid #2a2a2a", padding: "6px 0", alignItems: "center",
};
const infoLabel: React.CSSProperties = { fontSize: 12, color: "#666" };
const infoVal: React.CSSProperties = { fontSize: 12, color: "#fff" };
const selectStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: "6px", fontSize: 12, fontWeight: 600,
  background: "#1e1e1e", color: "#fff", border: "1px solid #3a3a3a",
  cursor: "pointer", outline: "none",
};
const primaryBtn = (active: boolean): React.CSSProperties => ({
  flex: 1.2, padding: "12px 6px", borderRadius: 8, fontWeight: 700, fontSize: 12,
  background: active ? "#f0a500" : "#333", color: active ? "#000" : "#555",
  cursor: active ? "pointer" : "not-allowed", border: "none",
  textAlign: "center", whiteSpace: "nowrap",
});
const ghostBtn: React.CSSProperties = {
  flex: 0.8, padding: "12px 6px", borderRadius: 8, fontWeight: 600, fontSize: 12,
  background: "transparent", color: "#aaa", border: "1px solid #3a3a3a", cursor: "pointer",
  textAlign: "center", whiteSpace: "nowrap",
};