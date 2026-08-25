import { useState, useRef, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API, WS_URL } from "../config";
import {
  PrintIcon,
  CreditCardIcon,
  CreditCardOffIcon,
  AccountCircleIcon,
} from "../components/KioskIcons";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

type Step = "choice" | "rfid" | "qr" | "confirm" | "guest-deposit" | "printing" | "success" | "error";
type PaperSize = "A4" | "Letter" | "Long";

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

const STEP_ICONS: Record<string, string> = {
  ir: "📡", capacitive: "🔎", tof: "📏", loadcell: "⚖️",
};
const STATUS_COLOR: Record<SensorStepStatus, string> = {
  pending: "#3a3a3a", running: "#f0a500", pass: "#2ecc71", fail: "#e74c3c",
};

// Paper size options
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
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<"bw" | "color">("bw");
  const [paperSize, setPaperSize] = useState<PaperSize>("Letter"); // Defaulting to Short
  const [pageRange, setPageRange] = useState<"all" | string>("all");
  const [customRange, setCustomRange] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [, setJobOutput] = useState("");
  const [kioskSession, setKioskSession] = useState<KioskSession | null>(null);
  const [invoice, setInvoice] = useState<any | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<"rfid" | "guest" | null>(null);
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
        setStep("confirm");
        if (paymentChoice === "rfid") {
          try {
            const r = await fetch(`${API}/api/user/${u.rfid}`);
            const userData = await r.json();
            setUser(userData);
          } catch {}
          handlePrint();
        }
        return;
      }
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
      setErrorMsg("Could not reach backend to generate or attach QR session.");
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
        setStep("confirm");
        return;
      }
      const statusRes = await fetch(`${API}/api/deposit/guest-status`);
      const status = await statusRes.json();
      const guestUser: User = { rfid: "GUEST", name: "Guest", studentId: "", credits: status.credits ?? 0 };
      setUser(guestUser);
      const res = await fetch(`${API}/api/print/qr-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid: "GUEST" }),
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

  const activeRange = pageRange === "all" ? "all" : customRange;
  const selectedPageCount = countSelectedPages(activeRange, pageCount ?? 1);
  const rangeIsValid = selectedPageCount !== null;
  const creditsPerPage = colorMode === "color" ? 8 : 3;
  const creditCost = (selectedPageCount ?? 0) * creditsPerPage;
  const hasEnough = user && rangeIsValid && user.credits >= creditCost;

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
          pageRange: pageRange === "all" ? "all" : customRange,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setJobOutput(data.output ?? "");
        setInvoice({
          creditsCharged: data.creditsCharged ?? creditCost,
          pagesPrinted: data.pagesPrinted ?? selectedPageCount,
          colorMode: data.colorMode ?? colorMode,
          paperSize: data.paperSize ?? paperSize,
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

  // ── SECRET BYPASS FUNCTION ────────────────────────────────────────────────
  const handleBypassPrint = () => {
    setJobOutput("Bypass simulated print");
    setInvoice({
      creditsCharged: creditCost || 3, // Default to 3 if cost is 0
      pagesPrinted: selectedPageCount || 1, 
      colorMode: colorMode,
      paperSize: paperSize,
      output: "Simulated bypass (Printer skipped)",
    });
    setStep("success");
    setShowFeedback(true);
  };
  // ──────────────────────────────────────────────────────────────────────────

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskSession, step, creditCost]);

  const cancelGuestDeposit = async () => {
    await fetch(`${API}/api/deposit/guest-stop`, { method: "POST" });
    setStep("confirm");
  };

  // ── toggle button style helper ────────────────────────────────────────────
  const toggleBtn = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    border: active ? "1.5px solid #f0a500" : "1px solid #3a3a3a",
    background: active ? "#2a2410" : "transparent",
    color: active ? "#f0a500" : "#888",
    cursor: "pointer",
  });

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><PrintIcon size={24} color="#f0a500" /></span>
        <div>
          {/* SECRETY BYPASS: Double-click this "Print" title to jump to the invoice */}
          <div 
            style={{ ...headerTitle, cursor: "pointer", userSelect: "none" }} 
            onDoubleClick={handleBypassPrint}
          >
            Print
          </div>
          <div style={headerSub}>Scan the QR code to send your file</div>
        </div>
      </div>

      <div style={body}>

        {step === "choice" && (
          <div style={{ textAlign: "center", width: "100%", maxWidth: 760 }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 18 }}>How would you like to print?</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 640, margin: "0 auto" }}>
              <button onClick={() => setStep("rfid")} style={choiceTileStyle}>
                <div style={tileIconWrap}><CreditCardIcon size={28} color="#f0a500" /></div>
                <div style={{ textAlign: "left" }}>
                  <div style={tileLabel}>Tap RFID Card</div>
                  <div style={tileSub}>Use your registered card</div>
                </div>
              </button>
              <button onClick={handleGuestChoice} style={choiceTileStyle}>
                <div style={tileIconWrap}><CreditCardOffIcon size={28} color="#f0a500" /></div>
                <div style={{ textAlign: "left" }}>
                  <div style={tileLabel}>Non-RFID User</div>
                  <div style={tileSub}>Continue as guest</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === "rfid" && <RFIDprompt onIdentified={handleIdentified} />}

        {step === "qr" && (
          <div style={card}>
            {user && (
              <>
                <div style={userBadge}>
                  <span style={{ fontSize: 20 }}>
                    <AccountCircleIcon size={28} color={user.rfid === "GUEST" ? "#888" : "#f0a500"} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{user.name}</div>
                    <div style={{ fontSize: 12, color: "#f0a500" }}>{user.credits} credits available</div>
                  </div>
                </div>
                <div style={divider} />
              </>
            )}
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

        {step === "confirm" && (
          <div style={card}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Confirm print job</div>
            </div>

            {sessionId && (
              <div style={{
                width: "100%", height: 160, marginBottom: 14,
                background: "#fff", borderRadius: 10, overflow: "hidden",
                border: "1px solid #333", flexShrink: 0,
              }}>
                <iframe
                  src={`${API}/api/print/preview/${sessionId}`}
                  title="Print preview"
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              </div>
            )}

            <div style={infoRow}>
              <span style={infoLabel}>File</span>
              <span style={{ ...infoVal, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Pages</span>
              <span style={infoVal}>{pageCount}</span>
            </div>

            {/* Print type — B&W / Color */}
            <div style={{ ...infoRow, alignItems: "center" }}>
              <span style={infoLabel}>Print type</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setColorMode("bw")} style={toggleBtn(colorMode === "bw")}>
                  B&W · 3/pg
                </button>
                <button onClick={() => setColorMode("color")} style={toggleBtn(colorMode === "color")}>
                  Color · 8/pg
                </button>
              </div>
            </div>

            {/* Paper size — Short / A4 / Long */}
            <div style={{ ...infoRow, alignItems: "center" }}>
              <span style={infoLabel}>Paper size</span>
              <div style={{ display: "flex", gap: 8 }}>
                {PAPER_SIZES.map(ps => (
                  <button
                    key={ps.value}
                    onClick={() => setPaperSize(ps.value)}
                    style={toggleBtn(paperSize === ps.value)}
                    title={ps.sub}
                  >
                    {ps.label}
                  </button>
                ))}
              </div>
            </div>

            {/* What to print — all pages / custom range */}
            <div style={{ ...infoRow, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <span style={infoLabel}>What to print</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPageRange("all")} style={toggleBtn(pageRange === "all")}>
                  All {pageCount} pages
                </button>
                <button onClick={() => setPageRange("custom")} style={toggleBtn(pageRange !== "all")}>
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
              <span style={infoLabel}>Total cost</span>
              <span style={{ ...infoVal, color: "#e74c3c", fontWeight: 700 }}>{creditCost} credits</span>
            </div>

            {user && (
              <div style={infoRow}>
                <span style={infoLabel}>{user.rfid === "GUEST" ? "Guest credits" : "Credits after print"}</span>
                <span style={{ ...infoVal, color: "#f0a500", fontWeight: 700 }}>
                  {user.rfid === "GUEST" ? user.credits : user.credits - creditCost}
                </span>
              </div>
            )}

            {user && !hasEnough && (
              <div style={{ fontSize: 12, color: "#e74c3c", marginTop: 6 }}>
                {user.rfid === "GUEST"
                  ? `Not enough credits yet — deposit ${creditCost - user.credits} more credit(s) worth of bottles.`
                  : "Not enough credits for this job."}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setStep("qr")} style={ghostBtn}>Back</button>
              <button
                onClick={() => {
                  setPaymentChoice("rfid");
                  if (user && user.rfid && user.rfid !== "GUEST") {
                    handlePrint();
                  } else {
                    setStep("rfid");
                  }
                }}
                style={primaryBtn(true)}
              >
                Pay with RFID
              </button>
              <button
                onClick={() => {
                  setPaymentChoice("guest");
                  if (user && user.rfid === "GUEST") {
                    if (user.credits < creditCost) startGuestDeposit(); else handlePrint();
                    return;
                  }
                  if (sessionId) {
                    (async () => {
                      try {
                        await fetch(`${API}/api/print/qr-attach/${sessionId}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ rfid: "GUEST" }),
                        });
                        const statusRes = await fetch(`${API}/api/deposit/guest-status`);
                        const status = await statusRes.json();
                        const guestUser: User = { rfid: "GUEST", name: "Guest", studentId: "", credits: status.credits ?? 0 };
                        setUser(guestUser);
                        if (guestUser.credits < creditCost) startGuestDeposit(); else handlePrint();
                      } catch {
                        setErrorMsg("Could not attach guest session.");
                        setStep("error");
                      }
                    })();
                  } else {
                    handleGuestChoice();
                  }
                }}
                style={{ ...primaryBtn(true), background: "#2ecc71", color: "#000" }}
              >
                Non-RFID (Insert bottles)
              </button>
            </div>
          </div>
        )}

        {step === "guest-deposit" && (
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, color: "#f0a500", fontWeight: 700 }}>Insert bottles to pay for this job</div>
              <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>
                Need <strong style={{ color: "#fff" }}>{creditCost}</strong> credits — you have{" "}
                <strong style={{ color: "#2ecc71" }}>{kioskSession?.credits ?? user?.credits ?? 0}</strong>
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
                  <span style={{ fontSize: 22, width: 28, textAlign: "center" }}>{STEP_ICONS[s.id]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                    {s.detail && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{s.detail}</div>}
                  </div>
                  <div style={{ fontSize: 20, width: 24, textAlign: "center" }}>
                    {s.status === "pending" && <span style={{ color: "#444" }}>○</span>}
                    {s.status === "running" && <span style={{ color: "#f0a500" }}>◌</span>}
                    {s.status === "pass"    && <span style={{ color: "#2ecc71" }}>✓</span>}
                    {s.status === "fail"    && <span style={{ color: "#e74c3c" }}>✗</span>}
                  </div>
                </div>
              ))
            )}

            {kioskSession?.step === "gate_open" && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 15, color: "#ccc", fontWeight: 600 }}>Gate open — insert your bottle</div>
              </div>
            )}

            {kioskSession?.step === "idle" && kioskSession?.errorMsg && (
              <div style={{ textAlign: "center", fontSize: 13, color: "#e74c3c", padding: "12px 0" }}>
                {kioskSession.errorMsg}
              </div>
            )}

            <button onClick={cancelGuestDeposit} style={{ ...ghostBtn, width: "100%", marginTop: 16 }}>
              Cancel — back to job summary
            </button>
          </div>
        )}

        {step === "printing" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>
              <PrintIcon size={56} color="#f0a500" />
            </div>
            <div style={{ fontSize: 20, color: "#f0a500", fontWeight: 600 }}>Sending to printer...</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Please wait</div>
          </div>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, color: "#2ecc71", fontWeight: 700, marginBottom: 8 }}>Print job sent!</div>
            {invoice ? (
              <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24, textAlign: "left", maxWidth: 480, margin: "0 auto 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Pages printed</div>
                  <div style={{ fontWeight: 700 }}>{invoice.pagesPrinted}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Color mode</div>
                  <div style={{ fontWeight: 700, textTransform: "uppercase" }}>{invoice.colorMode}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Paper size</div>
                  <div style={{ fontWeight: 700 }}>
                    {invoice.paperSize === "A4" ? "A4" : invoice.paperSize === "Letter" ? "Short (Letter)" : "Long (8.5x13)"}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Credits charged</div>
                  <div style={{ fontWeight: 700, color: "#e74c3c" }}>-{invoice.creditsCharged}</div>
                </div>
                {invoice.output && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>Printer: {invoice.output}</div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>
                {creditCost} credit{creditCost > 1 ? "s" : ""} deducted
              </div>
            )}
            <button onClick={onBack} style={primaryBtn(true)}>Back to home</button>
          </div>
        )}

        {step === "error" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 20, color: "#e74c3c", fontWeight: 700, marginBottom: 8 }}>
              {errorMsg.startsWith("Not enough") ? "Not enough credits" : "Print failed"}
            </div>
            <div style={{ fontSize: 14, color: "#aaa", marginBottom: 24 }}>{errorMsg}</div>
            <button onClick={() => setStep("confirm")} style={primaryBtn(true)}>Back to job summary</button>
          </div>
        )}
      </div>

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
  overflow: "hidden",
};
const card: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "24px 28px", width: "100%", maxWidth: 520,
  maxHeight: 520, overflowY: "auto",
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
  flex: 1, padding: "12px", borderRadius: 10, fontWeight: 700,
  fontSize: 13, background: active ? "#f0a500" : "#333",
  color: active ? "#000" : "#555", cursor: active ? "pointer" : "not-allowed",
  border: "none", marginTop: 8,
});
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "12px", borderRadius: 10, fontWeight: 600,
  fontSize: 13, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};
const choiceTileStyle: React.CSSProperties = {
  background: "#242424", border: "1px solid #333", borderRadius: 14,
  padding: "20px 22px", display: "flex", alignItems: "center",
  gap: 18, cursor: "pointer", textAlign: "left", minHeight: 120,
};
const tileIconWrap: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 12, background: "#1a1a1a",
  border: "1px solid #3a3a3a", display: "flex", alignItems: "center",
  justifyContent: "center", flexShrink: 0,
};
const tileLabel: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 };
const tileSub: React.CSSProperties = { fontSize: 12, color: "#666" };