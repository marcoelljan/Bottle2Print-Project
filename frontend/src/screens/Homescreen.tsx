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

interface Props { onNavigate: (s: Screen) => void; }

interface Tile {
  screen: Screen;
  icon: ReactNode;
  label: string;
  sub: string;
  color: string;
}

const TILES: Tile[] = [
  { screen: "print",    icon: <PrintIcon size={22} color="#f0a500" />, label: "Print", sub: "Upload & print a document", color: "#f0a500" },
  { screen: "balance",  icon: <CreditCardIcon size={22} color="#f0a500" />, label: "Check Balance", sub: "View your print credits", color: "#f0a500" },
  { screen: "deposit",  icon: <RecyclingIcon size={22} color="#f0a500" />, label: "Deposit Bottles", sub: "Earn print credits", color: "#f0a500" },
  { screen: "register", icon: <AccountCircleIcon size={22} color="#f0a500" />, label: "Register RFID", sub: "Link a new card", color: "#f0a500" },
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
      width: "100%", height: "100%", flex: 1, background: "#1a1a1a",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      boxSizing: "border-box", overflow: "hidden",
    }}>

      {/* header */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid #2a2a2a",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: 1 }}>
            BOTTLE<span style={{ color: "#f0a500" }}>2</span>PRINT
          </span>
          <span style={{ fontSize: 10, color: "#555", marginLeft: 10, letterSpacing: 2 }}>
            IOT PRINTING KIOSK
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#2ecc71", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2ecc71", display: "inline-block" }} />
          Online
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 32px", overflowY: "auto" }}>
        <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Select a function to begin</p>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>Tap any option below</p>

        {/* 2x2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%", maxWidth: 760 }}>
          {TILES.map(t => (
            <button
              key={t.screen as string}
              onClick={() => { if (!why(t.screen as string)) onNavigate(t.screen); }}
              style={{
                background: "#242424",
                border: "1px solid #333",
                borderRadius: 12,
                padding: "22px 24px",
                display: "flex", alignItems: "center", gap: 18,
                cursor: why(t.screen as string) ? "not-allowed" : "pointer", opacity: why(t.screen as string) ? 0.45 : 1, textAlign: "left",
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "#2a2a2a";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#f0a500";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "#242424";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#333";
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 10,
                background: "#1a1a1a", border: "1px solid #3a3a3a",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, flexShrink: 0,
              }}>
                {t.icon}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{t.label}</div>
                <div style={{ fontSize: 12, color: why(t.screen as string) ? "#e0a030" : "#666" }}>{why(t.screen as string) ?? t.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowFeedback(true)}
          style={{
            marginTop: 16, width: "100%", maxWidth: 760,
            background: "transparent", border: "1px solid #2a2a2a",
            borderRadius: 10, padding: "10px 24px",
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#555"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a2a"}
        >
          <ChatIcon size={16} color="#f0a500" />
          <div style={{ fontSize: 12, color: "#888" }}>Leave feedback about this kiosk</div>
        </button>

        {showFeedback && (
          <FeedbackModal context="general" onClose={() => setShowFeedback(false)} />
        )}
      </div>
    </div>
  );
}