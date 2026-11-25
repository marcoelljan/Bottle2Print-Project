import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircleIcon,
  CreditCardIcon,
  PrintIcon,
  RecyclingIcon,
  XCircleIcon,
  AccountCircleIcon,
} from "./KioskIcons";

interface Props { onDismiss: () => void; }

const SLIDE_MS = 6000;

/* ── small drawings used by the slides ─────────────────────────────── */
function Bottle({ color = "var(--kiosk-text)", fill }: { color?: string; fill?: string }) {
  return (
    <svg width="46" height="110" viewBox="0 0 40 100" fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round">
      <rect x="14" y="2" width="12" height="8" rx="2" />
      <path d="M15 10v10c0 6-9 10-9 20v50a6 6 0 0 0 6 6h16a6 6 0 0 0 6-6V40c0-10-9-14-9-20V10" />
      {fill && <path d="M7 62c5-4 8 4 13 0s8 4 13 0v28a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5Z" fill={fill} stroke="none" opacity="0.8" />}
    </svg>
  );
}
function Can() {
  return (
    <svg width="64" height="110" viewBox="0 0 60 100" fill="none" stroke="var(--kiosk-text)" strokeWidth="2.4" strokeLinejoin="round">
      <rect x="10" y="12" width="40" height="78" rx="5" />
      <path d="M10 24h40M10 78h40" />
    </svg>
  );
}
function Paper() {
  return (
    <svg width="54" height="90" viewBox="0 0 60 100" fill="none" stroke="var(--kiosk-text)" strokeWidth="2.4" strokeLinejoin="round">
      <path d="M12 14h26l12 12v60H12Z" />
      <path d="M38 14v12h12M20 46h22M20 58h22M20 70h14" />
    </svg>
  );
}
function OversizedBottle() {
  return (
    <svg width="58" height="90" viewBox="0 0 60 100" fill="none" stroke="var(--kiosk-text)" strokeWidth="2.4" strokeLinejoin="round">
      <rect x="20" y="2" width="20" height="9" rx="2" />
      <path d="M21 11v8c0 6-17 10-17 22v46a8 8 0 0 0 8 8h36a8 8 0 0 0 8-8V41c0-12-17-16-17-22v-8" />
    </svg>
  );
}
function Stage({ children }: { children: ReactNode }) {
  return <div style={{ position: "relative", minHeight: 150, display: "flex", alignItems: "center", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>{children}</div>;
}

/* ── slides ───────────────────────────────────────────────────────── */
interface Slide { title: string; text: string; visual: ReactNode; }

const SLIDES: Slide[] = [
  {
    title: "Welcome to Bottle2Print",
    text: "Turn accepted plastic bottles into print credits, then use those credits to print your documents.",
    visual: (
      <Stage>
        <div className="tut-pop"><RecyclingIcon size={96} color="var(--kiosk-accent-text)" /></div>
        <div className="tut-arrow">→</div>
        <div className="tut-pop" style={{ animationDelay: "0.6s" }}><PrintIcon size={96} color="var(--kiosk-accent-text)" /></div>
      </Stage>
    ),
  },
  {
    title: "Deposit bottles",
    text: "Use your RFID card or continue as a guest. Feed one empty plastic bottle, then wait for its on-screen result before inserting the next. Inserting bottles continuously can jam the chute.",
    visual: (
      <Stage>
        <div style={{ display: "flex", alignItems: "center", gap: 48, flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ width: 180, textAlign: "center" }}>
            <div style={{ position: "relative", width: 140, height: 145, margin: "0 auto" }}>
              <div className="tut-drop" style={{ position: "absolute", left: 47, top: 0 }}><Bottle color="var(--kiosk-success-text)" /></div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 8, height: 16, borderRadius: 8, background: "var(--kiosk-surface-hover)", border: "2px solid var(--kiosk-accent-text)" }} />
              <div className="tut-check" style={{ position: "absolute", right: -18, bottom: 0 }}>
                <CheckCircleIcon size={38} color="var(--kiosk-success-text)" />
              </div>
            </div>
            <div style={{ color: "var(--kiosk-success-text)", fontSize: 16, fontWeight: 700 }}>One bottle, then wait</div>
          </div>

          <div style={{ width: 220, textAlign: "center" }}>
            <div style={{ position: "relative", width: 164, height: 145, margin: "0 auto" }}>
              <div className="tut-rush" style={{ position: "absolute", left: 35, top: 0 }}><Bottle color="var(--kiosk-danger-text)" /></div>
              <div className="tut-rush tut-rush-second" style={{ position: "absolute", left: 78, top: 0 }}><Bottle color="var(--kiosk-danger-text)" /></div>
              <div style={{ position: "absolute", left: 20, right: 20, bottom: 8, height: 16, borderRadius: 8, background: "var(--kiosk-danger-bg)", border: "2px solid var(--kiosk-danger-text)" }} />
              <div className="tut-x" style={{ position: "absolute", right: 0, top: 14 }}>
                <XCircleIcon size={38} color="var(--kiosk-danger-text)" />
              </div>
            </div>
            <div style={{ color: "var(--kiosk-danger-text)", fontSize: 16, fontWeight: 700 }}>Not at the same time</div>
          </div>
        </div>
      </Stage>
    ),
  },
  {
    title: "What should NOT go in the kiosk",
    text: "Do not insert bottles with liquid, cans, glass bottles, paper or trash, or oversized bottles. If an item is rejected, remove it and ask staff if you need help.",
    visual: (
      <Stage>
        {([
          [<Bottle fill="#3498db" />, "Bottle with liquid"],
          [<Can />, "Can"],
          [<Bottle color="#5dade2" />, "Glass"],
          [<Paper />, "Paper / trash"],
          [<OversizedBottle />, "Oversized"],
        ] as [ReactNode, string][]).map(([icon, label], index) => (
          <div key={label} style={{ position: "relative", minWidth: 120, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            {icon}
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--kiosk-text-secondary)" }}>{label}</div>
            <div className="tut-x" style={{ position: "absolute", top: -8, right: 2, animationDelay: `${0.3 + index * 0.2}s` }}>
              <XCircleIcon size={30} color="var(--kiosk-danger-text)" />
            </div>
          </div>
        ))}
      </Stage>
    ),
  },
  {
    title: "Earn print credits",
    text: "Each accepted bottle adds credits to your account or guest session. Bottle sizes can earn different amounts. Finish depositing when you are done.",
    visual: (
      <Stage>
        <div className="tut-pop"><CheckCircleIcon size={72} color="var(--kiosk-success-text)" /></div>
        <div style={{ padding: "12px 32px", borderRadius: 14, background: "var(--kiosk-surface)", border: "1.5px solid var(--kiosk-success-text)", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--kiosk-text-secondary)" }}>Credits added</div>
          <CreditCardIcon size={48} color="var(--kiosk-accent-text)" />
        </div>
      </Stage>
    ),
  },
  {
    title: "Upload and print a file",
    text: "Tap Print and scan the QR code with your phone. Upload your file, choose pages, paper size, and color mode, then confirm the job.",
    visual: (
      <Stage>
        <div className="tut-pop" style={{ width: 108, height: 108, background: "var(--kiosk-text)", borderRadius: 10, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3, padding: 10, boxSizing: "border-box" }}>
          {Array.from({ length: 25 }).map((_, index) => (
            <div key={index} style={{ background: [0,1,2,4,5,7,9,10,12,14,15,17,19,20,22,23,24].includes(index) ? "var(--kiosk-bg)" : "transparent", borderRadius: 2 }} />
          ))}
        </div>
        <div className="tut-arrow">→</div>
        <div className="tut-pop" style={{ animationDelay: "0.6s" }}><PrintIcon size={88} color="var(--kiosk-accent-text)" /></div>
      </Stage>
    ),
  },
  {
    title: "Pay with your card or bottles",
    text: "Use a registered RFID card and PIN to pay with account credits, or continue as a guest and deposit bottles to earn credits for printing.",
    visual: (
      <Stage>
        <div className="tut-pop"><CreditCardIcon size={88} color="var(--kiosk-accent-text)" /></div>
        <div style={{ fontSize: 22, color: "var(--kiosk-muted)", fontWeight: 700 }}>OR</div>
        <div className="tut-pop" style={{ animationDelay: "0.6s" }}><RecyclingIcon size={88} color="var(--kiosk-success-text)" /></div>
      </Stage>
    ),
  },
  {
    title: "Register your card",
    text: "New here? Tap Register RFID to link your card and create a 6-digit PIN. Choose Check Balance anytime to see your credits.",
    visual: (
      <Stage>
        <div className="tut-pop"><AccountCircleIcon size={96} color="var(--kiosk-accent-text)" /></div>
        <div className="tut-arrow">→</div>
        <div className="tut-pop" style={{ animationDelay: "0.6s" }}><CreditCardIcon size={96} color="var(--kiosk-accent-text)" /></div>
      </Stage>
    ),
  },
];

export default function IdleTutorial({ onDismiss }: Props) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setI(current => (current + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [i]);

  const s = SLIDES[i];
  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 400, background: "var(--kiosk-bg)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, boxSizing: "border-box", textAlign: "center", overflowY: "auto",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <style>{CSS}</style>

      <div style={{ fontSize: 16, letterSpacing: 2, color: "var(--kiosk-muted-secondary)", marginBottom: 8 }}>
        HOW IT WORKS · STEP {i + 1} OF {SLIDES.length}
      </div>

      {/* key restarts the animations on every slide */}
      <div key={i} className="tut-slide" style={{ width: "100%", maxWidth: 1000 }}>
        {s.visual}
        <div style={{ fontSize: 36, fontWeight: 800, color: "var(--kiosk-text)", marginTop: 10 }}>{s.title}</div>
        <div style={{ fontSize: 22, lineHeight: 1.5, color: "var(--kiosk-text-secondary)", margin: "12px auto 0", maxWidth: 820 }}>{s.text}</div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
        {SLIDES.map((_, n) => (
          <div key={n} style={{ width: n === i ? 28 : 10, height: 10, borderRadius: 5, transition: "all 0.3s", background: n === i ? "var(--kiosk-accent-text)" : "var(--kiosk-border-strong)" }} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, width: "100%", maxWidth: 900, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => setI(current => (current - 1 + SLIDES.length) % SLIDES.length)}
          style={tutorialButton("secondary")}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setI(current => (current + 1) % SLIDES.length)}
          style={tutorialButton("primary")}
        >
          Next
        </button>
      </div>
      <button type="button" onClick={onDismiss} className="tut-pulse" style={{ ...tutorialButton("primary"), marginTop: 14 }}>
        Touch the screen to start
      </button>
    </div>
  );
}

function tutorialButton(variant: "primary" | "secondary"): React.CSSProperties {
  return {
    minWidth: variant === "primary" ? 240 : 170,
    minHeight: 58,
    padding: "14px 24px",
    borderRadius: 12,
    border: variant === "primary" ? "2px solid var(--kiosk-accent-text)" : "2px solid var(--kiosk-border-strong)",
    background: variant === "primary" ? "var(--kiosk-accent-text)" : "var(--kiosk-surface)",
    color: variant === "primary" ? "#000" : "var(--kiosk-text)",
    fontSize: 19,
    fontWeight: 700,
    cursor: "pointer",
  };
}

const CSS = `
@keyframes tut-in   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes tut-pop  { 0% { opacity: 0; transform: scale(0.4); } 60% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
@keyframes tut-drop { 0% { opacity: 0; transform: translateY(-40px); } 15% { opacity: 1; } 55% { transform: translateY(95px); opacity: 1; } 70%,100% { transform: translateY(115px); opacity: 0; } }
@keyframes tut-rush { 0% { opacity: 0; transform: translateY(-34px); } 12% { opacity: 1; } 55% { opacity: 1; transform: translateY(78px); } 72%,100% { opacity: 0; transform: translateY(100px); } }
@keyframes tut-check{ 0%,60% { opacity: 0; transform: scale(0.3); } 80% { opacity: 1; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
@keyframes tut-x    { 0% { opacity: 0; transform: scale(0.2) rotate(-90deg); } 70% { transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }
@keyframes tut-arrow{ 0%,100% { transform: translateX(0); opacity: 0.5; } 50% { transform: translateX(10px); opacity: 1; } }
@keyframes tut-pulse{ 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(240,165,0,0.5); } 50% { transform: scale(1.03); box-shadow: 0 0 0 12px rgba(240,165,0,0); } }
.tut-slide { animation: tut-in 0.5s ease both; }
.tut-pop   { animation: tut-pop 0.6s ease both; }
.tut-drop  { animation: tut-drop 2.4s ease-in 0.3s infinite; }
.tut-rush  { animation: tut-rush 1.6s ease-in 0.2s infinite; }
.tut-rush-second { animation-delay: 0.34s; }
.tut-check { animation: tut-check 2.4s ease 0.3s infinite; }
.tut-x     { animation: tut-x 0.5s ease both; }
.tut-arrow { font-size: 44px; color: var(--kiosk-accent-text); animation: tut-arrow 1.2s ease-in-out infinite; }
.tut-pulse { animation: tut-pulse 1.8s ease-in-out infinite; }
`;