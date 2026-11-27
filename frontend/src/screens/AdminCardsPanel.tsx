import { useCallback, useEffect, useState } from "react";
import { API, WS_URL } from "../config";

type CardStatus = "active" | "expired" | "flagged";
type CardAction = "flag" | "reactivate";

interface Card {
  rfid: string;
  name: string;
  studentId: string;
  credits: number;
  created_at: string;
  cardStatus: CardStatus;
  expiresAt: string | null;
  flaggedReason: "auto_expired" | "admin_flagged" | null;
  flaggedAt: string | null;
  reactivatedAt: string | null;
  reactivationCount: number;
}

interface CardsData {
  cards: Card[];
  validityDays: number;
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--admin-border-strong)",
  background: "var(--admin-hover)",
  color: "var(--admin-text)",
  padding: "7px 10px",
  borderRadius: 7,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--admin-border-strong)",
  background: "var(--admin-input)",
  color: "var(--admin-text)",
  boxSizing: "border-box",
};

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const parsed = new Date(value.includes("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function statusStyle(status: CardStatus): React.CSSProperties {
  const color = status === "active" ? "#2ecc71" : status === "expired" ? "#e74c3c" : "#f0a500";
  return {
    display: "inline-flex",
    padding: "3px 8px",
    borderRadius: 20,
    color,
    background: `${color}1a`,
    border: `1px solid ${color}66`,
    fontSize: 11,
    fontWeight: 800,
    textTransform: "capitalize",
  };
}

export default function AdminCardsPanel({ token }: { token: string }) {
  const [data, setData] = useState<CardsData | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CardStatus>("all");
  const [validityDays, setValidityDays] = useState("180");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<{ card: Card; action: CardAction } | null>(null);
  const [zeroCreditsOnFlag, setZeroCreditsOnFlag] = useState(false);
  const [feeCollected, setFeeCollected] = useState(false);

  const headers = useCallback((): HeadersInit => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadCards = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/admin/cards?status=${statusFilter}`, { headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not load cards (${response.status}).`);
      setData(body as CardsData);
      setValidityDays(String(body.validityDays ?? 180));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load cards.");
    } finally {
      setLoading(false);
    }
  }, [headers, statusFilter]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadCards(); }, 10000);
    const ws = new WebSocket(WS_URL);
    let shouldClose = false;
    ws.onopen = () => { if (shouldClose) ws.close(); };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "card_status_changed") void loadCards();
      } catch {
        setError("Received an invalid live card update.");
      }
    };
    return () => {
      window.clearInterval(timer);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      else if (ws.readyState === WebSocket.CONNECTING) shouldClose = true;
    };
  }, [loadCards]);

  const saveValidity = async () => {
    const days = Number(validityDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
      setError("Enter a validity period from 1 to 3,650 days.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API}/api/admin/config/card-validity`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ validityDays: days }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not save setting (${response.status}).`);
      setNotice(`Card validity updated to ${body.validityDays} days. This applies to newly issued and reactivated cards.`);
      await loadCards();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save card validity.");
    } finally {
      setSaving(false);
    }
  };

  const confirmCardAction = async () => {
    if (!pendingAction) return;
    const { card, action } = pendingAction;
    if (action === "reactivate" && !feeCollected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API}/api/admin/cards/${encodeURIComponent(card.rfid)}/${action === "flag" ? "flag" : "unflag"}`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(action === "flag"
          ? { zeroCredits: zeroCreditsOnFlag }
          : { reactivationFeeCollected: feeCollected }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not ${action} card (${response.status}).`);
      setNotice(action === "flag"
        ? `RFID ${card.rfid} flagged${zeroCreditsOnFlag ? "; credits were cleared." : "; credits preserved."}`
        : `RFID ${card.rfid} reactivated. New expiry: ${formatDate(body.expiresAt)}.`);
      setPendingAction(null);
      setZeroCreditsOnFlag(false);
      setFeeCollected(false);
      await loadCards();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${action} card.`);
    } finally {
      setSaving(false);
    }
  };

  const forceExpire = async (card: Card) => {
    if (!window.confirm(`Force-expire RFID ${card.rfid} now and wipe its remaining credits? This is intended for demonstration.`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API}/api/admin/cards/${encodeURIComponent(card.rfid)}/force-expire`, {
        method: "POST",
        headers: headers(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not expire card (${response.status}).`);
      setNotice(`RFID ${card.rfid} expired for the demo. Credits were cleared.`);
      await loadCards();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not force-expire card.");
    } finally {
      setSaving(false);
    }
  };

  const panelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 18,
    flex: "1 1 0",
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
  };

  return (
    <div style={panelStyle}>
      <section style={{ border: "1px solid var(--admin-border)", borderRadius: 10, padding: 14, background: "var(--admin-surface)", flexShrink: 0 }}>
        <h2 style={{ margin: "0 0 6px", color: "var(--admin-text)", fontSize: 16 }}>RFID card validity</h2>
        <p style={{ margin: "0 0 10px", color: "var(--admin-muted)", fontSize: 12, lineHeight: 1.5 }}>
          Expired or flagged cards cannot deposit bottles, spend credits, print, or request rewards. Automatic expiry sets the balance to zero and records a transaction.
          Changing validity only affects newly issued and reactivated cards.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--admin-muted)", fontSize: 11, fontWeight: 700 }}>
            CARD VALIDITY (DAYS)
            <input type="number" min={1} max={3650} step={1} value={validityDays} onChange={event => setValidityDays(event.target.value)} style={{ ...inputStyle, width: 170 }} />
          </label>
          <button type="button" disabled={saving} onClick={() => void saveValidity()} style={buttonStyle}>Save validity</button>
        </div>
      </section>

      {error && <div role="alert" style={{ color: "var(--kiosk-danger-text)", fontSize: 13 }}>{error}</div>}
      {notice && <div role="status" style={{ color: "var(--kiosk-success-text)", fontSize: 13 }}>{notice}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {(["all", "active", "expired", "flagged"] as const).map(status => (
          <button
            type="button"
            key={status}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(status)}
            style={{ ...buttonStyle, color: statusFilter === status ? "var(--kiosk-accent-text)" : "var(--admin-text)" }}
          >
            {status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}
          </button>
        ))}
        <button type="button" disabled={loading || saving} onClick={() => void loadCards()} style={{ ...buttonStyle, marginLeft: "auto" }}>Refresh</button>
      </div>

      {loading && !data && <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>Loading cards...</div>}
      <div style={{ overflow: "auto", minHeight: 0, border: "1px solid var(--admin-border-strong)", borderRadius: 9, flexShrink: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050, fontSize: 12 }}>
          <thead>
            <tr>{["Student", "RFID", "Status", "Expires at", "Credits", "Registered", "Actions"].map(label => (
              <th key={label} style={{ position: "sticky", top: 0, textAlign: "left", padding: "10px 9px", background: "var(--admin-surface)", color: "var(--admin-muted)", borderBottom: "1px solid var(--admin-border-strong)", zIndex: 1 }}>{label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {data?.cards.map(card => (
              <tr key={card.rfid} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                <td style={{ padding: 9, color: "var(--admin-text)" }}>{card.name || "—"}<div style={{ color: "var(--admin-muted)", fontSize: 11 }}>{card.studentId || "No student ID"}</div></td>
                <td style={{ padding: 9, fontFamily: "monospace", color: "var(--admin-muted-strong)" }}>{card.rfid}</td>
                <td style={{ padding: 9 }}>
                  <span style={statusStyle(card.cardStatus)}>{card.cardStatus}</span>
                  {card.flaggedReason && <div style={{ color: "var(--admin-muted)", fontSize: 10, marginTop: 3 }}>{card.flaggedReason === "auto_expired" ? "Automatic expiry" : "Admin flagged"}</div>}
                </td>
                <td style={{ padding: 9, color: "var(--admin-muted)" }}>{formatDate(card.expiresAt)}</td>
                <td style={{ padding: 9, fontWeight: 800, color: card.cardStatus === "active" ? "var(--kiosk-accent-text)" : "var(--admin-muted)" }}>{card.credits}</td>
                <td style={{ padding: 9, color: "var(--admin-muted)" }}>{formatDate(card.created_at)}</td>
                <td style={{ padding: 9 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {card.cardStatus === "active" && <>
                      <button type="button" disabled={saving} onClick={() => { setPendingAction({ card, action: "flag" }); setZeroCreditsOnFlag(false); }} style={buttonStyle}>Flag</button>
                      <button type="button" disabled={saving} onClick={() => void forceExpire(card)} style={{ ...buttonStyle, color: "#e74c3c" }}>Force Expire Now</button>
                    </>}
                    {card.cardStatus !== "active" && (
                      <button type="button" disabled={saving} onClick={() => { setPendingAction({ card, action: "reactivate" }); setFeeCollected(false); }} style={buttonStyle}>Unflag / Reactivate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data?.cards.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--admin-muted)" }}>No cards match this status.</td></tr>}
          </tbody>
        </table>
      </div>

      {pendingAction && (
        <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0009", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <section role="dialog" aria-modal="true" aria-labelledby="card-action-title" style={{ width: "min(440px, 100%)", border: "1px solid var(--admin-border-strong)", borderRadius: 12, padding: 18, background: "var(--admin-surface)", color: "var(--admin-text)" }}>
            <h2 id="card-action-title" style={{ fontSize: 16, margin: "0 0 10px" }}>
              {pendingAction.action === "flag" ? `Flag RFID ${pendingAction.card.rfid}?` : `Reactivate RFID ${pendingAction.card.rfid}?`}
            </h2>
            {pendingAction.action === "flag" ? (
              <>
                <p style={{ color: "var(--admin-muted)", fontSize: 12, lineHeight: 1.5 }}>This blocks the card from all kiosk credit and deposit actions. By default, its current balance is preserved.</p>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={zeroCreditsOnFlag} onChange={event => setZeroCreditsOnFlag(event.target.checked)} />
                  Also zero this card’s credits
                </label>
              </>
            ) : (
              <>
                <p style={{ color: "var(--admin-muted)", fontSize: 12, lineHeight: 1.5 }}>Reactivation sets a new expiry date {validityDays} days from now. Credits remain at their current balance (expired cards stay at zero).</p>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={feeCollected} onChange={event => setFeeCollected(event.target.checked)} />
                  Reactivation fee collected
                </label>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" disabled={saving} onClick={() => setPendingAction(null)} style={buttonStyle}>Cancel</button>
              <button type="button" disabled={saving || (pendingAction.action === "reactivate" && !feeCollected)} onClick={() => void confirmCardAction()} style={buttonStyle}>
                {saving ? "Saving..." : pendingAction.action === "flag" ? "Confirm flag" : "Reactivate"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
