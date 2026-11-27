import { useCallback, useEffect, useState } from "react";
import { API } from "../config";

type OfferStatus = "active" | "paused" | "ended";
type RequestStatus = "pending" | "approved" | "ready" | "fulfilled" | "declined" | "cancelled";
type RedemptionStatus = "pending" | "approved" | "ready" | "fulfilled" | "declined";

interface RewardOffer {
  id: number;
  title: string;
  description: string;
  terms: string;
  image: string | null;
  pricePhp: number;
  listedAt: string | null;
  quantityAvailable: number | null;
  maxPerUser: number;
  startsOn: string | null;
  endsOn: string | null;
  status: OfferStatus;
  createdAt: string;
}

interface LegacyRequest {
  id: number;
  rfid: string;
  userName: string;
  offerTitle: string;
  creditCost: number;
  regularPrice: number | null;
  discountedPrice: number | null;
  status: RequestStatus;
  requestedAt: string;
  resolutionNote: string | null;
}

interface Redemption {
  id: number;
  rfid: string;
  userName: string;
  rewardTitle: string;
  pricePhp: number;
  creditsApplied: number;
  discountPhp: number;
  amountDuePhp: number;
  creditsPerPesoUsed: number;
  status: RedemptionStatus;
  requestedAt: string;
  resolutionNote: string | null;
}

interface RewardsData {
  creditValidityDays: number;
  creditsPerPeso: number;
  newBadgeDays: number;
  offers: RewardOffer[];
  requests: LegacyRequest[];
  redemptions: Redemption[];
}

interface OfferForm {
  title: string;
  image: string;
  description: string;
  terms: string;
  pricePhp: string;
  quantityAvailable: string;
  maxPerUser: string;
  startsOn: string;
  endsOn: string;
  status: OfferStatus;
}

const emptyForm = (): OfferForm => ({
  title: "",
  image: "",
  description: "",
  terms: "",
  pricePhp: "",
  quantityAvailable: "",
  maxPerUser: "1",
  startsOn: "",
  endsOn: "",
  status: "active",
});

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 36,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--admin-border-strong)",
  background: "var(--admin-input)",
  color: "var(--admin-text)",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  border: "1px solid var(--admin-border-strong)",
  background: "var(--admin-hover)",
  color: "var(--admin-text)",
  padding: "8px 12px",
  borderRadius: 7,
  fontWeight: 700,
  cursor: "pointer",
};

export default function AdminRewardsPanel({ token }: { token: string }) {
  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<OfferForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creditsPerPeso, setCreditsPerPeso] = useState("10");
  const [newBadgeDays, setNewBadgeDays] = useState("7");

  const authHeaders = useCallback((json = false): HeadersInit => ({
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/admin/rewards`, { headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not load rewards (${response.status}).`);
      const rewards = body as RewardsData;
      setData(rewards);
      setCreditsPerPeso(String(rewards.creditsPerPeso));
      setNewBadgeDays(String(rewards.newBadgeDays));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const saveConfig = async (path: string, payload: Record<string, number>) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}${path}`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not save setting (${response.status}).`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save setting.");
    } finally {
      setSaving(false);
    }
  };

  const submitOffer = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        pricePhp: Number(form.pricePhp),
        quantityAvailable: form.quantityAvailable,
        maxPerUser: Number(form.maxPerUser),
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
      };
      const response = await fetch(`${API}/api/admin/rewards/offers${editingId === null ? "" : `/${editingId}`}`, {
        method: editingId === null ? "POST" : "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not save reward (${response.status}).`);
      setForm(emptyForm());
      setEditingId(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save reward.");
    } finally {
      setSaving(false);
    }
  };

  const editOffer = (offer: RewardOffer) => {
    setEditingId(offer.id);
    setForm({
      title: offer.title,
      image: offer.image ?? "",
      description: offer.description,
      terms: offer.terms,
      pricePhp: String(offer.pricePhp),
      quantityAvailable: offer.quantityAvailable === null ? "" : String(offer.quantityAvailable),
      maxPerUser: String(offer.maxPerUser),
      startsOn: offer.startsOn ?? "",
      endsOn: offer.endsOn ?? "",
      status: offer.status,
    });
  };

  const setOfferStatus = async (offer: RewardOffer, status: OfferStatus) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/admin/rewards/offers/${offer.id}`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not update reward (${response.status}).`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update reward.");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (
    endpoint: "redemptions" | "requests",
    item: Redemption | LegacyRequest,
    status: "approved" | "ready" | "fulfilled" | "declined",
  ) => {
    const note = status === "declined" ? window.prompt("Optional note for the user:", "") : "";
    if (note === null) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/admin/rewards/${endpoint}/${item.id}/status`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ status, note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not update status (${response.status}).`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update status.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div style={{ color: "var(--admin-muted)", padding: 18 }}>Loading rewards...</div>;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 14,
      paddingBottom: 18,
      flex: "1 1 0",
      minHeight: 0,
      overflowY: "auto",
      overscrollBehavior: "contain",
      WebkitOverflowScrolling: "touch",
    }}>
      {error && <div role="alert" style={{ color: "var(--kiosk-danger-text)", fontSize: 13 }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>RFID credit expiration</h2>
        <p style={helperText}>
          Each new credit grant expires {data?.creditValidityDays ?? 180} days after it is earned. Redemption discounts use only the credits selected by the user.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Offer pricing settings</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
          <label style={labelStyle}>Credits per ₱1
            <input type="number" min={0.01} step={0.01} value={creditsPerPeso} onChange={event => setCreditsPerPeso(event.target.value)} style={inputStyle} />
            <span style={helperText}>100 credits = ₱10 discount at the default rate.</span>
            <button type="button" disabled={saving} onClick={() => void saveConfig("/api/admin/config/credits-per-peso", { creditsPerPeso: Number(creditsPerPeso) })} style={primaryButton}>Save conversion rate</button>
          </label>
          <label style={labelStyle}>“New” badge duration (days)
            <input type="number" min={1} max={365} step={1} value={newBadgeDays} onChange={event => setNewBadgeDays(event.target.value)} style={inputStyle} />
            <span style={helperText}>The badge is based on the offer’s listed date.</span>
            <button type="button" disabled={saving} onClick={() => void saveConfig("/api/admin/config/reward-new-badge-days", { newBadgeDays: Number(newBadgeDays) })} style={primaryButton}>Save badge duration</button>
          </label>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>{editingId === null ? "Create offer" : `Edit offer #${editingId}`}</h2>
        <form onSubmit={event => void submitOffer(event)} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 9 }}>
          <label style={labelStyle}>Offer name (shown to users)
            <input required maxLength={100} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>Price (₱)
            <input required type="number" min={0} step={0.01} value={form.pricePhp} onChange={event => setForm({ ...form, pricePhp: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>Image URL (optional)
            <input type="url" value={form.image} onChange={event => setForm({ ...form, image: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>Quantity (blank = unlimited)
            <input type="number" min={0} step={1} value={form.quantityAvailable} onChange={event => setForm({ ...form, quantityAvailable: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>Max redemptions per RFID user
            <input required type="number" min={1} step={1} value={form.maxPerUser} onChange={event => setForm({ ...form, maxPerUser: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>Start date (optional)
            <input type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>End date (optional)
            <input type="date" value={form.endsOn} onChange={event => setForm({ ...form, endsOn: event.target.value })} style={inputStyle} />
          </label>
          {editingId !== null && <label style={labelStyle}>Status
            <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as OfferStatus })} style={inputStyle}>
              <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
            </select>
          </label>}
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Description
            <textarea maxLength={2000} rows={2} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
          </label>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Terms and availability notes
            <textarea maxLength={2000} rows={2} value={form.terms} onChange={event => setForm({ ...form, terms: event.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", gap: 8, gridColumn: "1 / -1" }}>
            <button type="submit" disabled={saving} style={primaryButton}>{editingId === null ? "Create offer" : "Save changes"}</button>
            {editingId !== null && <button type="button" disabled={saving} onClick={() => { setEditingId(null); setForm(emptyForm()); }} style={primaryButton}>Cancel edit</button>}
          </div>
        </form>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Offers</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data?.offers.length ? data.offers.map(offer => (
            <article key={offer.id} style={cardStyle}>
              <div>
                <strong style={{ color: "var(--admin-text)" }}>{offer.title}</strong>
                <span style={{ marginLeft: 8, color: offer.status === "active" ? "var(--kiosk-success-text)" : "var(--admin-muted)", fontSize: 11 }}>{offer.status}</span>
                <div style={helperText}>₱{offer.pricePhp.toFixed(2)} · {offer.quantityAvailable === null ? "Unlimited stock" : `${offer.quantityAvailable} in stock`} · max {offer.maxPerUser}/user</div>
                <div style={helperText}>Listed: {offer.listedAt ? new Date(`${offer.listedAt.replace(" ", "T")}Z`).toLocaleString() : "not listed"}</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button type="button" onClick={() => editOffer(offer)} style={primaryButton}>Edit</button>
                <button type="button" disabled={saving} onClick={() => void setOfferStatus(offer, offer.status === "active" ? "paused" : "active")} style={primaryButton}>{offer.status === "active" ? "Pause" : "Activate / relist"}</button>
                {offer.status !== "ended" && <button type="button" disabled={saving} onClick={() => void setOfferStatus(offer, "ended")} style={primaryButton}>End</button>}
              </div>
            </article>
          )) : <div style={helperText}>No offers have been created.</div>}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Redemptions</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data?.redemptions.length ? data.redemptions.map(redemption => (
            <article key={redemption.id} style={cardStyle}>
              <div>
                <strong style={{ color: "var(--admin-text)" }}>{redemption.rewardTitle}</strong>
                <span style={{ marginLeft: 8, color: "var(--admin-muted)", fontSize: 11 }}>{redemption.status}</span>
                <div style={helperText}>
                  {redemption.userName} · RFID {redemption.rfid} · Price ₱{redemption.pricePhp.toFixed(2)} · {redemption.creditsApplied} credits · Discount ₱{redemption.discountPhp.toFixed(2)} · Amount due ₱{redemption.amountDuePhp.toFixed(2)}
                </div>
                <div style={helperText}>{new Date(`${redemption.requestedAt.replace(" ", "T")}Z`).toLocaleString()} · rate {redemption.creditsPerPesoUsed} credits/₱</div>
                {redemption.resolutionNote && <div style={helperText}>{redemption.resolutionNote}</div>}
              </div>
              <StatusActions item={redemption} saving={saving} onUpdate={(status) => void updateStatus("redemptions", redemption, status)} />
            </article>
          )) : <div style={helperText}>No redemptions yet.</div>}
        </div>
      </section>

      {!!data?.requests.length && <section style={sectionStyle}>
        <h2 style={sectionTitle}>Previous fixed-credit requests</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data.requests.map(request => (
            <article key={request.id} style={cardStyle}>
              <div>
                <strong style={{ color: "var(--admin-text)" }}>{request.offerTitle}</strong>
                <span style={{ marginLeft: 8, color: "var(--admin-muted)", fontSize: 11 }}>{request.status}</span>
                <div style={helperText}>{request.userName} · RFID {request.rfid} · {request.creditCost} credits · Pay ₱{(request.discountedPrice ?? 0).toFixed(2)}</div>
                {request.resolutionNote && <div style={helperText}>{request.resolutionNote}</div>}
              </div>
              <StatusActions item={request} saving={saving} onUpdate={(status) => void updateStatus("requests", request, status)} />
            </article>
          ))}
        </div>
      </section>}
    </div>
  );
}

function StatusActions({
  item,
  saving,
  onUpdate,
}: {
  item: { status: RequestStatus | RedemptionStatus };
  saving: boolean;
  onUpdate: (status: "approved" | "ready" | "fulfilled" | "declined") => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {item.status === "pending" && <>
        <button type="button" disabled={saving} onClick={() => onUpdate("approved")} style={primaryButton}>Approve</button>
        <button type="button" disabled={saving} onClick={() => onUpdate("declined")} style={primaryButton}>Decline</button>
      </>}
      {item.status === "approved" && <>
        <button type="button" disabled={saving} onClick={() => onUpdate("ready")} style={primaryButton}>Ready for pickup</button>
        <button type="button" disabled={saving} onClick={() => onUpdate("fulfilled")} style={primaryButton}>Fulfill</button>
        <button type="button" disabled={saving} onClick={() => onUpdate("declined")} style={primaryButton}>Decline</button>
      </>}
      {item.status === "ready" && <>
        <button type="button" disabled={saving} onClick={() => onUpdate("fulfilled")} style={primaryButton}>Fulfill</button>
        <button type="button" disabled={saving} onClick={() => onUpdate("declined")} style={primaryButton}>Decline</button>
      </>}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--admin-border)",
  borderRadius: 10,
  padding: 14,
  background: "var(--admin-surface)",
};
const sectionTitle: React.CSSProperties = { margin: "0 0 10px", color: "var(--admin-text)", fontSize: 16 };
const helperText: React.CSSProperties = { color: "var(--admin-muted)", fontSize: 12, marginTop: 5, lineHeight: 1.5 };
const labelStyle: React.CSSProperties = { color: "var(--admin-muted)", fontSize: 11, display: "grid", gap: 5 };
const cardStyle: React.CSSProperties = {
  border: "1px solid var(--admin-border)",
  borderRadius: 8,
  padding: 10,
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
