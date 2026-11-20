import { useState, useRef, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import useKioskControls from "../components/useKioskControls";
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
import KioskThemeToggle from "../components/KioskThemeToggle";

interface Props { onBack: () => void; theme: "dark" | "light"; onToggleTheme: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }
interface PrintPricing { bwCreditsPerPage: number; colorCreditsPerPage: number; }

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
  heightMm: number | null;
  weightG: number | null;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  ir: <SignalIcon size={22} />, capacitive: <SearchIcon size={22} />, tof: <RulerIcon size={22} />, loadcell: <ScaleIcon size={22} />,
};
const STATUS_COLOR: Record<SensorStepStatus, string> = {
  pending: "var(--kiosk-border-strong)", running: "var(--kiosk-accent-text)", pass: "var(--kiosk-success-text)", fail: "var(--kiosk-danger-text)",
};

const PAPER_DIMS: Record<PaperSize, { w: number; h: number }> = {
  Letter: { w: 8.5,  h: 11 },
  A4:     { w: 8.27, h: 11.69 },
  Long:   { w: 8.5,  h: 13 },
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

async function fetchPrintPricing(): Promise<PrintPricing> {
  const res = await fetch(`${API}/api/print/pricing`);
  if (!res.ok) throw new Error(`Pricing request failed (${res.status}).`);
  const pricing: PrintPricing = await res.json();
  if (
    !Number.isSafeInteger(pricing.bwCreditsPerPage) || pricing.bwCreditsPerPage < 1 || pricing.bwCreditsPerPage > 1_000_000 ||
    !Number.isSafeInteger(pricing.colorCreditsPerPage) || pricing.colorCreditsPerPage < 1 || pricing.colorCreditsPerPage > 1_000_000
  ) {
    throw new Error("The kiosk received invalid print pricing.");
  }
  return pricing;
}

export default function PrintScreen({ onBack, theme, onToggleTheme }: Props) {
  const [step, setStep] = useState<Step>("qr");
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [supportsLandscape, setSupportsLandscape] = useState<boolean>(false);
  const [colorMode, setColorMode] = useState<"bw" | "color">("bw");
  const [paperSize, setPaperSize] = useState<PaperSize>("Letter");
  const [layout, setLayout] = useState<Layout>("portrait");
  const [pageRange, setPageRange] = useState<"all" | string>("all");
  const [printPricing, setPrintPricing] = useState<PrintPricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState("");
  const [pricingNotice, setPricingNotice] = useState("");
  const [customRange, setCustomRange] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [kioskSession, setKioskSession] = useState<KioskSession | null>(null);
  const [invoice, setInvoice] = useState<any | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const autoPrintFiredRef = useRef(false);
  const printingRef = useRef(false);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const [printHint, setPrintHint] = useState("");
  const [printCancelled, setPrintCancelled] = useState(false);

  // Kiosk controls: { feature: message } for every part the admin switched off
  const off = useKioskControls();
  const printOff = "print" in off;
  const depositOff = "deposit" in off;
  const rfidBlocked = printOff || "rfid" in off;
  const rfidReason = off.print || off.rfid || "Temporarily unavailable.";
  const [guestCredits, setGuestCredits] = useState(0);

  const refreshGuestCredits = async () => {
    try {
      const r = await fetch(`${API}/api/deposit/guest-status`);
      const s = await r.json();
      setGuestCredits(s.credits ?? 0);
    } catch {}
  };

  const refreshPrintPricing = async () => {
    setPricingLoading(true);
    setPricingError("");
    try {
      setPrintPricing(await fetchPrintPricing());
    } catch (error) {
      setPricingError(error instanceof Error ? error.message : "Could not load print pricing.");
    } finally {
      setPricingLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchPrintPricing().then(pricing => {
      if (active) setPrintPricing(pricing);
    }).catch(error => {
      if (active) setPricingError(error instanceof Error ? error.message : "Could not load print pricing.");
    }).finally(() => {
      if (active) setPricingLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step !== "confirm") return;
    let active = true;
    const loadLatestPricing = () => {
      fetchPrintPricing().then(pricing => {
        if (active) {
          setPrintPricing(pricing);
          setPricingError("");
        }
      }).catch(error => {
        if (active) setPricingError(error instanceof Error ? error.message : "Could not load print pricing.");
      });
    };
    loadLatestPricing();
    const interval = setInterval(loadLatestPricing, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step]);

  // credits carried over from the Deposit screen
  useEffect(() => { refreshGuestCredits(); }, []);

  // live updates while the guest is inserting bottles
  useEffect(() => {
    if (kioskSession?.rfid === "GUEST") setGuestCredits(kioskSession.credits ?? 0);
  }, [kioskSession]);

  const isRfidUser = !!user && user.rfid !== "GUEST";
  const isGuestPath = user?.rfid === "GUEST" || step === "guest-deposit";
  const showGuestBadge = !isRfidUser && (guestCredits > 0 || isGuestPath);
  const showLeftover = showGuestBadge && guestCredits > 0;

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

  const createQrSession = async () => {
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
  };

  useEffect(() => { createQrSession(); }, []);

  // Read the guest's banked credits whenever the job summary opens
  useEffect(() => {
    if (step !== "confirm") return;
    (async () => {
      try {
        const r = await fetch(`${API}/api/deposit/guest-status`);
        const s = await r.json();
        setGuestCredits(s.credits ?? 0);
      } catch {}
    })();
  }, [step]);

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
  const creditsPerPage = colorMode === "color"
    ? printPricing?.colorCreditsPerPage ?? 0
    : printPricing?.bwCreditsPerPage ?? 0;
  const creditCost = (selectedPageCount ?? 0) * creditsPerPage;

  const requestedPreviewRange = pageRange === "all" ? "all" : customRange.trim();
  const [previewRange, setPreviewRange] = useState("all");
  useEffect(() => {
    if (requestedPreviewRange !== "all" && !rangeIsValid) return;
    const id = setTimeout(() => setPreviewRange(requestedPreviewRange || "all"), 400);
    return () => clearTimeout(id);
  }, [requestedPreviewRange, rangeIsValid]);
  const previewIsCurrent = rangeIsValid && previewRange === (requestedPreviewRange || "all");

  // Non-RFID is blocked if Print is off, or if Deposit is off and the guest's banked credits can't cover the job
  const guestCanCover = guestCredits >= creditCost && creditCost > 0;
  const guestBlocked = printOff || (depositOff && !guestCanCover);
  const guestReason = printOff
    ? (off.print || "Temporarily unavailable.")
    : (off.deposit || "Temporarily unavailable.") +
      (guestCredits > 0 ? ` (You have ${guestCredits} credits, this job needs ${creditCost}.)` : "");

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

    const waitForPrint = async (jobId: string | null) => {
    setPrintHint("");
    setPrintCancelled(false);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const finish = async () => {
      await sleep(3000);                       // let the last page come out
      if (!aliveRef.current) return;
      setStep("success");
      setShowFeedback(true);
    };
    if (!jobId) { await sleep(6000); return finish(); }   // job id unknown: short wait

    const started = Date.now();
    for (;;) {
      await sleep(2000);
      if (!aliveRef.current) return;
      try {
        const r = await fetch(`${API}/api/print/job/${jobId}`);
        const j = await r.json();
        if (j.state === "done") return finish();
        if (j.state === "cancelled") {
          setPrintCancelled(true);
          setErrorMsg("The print did not finish and was cancelled. Credits were refunded for card users. Check the paper size, then start Print again. Guests: please ask staff.");
          setStep("error");
          return;
        }
        if (j.state === "attention") setPrintHint(j.reason + " Check that the paper size selected matches the paper loaded in the printer.");
        else if (Date.now() - started > 20000) setPrintHint("Taking longer than usual. Check that the paper size selected matches the paper loaded in the printer, or ask staff.");
        else setPrintHint("");
      } catch {}
      if (Date.now() - started > 6 * 60 * 1000) return finish();   // safety stop
    }
  };

  const handlePrint = async () => {
       if (!sessionId || printingRef.current) return;   // ignore a second tap while one print is running
    printingRef.current = true;
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
          pricing: printPricing,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.pricing) {
        setPrintPricing(data.pricing);
        setPricingNotice(data.error ?? "Print pricing changed. Review the updated total.");
        setStep("confirm");
        return;
      }
      if (data.success) {
        refreshGuestCredits();
        setInvoice({
          creditsCharged: data.creditsCharged ?? creditCost,
          pagesPrinted: data.pagesPrinted ?? selectedPageCount,
          colorMode: data.colorMode ?? colorMode,
          paperSize: data.paperSize ?? paperSize,
          layout: supportsLandscape ? layout : "portrait",
          output: data.output ?? "",
        });
        await waitForPrint(data.jobId ?? null);
      } else {
        setErrorMsg(data.error ?? "Print failed.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Could not reach backend.");
      setStep("error");
    } finally { printingRef.current = false; }
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
    <div className="print-screen" style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><PrintIcon size={24} color="#f0a500" /></span>
        <div style={{ width: "max-content", textAlign: "center" }}>
          <div style={headerTitle}>Print</div>
          <div style={headerSub}>Scan the QR code to send your file</div>
        </div>
        {showGuestBadge && (
          <div style={{
            marginLeft: "auto", padding: "6px 14px", borderRadius: 999,
            background: "var(--kiosk-surface)", border: "1.5px solid #f0a500",
            fontSize: 15, color: "var(--kiosk-text-secondary)",
          }}>
            Your credits: <strong style={{ color: "var(--kiosk-accent-text)", fontSize: 16 }}>{guestCredits}</strong>
          </div>
        )}
        <div style={{ marginLeft: showGuestBadge ? 14 : "auto" }}>
          <KioskThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </div>

      <div className="print-screen-body kiosk-page-scroll" style={body}>
        {step === "qr" && (
          <div style={{ ...card, alignSelf: "center", marginBlock: "auto" }}>
            <div style={{ textAlign: "center" }}>
              <p style={label}>Scan this code with your phone</p>
              <p style={{ fontSize: 16, color: "var(--kiosk-muted)", marginBottom: 20 }}>
                Connect to the kiosk Wi-Fi if prompted, then upload your file
              </p>
              {qrImage && (
                <div style={{ background: "var(--kiosk-text)", padding: 18, borderRadius: 12, display: "inline-block" }}>
                  <img src={qrImage} alt="QR code" style={{ width: 250, height: 250, display: "block" }} />
                </div>
              )}
              <p style={{ fontSize: 15, color: "var(--kiosk-muted)", marginTop: 18 }}>Waiting for upload...</p>
            </div>
          </div>
        )}

        {step === "rfid" && (
          <div className="rfid-prompt-stage">
            <RFIDprompt
              onIdentified={handleIdentified}
              onBack={() => setStep("confirm")}
            />
          </div>
        )}

        {step === "confirm" && (
          <div className="print-split-container" style={splitContainer}>
            {/* Left Column: Live Preview with toolbar/navbars hidden */}
            <div className="print-preview-pane" style={previewPane}>
              <div style={{ fontSize: 16, color: "var(--kiosk-text-secondary)", marginBottom: 8, fontWeight: 600 }}>
                {!rangeIsValid
                  ? "Preview paused — enter a valid page range"
                  : !previewIsCurrent
                    ? "Updating page preview..."
                    : `${selectedPageCount} sheet${selectedPageCount === 1 ? "" : "s"} of paper preview`}
              </div>
              {sessionId && (() => {
  const isLandscape = supportsLandscape && layout === "landscape";
  const dims = PAPER_DIMS[paperSize];
  const pw = isLandscape ? dims.h : dims.w;   // paper width as shown
  const ph = isLandscape ? dims.w : dims.h;   // paper height as shown
  const ratio = pw / ph;

  return (
    // Outer box: takes all free space in the preview pane
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        containerType: "size",
      } as React.CSSProperties}
    >
      {/* Paper: the biggest box with the paper's shape that fits the outer box */}
      <div
        style={{
          width: `min(100cqw, ${100 * ratio}cqh)`,
          height: `min(100cqh, ${100 / ratio}cqw)`,
          background: "var(--kiosk-text)",
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid var(--kiosk-border)",
          position: "relative",
          containerType: "size",
          filter: colorMode === "bw" ? "grayscale(1)" : "none",
          transition: "filter 0.25s",
        } as React.CSSProperties}
      >
{previewIsCurrent ? (
  <iframe
    key={previewRange}
    src={`${API}/api/print/preview/${sessionId}?pages=${encodeURIComponent(previewRange)}#toolbar=0&navpanes=0`}
    title="Print preview"
    style={
      isLandscape
        ? {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "100cqh",
            height: "100cqw",
            transform: "translate(-50%, -50%) rotate(90deg)",
            border: "none",
          }
        : { width: "100%", height: "100%", border: "none" }
    }
  />
) : (
  <div style={previewStatus}>
    {!rangeIsValid
      ? "The page range is invalid. Correct it to see the matching preview."
      : "Updating the preview to match your page selection..."}
  </div>
)}
      </div>
    </div>
  );
})()}
            </div>

            {/* Right Column: Touch-Optimized Settings Pane */}
            <div className="print-settings-pane" style={settingsPane}>
              <div style={{ fontSize: 20, fontWeight: 700, textAlign: "center" }}>Print Settings</div>

              <div style={infoRow}>
                <span style={infoLabel}>File</span>
                <span style={{ ...infoVal, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
              </div>

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
              <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--kiosk-accent-text)", background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)", borderRadius: 6, padding: "10px 12px" }}>
                Select the same paper size that is loaded in the printer. A different size will not print.
              </div>

                            <div style={{ ...infoRow, alignItems: "center" }}>
                <span style={infoLabel}>Pages</span>
                <select
                  value={pageRange === "all" ? "all" : "custom"}
                  onChange={e => setPageRange(e.target.value === "all" ? "all" : "custom")}
                  style={selectStyle}
                >
                  <option value="all">All pages ({pageCount})</option>
                  <option value="custom">Select pages</option>
                </select>
              </div>

              {pageRange !== "all" && (
                <div style={{ padding: "4px 0", borderBottom: "1px solid var(--kiosk-surface-hover)" }}>
                  <input
                    value={customRange}
                    onChange={e => setCustomRange(e.target.value)}
                    placeholder={`e.g. 1-3,5 (out of ${pageCount})`}
                    style={{
                      width: "100%", padding: "10px 12px", background: "var(--kiosk-input)",
                      border: `1px solid ${customRange && !rangeIsValid ? "#e74c3c" : "var(--kiosk-border-strong)"}`,
                      borderRadius: 6, color: "var(--kiosk-text)", fontSize: 16, outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {customRange && !rangeIsValid && (
                    <div style={{ fontSize: 13, color: "var(--kiosk-danger-text)", marginTop: 4 }}>
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
                <span style={infoLabel}>Print type</span>
                <select
                  value={colorMode}
                  onChange={e => setColorMode(e.target.value as "bw" | "color")}
                  style={selectStyle}
                  disabled={!printPricing || pricingLoading}
                >
                  <option value="bw">B&amp;W · {printPricing?.bwCreditsPerPage ?? "—"}/pg</option>
                  <option value="color">Color · {printPricing?.colorCreditsPerPage ?? "—"}/pg</option>
                </select>
              </div>

              <div style={{ ...infoRow, borderBottom: "none" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--kiosk-text-secondary)" }}>Total Cost</span>
                <span style={{ fontSize: 19, color: "var(--kiosk-danger-text)", fontWeight: 700 }}>
                  {pricingLoading ? "Loading..." : printPricing && !pricingError ? `${creditCost} credits` : "Unavailable"}
                </span>
              </div>

              {pricingError && (
                <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--kiosk-danger-text)", background: "var(--kiosk-danger-bg)", border: "1px solid var(--kiosk-danger-border)", borderRadius: 6, padding: "10px 12px" }}>
                  Could not confirm print pricing. Printing is disabled until the rates load.
                  <button onClick={() => void refreshPrintPricing()} style={{ ...ghostBtn, marginLeft: 8, padding: "4px 8px" }}>Retry</button>
                </div>
              )}
              {pricingNotice && (
                <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--kiosk-accent-text)", background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)", borderRadius: 6, padding: "10px 12px" }}>
                  {pricingNotice}
                </div>
              )}

              {(rfidBlocked || guestBlocked) && (
                <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--kiosk-accent-text)", background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)", borderRadius: 6, padding: "10px 12px" }}>
                  {rfidBlocked && <div><strong>RFID &amp; PIN:</strong> {rfidReason}</div>}
                  {guestBlocked && <div><strong>Non-RFID (Bottles):</strong> {guestReason}</div>}
                </div>
              )}

              <div className="print-settings-actions" style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setStep("qr")} style={ghostBtn}>Cancel</button>
                <button
                  onClick={async () => {
                    if (rfidBlocked) return;
                    try {
                      await fetch(`${API}/api/mode`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mode: "print" }),
                      });
                    } catch {}
                    setStep("rfid");
                  }}
                  style={primaryBtn(rangeIsValid && !rfidBlocked)}
                  disabled={!rangeIsValid || rfidBlocked || !printPricing || pricingLoading || !!pricingError}
                  title={rfidBlocked ? rfidReason : undefined}
                >
                  {rfidBlocked ? "RFID & PIN (unavailable)" : "RFID & PIN"}
                </button>
                <button
                  onClick={() => { if (!guestBlocked) handleGuestChoice(); }}
                  style={{
                    ...primaryBtn(rangeIsValid && !guestBlocked),
                    background: rangeIsValid && !guestBlocked ? "#2ecc71" : "var(--kiosk-border)",
                    color: rangeIsValid && !guestBlocked ? "#000" : "var(--kiosk-muted-dim)",
                  }}
                  disabled={!rangeIsValid || guestBlocked || !printPricing || pricingLoading || !!pricingError}
                  title={guestBlocked ? guestReason : undefined}
                >
                  {guestBlocked ? "Non-RFID (unavailable)" : "Non-RFID (Bottles)"}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "guest-deposit" && (
          <div style={{ width: "100%", maxWidth: 560 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, color: "var(--kiosk-accent-text)", fontWeight: 700 }}>
                {kioskSession?.step === "ir" && kioskSession.steps[0]?.status === "pending"
                  ? "Ready for a bottle"
                  : "Insert bottles to pay for this job"}
              </div>
              {kioskSession?.step === "ir" && kioskSession.steps[0]?.status === "pending" && (
                <div style={{ fontSize: 15, color: "var(--kiosk-text-secondary)", marginTop: 6 }}>Insert your bottle now.</div>
              )}
              <div style={{ fontSize: 15, color: "var(--kiosk-text-secondary)", marginTop: 6 }}>
                Need <strong style={{ color: "var(--kiosk-text)" }}>{creditCost}</strong> credits — you have{" "}
                <strong style={{ color: "var(--kiosk-success-text)" }}>{kioskSession?.credits ?? 0}</strong>
              </div>
              {kioskSession?.step === "result" && kioskSession.result === "accepted" && (
                <div style={{ fontSize: 14, color: "var(--kiosk-accent-text)", marginTop: 10 }}>
                  Bottle accepted. Please wait until the gate finishes moving before inserting another bottle.
                </div>
              )}
            </div>

            {["ir", "capacitive", "tof", "loadcell", "storing"].includes(kioskSession?.step ?? "") && (
              kioskSession?.steps.map(s => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px", marginBottom: 10,
                  background: "var(--kiosk-surface)", borderRadius: 10,
                  border: `1.5px solid ${STATUS_COLOR[s.status]}`,
                  transition: "border-color 0.3s",
                }}>
                  <span style={{ display: "flex", width: 28, justifyContent: "center", color: "var(--kiosk-accent-text)" }}>{STEP_ICONS[s.id]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                    {s.detail && <div style={{ fontSize: 14, color: "var(--kiosk-text-secondary)", marginTop: 4 }}>{s.detail}</div>}
                  </div>
                  <div style={{ display: "flex", width: 24, justifyContent: "center" }}>
                    {s.status === "pending" && <ClockIcon size={20} color="var(--kiosk-muted-faint)" />}
                    {s.status === "running" && <ClockIcon size={20} color="#f0a500" />}
                    {s.status === "pass"    && <CheckCircleIcon size={20} color="#2ecc71" />}
                    {s.status === "fail"    && <XCircleIcon size={20} color="#e74c3c" />}
                  </div>
                </div>
              ))
            )}

            {kioskSession?.step === "result" && kioskSession.result === "rejected" && (
              <div
                style={{ textAlign: "center", padding: "16px 12px", background: "var(--kiosk-surface)", border: "1.5px solid #e74c3c", borderRadius: 10 }}
              >
                <div style={{ color: "var(--kiosk-danger-text)", fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Bottle rejected</div>
                <div style={{ fontSize: 15, color: "var(--kiosk-text-secondary)" }}>{kioskSession.errorMsg}</div>
                {!!(kioskSession.heightMm || kioskSession.weightG) && (
                  <div style={{ fontSize: 15, color: "var(--kiosk-accent-text)", marginTop: 10 }}>
                   {kioskSession.heightMm ? `Height ${(kioskSession.heightMm / 10).toFixed(1)} cm` : ""}
                    {kioskSession.heightMm && kioskSession.weightG ? " · " : ""}
                    {kioskSession.weightG ? `Weight ${kioskSession.weightG}g` : ""}
                  </div>
                )}
                <div style={{ fontSize: 14, color: "var(--kiosk-accent-text)", marginTop: 10 }}>
                  Please wait until the gate finishes moving before inserting another bottle.
                </div>
              </div>
            )}

            <button onClick={cancelGuestDeposit} style={{ ...ghostBtn, width: "100%", marginTop: 16 }}>
              Cancel — back to job summary
            </button>
          </div>
        )}

                {step === "printing" && (
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}><PrintIcon size={56} color="#f0a500" /></div>
            <div style={{ fontSize: 20, color: "var(--kiosk-accent-text)", fontWeight: 600 }}>Printing your document...</div>
            <div style={{ fontSize: 14, color: "var(--kiosk-muted)", marginTop: 8 }}>Please wait. Do not leave the kiosk.</div>
            {printHint && (
              <div style={{ fontSize: 15, color: "var(--kiosk-accent-text)", background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)", borderRadius: 8, padding: "10px 14px", marginTop: 18 }}>
                {printHint}
              </div>
            )}
          </div>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, color: "var(--kiosk-success-text)", fontWeight: 700, marginBottom: 8 }}>Print complete!</div>
                        <div style={{ fontSize: 15, color: "var(--kiosk-text-secondary)", marginBottom: 16 }}>
              Collect your pages from the printer. If nothing printed, the selected paper size may not match the paper in the printer. Please ask staff.
            </div>
            {invoice && (
              <div style={{ fontSize: 14, color: "var(--kiosk-muted)", marginBottom: 24, textAlign: "left", maxWidth: 480, margin: "0 auto 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Pages printed</div><div style={{ fontWeight: 700 }}>{invoice.pagesPrinted}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>Credits charged</div><div style={{ fontWeight: 700, color: "var(--kiosk-danger-text)" }}>-{invoice.creditsCharged}</div>
                </div>
              </div>
            )}
            {showLeftover && (
              <div style={{ fontSize: 15, color: "var(--kiosk-accent-text)", marginBottom: 16 }}>
                You have <strong>{guestCredits}</strong> credits left. Print another file to use them.
                Unused credits will be cleared when you press Finish or after a few minutes of inactivity.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {showLeftover && (
                <button
                  onClick={() => {
                    setInvoice(null);
                    setFileName(null);
                    setPageCount(null);
                    setQrImage(null);
                    autoPrintFiredRef.current = false;
                    createQrSession();
                  }}
                  style={primaryBtn(true)}
                >
                  Print another file
                </button>
              )}
              <button
                onClick={async () => {
                  if (showLeftover) {
                    try { await fetch(`${API}/api/deposit/guest-end`, { method: "POST" }); } catch {}
                  }
                  onBack();
                }}
                style={showLeftover ? ghostBtn : primaryBtn(true)}
              >
                {showLeftover ? "Finish" : "Back to home"}
              </button>
            </div>
          </div>
        )}

        {step === "error" && (
          <div style={{ width: "100%", minHeight: "100%", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div style={{ fontSize: 24, color: "var(--kiosk-danger-text)", fontWeight: 700, marginBottom: 10 }}>Print failed</div>
            <div style={{ fontSize: 17, color: "var(--kiosk-muted)", marginBottom: 24, maxWidth: 560 }}>{errorMsg}</div>
            <button onClick={() => (printCancelled ? onBack() : setStep("confirm"))} style={primaryBtn(true)}>
              {printCancelled ? "Back to home" : "Back to job summary"}
            </button>
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
  width: "100%", height: "100%", flex: 1, background: "var(--kiosk-bg)",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const header: React.CSSProperties = {
  padding: "16px 24px", borderBottom: "1px solid var(--kiosk-surface-hover)",
  display: "flex", alignItems: "center", gap: 14, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 19, color: "var(--kiosk-text)" };
const headerSub: React.CSSProperties = { fontSize: 14, color: "var(--kiosk-muted)" };
const body: React.CSSProperties = {
  flex: 1, minHeight: 0, display: "flex", alignItems: "flex-start", justifyContent: "center",
  padding: 16, overflowY: "auto", overscrollBehavior: "contain", boxSizing: "border-box",
};
const card: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14,
  padding: "28px 32px", width: "100%", maxWidth: 640, maxHeight: "none", overflowY: "visible", boxSizing: "border-box",
};
const splitContainer: React.CSSProperties = {
  display: "flex", alignItems: "stretch", gap: 20, width: "100%", maxWidth: 1200,
  height: "auto", maxHeight: "none", flexShrink: 0, boxSizing: "border-box",
};
const previewPane: React.CSSProperties = {
  flex: 1.2, minWidth: 0, minHeight: 480, display: "flex", flexDirection: "column",
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14, padding: 18,
  boxSizing: "border-box", overflow: "hidden",
};
const previewStatus: React.CSSProperties = {
  width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20, boxSizing: "border-box", textAlign: "center", color: "var(--kiosk-muted)", fontSize: 17,
};
const settingsPane: React.CSSProperties = {
  flex: 1, minWidth: 0, background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14,
  padding: "20px 22px", display: "flex", flexDirection: "column", justifyContent: "flex-start",
  gap: 12, height: "auto", boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 19, fontWeight: 600, marginBottom: 10, color: "var(--kiosk-text)" };
const infoRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--kiosk-surface-hover)", padding: "10px 0", alignItems: "center",
};
const infoLabel: React.CSSProperties = { fontSize: 16, color: "var(--kiosk-text-secondary)", flexShrink: 0 };
const infoVal: React.CSSProperties = { fontSize: 15, color: "var(--kiosk-text)" };
const selectStyle: React.CSSProperties = {
  minHeight: 46, maxWidth: "65%", padding: "8px 10px", borderRadius: "6px", fontSize: 16, fontWeight: 600,
  background: "var(--kiosk-input)", color: "var(--kiosk-text)", border: "1px solid var(--kiosk-border-strong)",
  cursor: "pointer", outline: "none",
};
const primaryBtn = (active: boolean): React.CSSProperties => ({
  flex: 1.2, minHeight: 52, padding: "12px 10px", borderRadius: 8, fontWeight: 700, fontSize: 15,
  background: active ? "#f0a500" : "var(--kiosk-border)", color: active ? "#000" : "var(--kiosk-muted-dim)",
  cursor: active ? "pointer" : "not-allowed", border: "none",
  textAlign: "center",
});
const ghostBtn: React.CSSProperties = {
  flex: 0.8, minHeight: 52, padding: "12px 10px", borderRadius: 8, fontWeight: 600, fontSize: 15,
  background: "transparent", color: "var(--kiosk-muted)", border: "1px solid var(--kiosk-border-strong)", cursor: "pointer",
  textAlign: "center",
};