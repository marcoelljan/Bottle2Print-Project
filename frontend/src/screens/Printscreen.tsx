import { useState, useRef, useEffect } from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import FeedBackModal from "../components/FeedbackModal";
import { API } from "../config";

interface Props { onBack: () => void; }
interface User { rfid: string; name: string; studentId: string; credits: number; }

type Step = "rfid" | "upload" | "confirm" | "printing" | "success" | "error";

export default function PrintScreen({ onBack }: Props) {
  const [step, setStep] = useState<Step>("rfid");
  const [user, setUser] = useState<User | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showNoCredit, setShowNoCredit] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [, setJobOutput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  


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

  const handleIdentified = (u: User) => {
    setUser(u);
    setStep("upload");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPageCount(null);

    if (f.type === "application/pdf") {
      setCounting(true);
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch(`${API}/api/count-pages`, { method: "POST", body: form });
        const data = await res.json();
        setPageCount(data.pages ?? 1);
      } catch {
        setPageCount(1);
      }
      setCounting(false);
    } else {
      setPageCount(1);
    }
  };

  const handleConfirm = () => {
    if (!user || pageCount === null) return;
    if (user.credits < pageCount) {
      setShowNoCredit(true);
      return;
    }
    setStep("confirm");
  };

  const handlePrint = async () => {
    if (!file || !user || pageCount === null) return;
    setStep("printing");

    const form = new FormData();
    form.append("document", file);
    form.append("rfid", user.rfid);
    form.append("pages", String(pageCount));

    try {
      const res = await fetch(`${API}/api/print`, { method: "POST", body: form });
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

  const isPdf = file?.type === "application/pdf";
  const creditCost = pageCount ?? 1;
  const hasEnough = user && pageCount !== null && user.credits >= creditCost;

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22 }}>🖨️</span>
        <div>
          <div style={headerTitle}>Print</div>
          <div style={headerSub}>Upload & print a document</div>
        </div>
      </div>

      <div style={body}>

        {/* STEP 1 — RFID */}
        {step === "rfid" && <RFIDprompt onIdentified={handleIdentified} />}

        {/* STEP 2 — Upload */}
        {step === "upload" && (
          <div style={card}>
            <div style={userBadge}>
              <span style={{ fontSize: 20 }}>👤</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{user?.name}</div>
                <div style={{ fontSize: 12, color: "#f0a500" }}>{user?.credits} credits available</div>
              </div>
            </div>

            <div style={divider} />

            <p style={label}>Select a file to print</p>
            <p style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
              Supported: PDF, Word, PowerPoint, Images
            </p>

            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed #3a3a3a", borderRadius: 12,
                padding: "32px 24px", textAlign: "center", cursor: "pointer",
                background: "#1e1e1e", marginBottom: 16,
                transition: "border-color 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = "#f0a500"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = "#3a3a3a"}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
              {file
                ? <div style={{ color: "#f0a500", fontWeight: 600, fontSize: 14 }}>{file.name}</div>
                : <div style={{ color: "#666", fontSize: 14 }}>Tap to choose file</div>
              }
              {counting && <div style={{ color: "#aaa", fontSize: 12, marginTop: 8 }}>Counting pages...</div>}
              {file && pageCount !== null && (
                <div style={{ marginTop: 10 }}>
                  <span style={pill}>
                    {isPdf ? `${pageCount} page${pageCount > 1 ? "s" : ""}` : "1 page (non-PDF)"}
                  </span>
                  <span style={{ ...pill, marginLeft: 8, background: hasEnough ? "#1a3a2a" : "#3a1a1a", color: hasEnough ? "#2ecc71" : "#e74c3c", borderColor: hasEnough ? "#2ecc71" : "#e74c3c" }}>
                    {creditCost} credit{creditCost > 1 ? "s" : ""} will be deducted
                  </span>
                </div>
              )}
            </div>

            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={handleFileChange} />

            <button
              onClick={handleConfirm}
              disabled={!file || counting || pageCount === null}
              style={primaryBtn(!!file && !counting && pageCount !== null)}
            >
              Continue
            </button>
          </div>
        )}

        {/* STEP 3 — Confirm */}
        {step === "confirm" && (
          <div style={card}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Confirm print job</div>
            </div>

            <div style={infoRow}>
              <span style={infoLabel}>File</span>
              <span style={infoVal}>{file?.name}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Pages</span>
              <span style={infoVal}>{pageCount}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Credits to deduct</span>
              <span style={{ ...infoVal, color: "#e74c3c", fontWeight: 700 }}>{creditCost}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Credits after print</span>
              <span style={{ ...infoVal, color: "#f0a500", fontWeight: 700 }}>{(user?.credits ?? 0) - creditCost}</span>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button onClick={() => setStep("upload")} style={ghostBtn}>Cancel</button>
              <button onClick={handlePrint} style={primaryBtn(true)}>Print now</button>
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
            <button onClick={() => setStep("upload")} style={primaryBtn(true)}>Try again</button>
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
const pill: React.CSSProperties = {
  display: "inline-block", fontSize: 11, padding: "3px 10px",
  border: "1px solid #555", borderRadius: 20, color: "#aaa", background: "#1a1a1a",
};
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
