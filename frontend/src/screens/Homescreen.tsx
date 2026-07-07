import { useState } from "react";
import type { Screen } from "../App";
import FeedbackModal from "../components/FeedbackModal";

interface Props { onNavigate: (s: Screen) => void; }

interface Tile {
  screen: Screen;
  icon: string;
  label: string;
  sub: string;
  color: string;
}

const TILES: Tile[] = [
  { screen: "print",    icon: "🖨️",  label: "Print",           sub: "Upload & print a document", color: "#f0a500" },
  { screen: "balance",  icon: "💳",  label: "Check Balance",   sub: "View your print credits",    color: "#f0a500" },
  { screen: "deposit",  icon: "♻️",  label: "Deposit Bottles", sub: "Earn print credits",         color: "#f0a500" },
  { screen: "register", icon: "👤",  label: "Register RFID",   sub: "Link a new card",            color: "#f0a500" },
];

export default function HomeScreen({ onNavigate }: Props) {
  const [showFeedback, setShowFeedback] = useState(false);
  return (
    <div style={{
      width: 1024, height: 600, background: "#1a1a1a",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>

      {/* header */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid #2a2a2a",
        display: "flex", alignItems: "center", justifyContent: "space-between",
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 32px" }}>
        <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Select a function to begin</p>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>Tap any option below</p>

        {/* 2x2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%", maxWidth: 760 }}>
          {TILES.map(t => (
            <button
              key={t.screen as string}
              onClick={() => onNavigate(t.screen)}
              style={{
                background: "#242424",
                border: "1px solid #333",
                borderRadius: 12,
                padding: "22px 24px",
                display: "flex", alignItems: "center", gap: 18,
                cursor: "pointer", textAlign: "left",
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
                <div style={{ fontSize: 12, color: "#666" }}>{t.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* admin strip */}
        <button
          onClick={() => onNavigate("admin" as const)}
          style={{
            marginTop: 16, width: "100%", maxWidth: 760,
            background: "#1e1e1e", border: "1px solid #2a2a2a",
            borderRadius: 10, padding: "12px 24px",
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#555"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a2a"}
        >
          <span style={{ fontSize: 18 }}>🔒</span>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 13, color: "#aaa", fontWeight: 600 }}>Admin Access</div>
            <div style={{ fontSize: 11, color: "#555" }}>Tap RFID card to authenticate</div>
          </div>
        </button>

        <button
          onClick={() => setShowFeedback(true)}
          style={{
            marginTop: 10, width: "100%", maxWidth: 760,
            background: "transparent", border: "1px solid #2a2a2a",
            borderRadius: 10, padding: "10px 24px",
            display: "flex", alignItems: "center", gap: 14,
            cursor: "pointer",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#555"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a2a"}
        >
          <span style={{ fontSize: 16 }}>💬</span>
          <div style={{ fontSize: 12, color: "#888" }}>Leave feedback about this kiosk</div>
        </button>

        {showFeedback && (
          <FeedbackModal context="general" onClose={() => setShowFeedback(false)} />
        )}
      </div>
    </div>
  );
}
