import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Screen } from "../App";
import FeedbackModal from "../components/FeedbackModal";
import {
  PrintIcon,
  CreditCardIcon,
  RecyclingIcon,
  AccountCircleIcon,
  ChatIcon,
} from "../components/KioskIcons";
import { API } from "../config";

interface Props {
  onNavigate: (s: Screen) => void;
}

interface Tile {
  screen: Screen;
  icon: ReactNode;
  label: string;
  sub: string;
  color: string;
}

const TILES: Tile[] = [
  { screen: "print",    icon: <PrintIcon size={28} color="#f0a500" />, label: "Print", sub: "Upload & print a document", color: "var(--kiosk-accent-text)" },
  { screen: "balance",  icon: <CreditCardIcon size={28} color="#f0a500" />, label: "Check Balance", sub: "View your print credits", color: "var(--kiosk-accent-text)" },
  { screen: "deposit",  icon: <RecyclingIcon size={28} color="#f0a500" />, label: "Deposit Bottles", sub: "Earn print credits", color: "var(--kiosk-accent-text)" },
  { screen: "register", icon: <AccountCircleIcon size={28} color="#f0a500" />, label: "Register RFID", sub: "Link a new card", color: "var(--kiosk-accent-text)" },
];

export default function HomeScreen({ onNavigate }: Props) {
  const [showFeedback, setShowFeedback] = useState(false);
    const [off, setOff] = useState<Record<string, string>>({});   // feature -> message while switched off
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${API}/api/kiosk/controls`);
        if (!r.ok) return;
        const next: Record<string, string> = {};
        for (const c of await r.json()) if (c.disabled) next[c.feature] = c.message;
        setOff(next);
      } catch {}
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
    // Check Balance and Register need a card, so the card-reader switch greys them out too
  const why = (s: string) => off[s] ?? (s === "balance" || s === "register" ? off["rfid"] : undefined);
  return (
    <div style={{
      width: "100%", height: "100%", flex: 1, background: "var(--kiosk-bg)",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      boxSizing: "border-box", overflow: "hidden",
    }}>

      {/* header */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid var(--kiosk-surface-hover)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 20, color: "var(--kiosk-text)", letterSpacing: 1 }}>
            BOTTLE<span style={{ color: "var(--kiosk-accent-text)" }}>2</span>PRINT
          </span>
          <span style={{ fontSize: 12, color: "var(--kiosk-muted-secondary)", marginLeft: 12, letterSpacing: 2 }}>
            IOT PRINTING KIOSK
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ fontSize: 15, color: "var(--kiosk-success-text)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--kiosk-success-text)", display: "inline-block" }} />
            Online
          </div>
        </div>
      </div>

      {/* main */}
      <div className="kiosk-page-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 32px", overflowY: "auto", overscrollBehavior: "contain" }}>
        <p style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Select a function to begin</p>
        <p style={{ fontSize: 17, color: "var(--kiosk-muted)", marginBottom: 28 }}>Tap any option below</p>

        {/* 2x2 grid */}
        <div className="home-function-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, width: "100%", maxWidth: 900 }}>
          {TILES.map(t => (
            <button
              key={t.screen as string}
              onClick={() => { if (!why(t.screen as string)) onNavigate(t.screen); }}
              style={{
                background: "var(--kiosk-surface)",
                border: "1px solid var(--kiosk-border)",
                borderRadius: 12,
                padding: "24px 26px",
                display: "flex", alignItems: "center", gap: 20, minHeight: 116,
                cursor: why(t.screen as string) ? "not-allowed" : "pointer", opacity: why(t.screen as string) ? 0.7 : 1, textAlign: "left",
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--kiosk-surface-hover)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#f0a500";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--kiosk-surface)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--kiosk-border)";
              }}
            >
              <div style={{
                width: 60, height: 60, borderRadius: 12,
                background: "var(--kiosk-bg)", border: "1px solid var(--kiosk-border-strong)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, flexShrink: 0,
              }}>
                {t.icon}
              </div>
              <div>
                <div style={{ fontSize: 21, fontWeight: 700, color: "var(--kiosk-text)", marginBottom: 5 }}>{t.label}</div>
                <div style={{ fontSize: 15, lineHeight: 1.4, color: why(t.screen as string) ? "var(--kiosk-accent-text)" : "var(--kiosk-muted)" }}>{why(t.screen as string) ?? t.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowFeedback(true)}
          style={{
            marginTop: 18, width: "100%", maxWidth: 900,
            background: "transparent", border: "1px solid var(--kiosk-surface-hover)",
            borderRadius: 10, padding: "14px 24px", minHeight: 52,
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--kiosk-muted-dim)"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--kiosk-surface-hover)"}
        >
          <ChatIcon size={20} color="#f0a500" />
          <div style={{ fontSize: 15, color: "var(--kiosk-muted)" }}>Leave feedback about this kiosk</div>
        </button>

        {showFeedback && (
          <FeedbackModal context="general" onClose={() => setShowFeedback(false)} />
        )}
      </div>
    </div>
  );
}