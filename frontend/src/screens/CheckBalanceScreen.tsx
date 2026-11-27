import { useEffect, useState, useRef} from "react";
import BackButton from "../components/BackButton";
import RFIDprompt from "../components/RFIDprompt";
import PINpad from "../components/Pinpad";
import { API } from "../config";
import { AlertTriangleIcon, CreditCardIcon, PrintIcon, RecyclingIcon } from "../components/KioskIcons";
import KioskThemeToggle from "../components/KioskThemeToggle";

interface Props {
  onBack: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  rewardsFocusToken?: number;
  onRfidSessionChange?: (active: boolean) => void;
}
interface User { rfid: string; name: string; studentId: string; credits: number; }
interface RewardOffer {
  id: number;
  title: string;
  description: string;
  terms: string;
  image: string | null;
  pricePhp: number;
  maxCreditsUsable: number;
  isNew: boolean;
  quantityAvailable: number | null;
  maxPerUser: number;
  startsOn: string | null;
  endsOn: string | null;
}
interface RewardRedemption {
  id: number;
  rewardTitle: string;
  pricePhp: number;
  creditsApplied: number;
  discountPhp: number;
  amountDuePhp: number;
  status: "pending" | "approved" | "ready" | "fulfilled" | "declined";
  requestedAt: string;
  resolutionNote: string | null;
}
interface RewardPreview {
  pricePhp: number;
  creditsApplied: number;
  discountPhp: number;
  amountDuePhp: number;
  maxCreditsUsable: number;
}
interface RewardReceipt {
  rewardTitle: string;
  pricePhp: number;
  creditsApplied: number;
  discountPhp: number;
  amountDuePhp: number;
}
interface UserRewards {
  availableCredits: number;
  creditExpirationDate: string | null;
  creditValidityDays: number;
  cardStatus: "active" | "expired" | "flagged";
  cardExpiresAt: string | null;
  creditsPerPeso: number;
  newBadgeDays: number;
  offers: RewardOffer[];
  redemptions: RewardRedemption[];
}

type TransferStep = "search" | "confirm" | "pin";
const CO2E_KG_PER_KG_PET = 1.146;

export default function CheckBalanceScreen({
  onBack,
  theme,
  onToggleTheme,
  rewardsFocusToken = 0,
  onRfidSessionChange,
}: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [allTxns, setAllTxns] = useState<any[]>([]);
  const [rewards, setRewards] = useState<UserRewards | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsBusyId, setRewardsBusyId] = useState<number | null>(null);
  const [rewardsError, setRewardsError] = useState("");
  const [creditsToApply, setCreditsToApply] = useState<Record<number, number>>({});
  const [rewardPreviews, setRewardPreviews] = useState<Record<number, RewardPreview>>({});
  const [receipt, setReceipt] = useState<RewardReceipt | null>(null);
  const redemptionSessionIds = useRef(new Map<number, string>());
  const rewardsSectionRef = useRef<HTMLElement | null>(null);

  // Transfer modal state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferStep, setTransferStep] = useState<TransferStep>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<any | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferMsg, setTransferMsg] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const parsedTransferAmount = Number.parseInt(transferAmount, 10);
  const hasTransferAmount = Number.isInteger(parsedTransferAmount) && parsedTransferAmount > 0;
  const remainingCredits = (user?.credits ?? 0) - parsedTransferAmount;

  // Transfer PIN Verification Step
  const [transferPinError, setTransferPinError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "balance" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

  const handleIdentified = async (u: User) => {
    setUser(u);
    onRfidSessionChange?.(true);
    try {
      const res = await fetch(`${API}/api/user/${u.rfid}/transactions`);
      const data = await res.json();
      setAllTxns(data);
      setHistory(data.slice(0, 5));
    } catch {}
  };

  useEffect(() => {
    if (!user) {
      setRewards(null);
      return;
    }
    let active = true;
    setRewardsLoading(true);
    setRewardsError("");
    fetch(`${API}/api/rewards?rfid=${encodeURIComponent(user.rfid)}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Could not load rewards (${response.status}).`);
        return body as UserRewards;
      })
      .then(data => {
        if (active) {
          setRewards(data);
          setUser(current => current ? { ...current, credits: data.availableCredits } : current);
        }
      })
      .catch(error => {
        if (active) setRewardsError(error instanceof Error ? error.message : "Could not load rewards.");
      })
      .finally(() => { if (active) setRewardsLoading(false); });
    return () => { active = false; };
  }, [user?.rfid, user?.credits]);

  useEffect(() => {
    if (!user || !rewards) return;
    let active = true;
    const timers = rewards.offers.map(offer => {
      const applied = creditsToApply[offer.id] ?? 0;
      return window.setTimeout(async () => {
        try {
          const response = await fetch(`${API}/api/rewards/${offer.id}/preview?rfid=${encodeURIComponent(user.rfid)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credits_applied: applied }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "Could not calculate reward discount.");
          if (active) setRewardPreviews(current => ({ ...current, [offer.id]: body as RewardPreview }));
        } catch (error) {
          if (active) setRewardsError(error instanceof Error ? error.message : "Could not calculate reward discount.");
        }
      }, 180);
    });
    return () => {
      active = false;
      timers.forEach(window.clearTimeout);
    };
  }, [user?.rfid, rewards?.creditsPerPeso, rewards?.offers, rewards?.availableCredits, creditsToApply]);

  useEffect(() => {
    if (!user || rewardsFocusToken === 0) return;
    rewardsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [user?.rfid, rewardsFocusToken]);

  useEffect(() => {
    if (!receipt) return;
    const timeout = window.setTimeout(() => {
      setReceipt(null);
      onBack();
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [receipt, onBack]);

  useEffect(() => () => onRfidSessionChange?.(false), [onRfidSessionChange]);

  const submitReward = async (offer: RewardOffer) => {
    if (!user) return;
    setRewardsBusyId(offer.id);
    setRewardsError("");
    try {
      let sessionId = redemptionSessionIds.current.get(offer.id);
      if (!sessionId) {
        sessionId = typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `reward-${Array.from(window.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("")}`;
        redemptionSessionIds.current.set(offer.id, sessionId);
      }
      const response = await fetch(`${API}/api/rewards/${offer.id}/redeem?rfid=${encodeURIComponent(user.rfid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, credits_applied: creditsToApply[offer.id] ?? 0 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not redeem reward.");
      redemptionSessionIds.current.delete(offer.id);
      setUser(current => current ? { ...current, credits: body.availableCredits } : current);
      setReceipt({
        rewardTitle: body.receipt.rewardTitle,
        pricePhp: body.receipt.pricePhp,
        creditsApplied: body.receipt.creditsApplied,
        discountPhp: body.receipt.discountPhp,
        amountDuePhp: body.receipt.amountDuePhp,
      });
      const fresh = await fetch(`${API}/api/rewards?rfid=${encodeURIComponent(user.rfid)}`).then(response => response.json());
      setRewards(fresh as UserRewards);
    } catch (error) {
      setRewardsError(error instanceof Error ? error.message : "Could not submit reward request.");
    } finally {
      setRewardsBusyId(null);
    }
  };

  // Search users as you type name/ID (Fixed with correct "?" parameter separator)
  // Search users as you type name/ID
  useEffect(() => {
    if (!searchQuery.trim() || !user) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        // Explicitly build the URL with the correct query parameter name "?"
        const searchUrl = `${API}/api/user/search?query=${encodeURIComponent(searchQuery)}&senderRfid=${user.rfid}`;
        const res = await fetch(searchUrl);
        const data = await res.json();
        setSearchResults(data);
      } catch (err) {
        console.error("Search fetch failed:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, user]);

   const creditsRef = useRef<number | null>(null);
  useEffect(() => { creditsRef.current = user?.credits ?? null; }, [user?.credits]);

  // Keep the balance fresh while the user is on this screen (picks up admin adjustments and incoming transfers)
  useEffect(() => {
    if (!user) return;
    const rfid = user.rfid;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/user/${rfid}`);
        if (!r.ok) return;
        const fresh = await r.json();
        if (fresh.credits !== creditsRef.current) handleIdentified(fresh);
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [user?.rfid]);

    // After 30 s without a touch, go back home so the next person never sees this user's balance
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => {
    if (!user) return;
    let timer = setTimeout(() => onBackRef.current(), 30000);
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => onBackRef.current(), 20000); };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [user?.rfid]);

  const handleProceedToConfirm = () => {
    const amount = parseInt(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferMsg("Enter a valid credit amount.");
      return;
    }
    if (user && amount > user.credits) {
      setTransferMsg("Insufficient credits.");
      return;
    }
    if (!selectedRecipient) {
      setTransferMsg("Select a recipient.");
      return;
    }
    setTransferMsg("");
    setTransferStep("confirm");
  };

  const enterTransferDigit = (digit: string) => {
    setTransferAmount(amount => amount + digit);
    setTransferMsg("");
  };

  const clearTransferAmount = () => {
    setTransferAmount("");
    setTransferMsg("");
  };

  const deleteTransferDigit = () => {
    setTransferAmount(amount => amount.slice(0, -1));
    setTransferMsg("");
  };

  const handleProceedToPin = () => {
    setTransferPinError("");
    setTransferStep("pin");
  };

    const handleVerifyPinAndTransfer = async (pin: string) => {
    if (!user || !selectedRecipient) return;
    const amount = parseInt(transferAmount);

    setTransferLoading(true);
    setTransferPinError("");

    try {
      const res = await fetch(`${API}/api/user/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderRfid: user.rfid,
          recipientRfid: selectedRecipient.rfid,
          amount,
          pin,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser({ ...user, credits: data.newCredits });
        setTransferStep("search");
        setShowTransfer(false);
        setTransferMsg(`Successfully transferred ${amount} credits to ${selectedRecipient.name}!`);
        setTimeout(() => {
          setSearchQuery("");
          setSelectedRecipient(null);
          setTransferAmount("");
          setTransferMsg("");
          handleIdentified({ ...user, credits: data.newCredits });
        }, 2000);
      } else if (res.status === 401 || res.status === 423) {
        setTransferPinError(data.error ?? "Incorrect PIN.");   // stay on the PIN pad
      } else {
        setTransferStep("search");
        setShowTransfer(false);
        setTransferMsg(data.error ?? "Transfer failed.");
      }
    } catch {
      setTransferStep("search");
      setShowTransfer(false);
      setTransferMsg("Could not reach backend.");
    }
    setTransferLoading(false);
  };

  return (
    <div style={fullScreen}>
      <BackButton onBack={onBack} />

      <div style={header}>
        <span style={{ fontSize: 22, display: "flex", alignItems: "center" }}><CreditCardIcon size={22} color="#f0a500" /></span>
        <div>
          <div style={headerTitle}>Check Balance</div>
          <div style={headerSub}>View your print credits & recycling history</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <KioskThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </div>

      <div className="kiosk-page-scroll" style={body}>
        {!user ? (
          <div className="rfid-prompt-stage">
            <RFIDprompt onIdentified={handleIdentified} />
          </div>
        ) : (
            <div style={scrollWrap}>
              {/* profile card */}
              <div style={profileCard}>
                <div style={avatar}>{user.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: "var(--kiosk-muted-low)", marginTop: 2 }}>ID: {user.studentId || "Not set"}</div>
                  <div style={{ fontSize: 11, color: "var(--kiosk-muted-faint)", marginTop: 2 }}>RFID: {user.rfid}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--kiosk-muted-low)" }}>Available credits</div>
                  <div style={{ fontSize: 40, fontWeight: 800, color: "var(--kiosk-accent-text)", lineHeight: 1.1 }}>{user.credits}</div>
                  <div style={{ fontSize: 11, color: "var(--kiosk-muted-dim)" }}>credits</div>
                </div>
              </div>

                               {!showTransfer && transferMsg && (
                <div style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 8,
                  color: transferMsg.startsWith("Successfully") ? "var(--kiosk-success-text)" : "var(--kiosk-danger-text)",
                  border: `1px solid ${transferMsg.startsWith("Successfully") ? "#2ecc71" : "var(--kiosk-danger-text)"}` }}>
                  {transferMsg}
                </div>
              )}
              {/* Action buttons (Transfer Credits) */}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => { 
                    setTransferStep("search"); 
                    setShowTransfer(true); 
                    setTransferMsg(""); 
                    setSearchQuery(""); 
                    setSelectedRecipient(null);
                    setTransferAmount(""); 
                  }}
                  style={{
                    flex: 1, padding: "12px", borderRadius: 10, background: "var(--kiosk-surface-hover)",
                    border: "1px solid var(--kiosk-border-strong)", color: "var(--kiosk-accent-text)", fontWeight: 700, fontSize: 14, cursor: "pointer"
                  }}
                >
                   Transfer Credits to Another User
                </button>
              </div>

              <section ref={rewardsSectionRef} style={{ background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "var(--kiosk-text)" }}>Available Offers</div>
                    <div style={{ fontSize: 12, color: "var(--kiosk-muted-low)", marginTop: 4 }}>
                      Choose how many credits to apply. {rewards?.creditsPerPeso ?? 10} credits = ₱1 discount. Payment and pickup are confirmed by the organization.
                    </div>
                  </div>
                  <div style={{ textAlign: "right", color: "var(--kiosk-muted-low)", fontSize: 12 }}>
                    <div>Available: <strong style={{ color: "var(--kiosk-accent-text)" }}>{rewards?.availableCredits ?? user.credits}</strong> credits</div>
                    {rewards?.cardStatus === "active" ? (
                      <div style={{ marginTop: 4 }}>Expires on <strong>{rewards.cardExpiresAt ? new Date(`${rewards.cardExpiresAt.replace(" ", "T")}Z`).toLocaleDateString() : "not set"}</strong></div>
                    ) : rewards?.cardStatus ? (
                      <div style={{ marginTop: 4, color: rewards.cardStatus === "expired" ? "var(--kiosk-danger-text)" : "#f0a500", fontWeight: 800, textTransform: "capitalize" }}>
                        {rewards.cardStatus} · 0 credits
                      {rewards.cardExpiresAt && <div style={{ fontWeight: 500 }}>Expiry date: {new Date(`${rewards.cardExpiresAt.replace(" ", "T")}Z`).toLocaleDateString()}</div>}
                    </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--kiosk-muted-dim)", marginTop: 8, lineHeight: 1.5 }}>
                  Redemptions are reviewed by the organization. Credits are deducted when you submit and eligible credits are returned if a request is declined.
                  Credit expiry is not RFID card expiry.
                  New credits expire {rewards?.creditValidityDays ?? 180} days after they are earned; your earliest current expiry is {rewards?.creditExpirationDate ?? "not available"}.
                </div>
                {rewardsLoading && <div style={{ color: "var(--kiosk-muted-low)", fontSize: 12, marginTop: 10 }}>Loading offers...</div>}
                {rewardsError && <div role="alert" style={{ color: "var(--kiosk-danger-text)", fontSize: 12, marginTop: 10 }}>{rewardsError}</div>}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8, marginTop: 12 }}>
                  {rewards?.offers.length ? rewards.offers.map(offer => (
                    <article key={offer.id} style={{ border: "1px solid var(--kiosk-border)", borderRadius: 9, padding: 11 }}>
                      {offer.image && <img src={offer.image} alt={offer.title} style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 7, marginBottom: 8 }} />}
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontWeight: 700, color: "var(--kiosk-text)" }}>{offer.title}</div>
                        {offer.isNew && <span style={{ height: "fit-content", borderRadius: 10, padding: "2px 7px", background: "#f0a500", color: "#171717", fontSize: 10, fontWeight: 800 }}>NEW</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--kiosk-muted-low)", marginTop: 4 }}>{offer.description || "No description provided."}</div>
                      <div style={{ fontSize: 12, color: "var(--kiosk-accent-text)", fontWeight: 700, marginTop: 8 }}>
                        Price ₱{offer.pricePhp.toFixed(2)} · Your balance: {rewards?.availableCredits ?? user.credits} credits
                      </div>
                      <div style={{ fontSize: 11, color: "var(--kiosk-muted-dim)", marginTop: 3 }}>
                        {offer.quantityAvailable === null ? "Availability: unlimited" : `${offer.quantityAvailable} available`}
                        {offer.endsOn ? ` · until ${offer.endsOn}` : ""}
                      </div>
                      {offer.terms && <div style={{ fontSize: 11, color: "var(--kiosk-muted-low)", marginTop: 6 }}>{offer.terms}</div>}
                      <label style={{ display: "block", color: "var(--kiosk-muted-low)", fontSize: 11, marginTop: 10 }}>
                        Credits to apply (max {offer.maxCreditsUsable})
                        <input
                          type="range"
                          min={0}
                          max={offer.maxCreditsUsable}
                          step={1}
                          value={Math.min(creditsToApply[offer.id] ?? 0, offer.maxCreditsUsable)}
                          onChange={event => setCreditsToApply(current => ({ ...current, [offer.id]: Number(event.target.value) }))}
                          style={{ display: "block", width: "100%", marginTop: 5 }}
                        />
                      </label>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                        <input
                          aria-label={`Credits to apply for ${offer.title}`}
                          type="number"
                          min={0}
                          max={offer.maxCreditsUsable}
                          step={1}
                          value={Math.min(creditsToApply[offer.id] ?? 0, offer.maxCreditsUsable)}
                          onChange={event => {
                            const value = Number(event.target.value);
                            setCreditsToApply(current => ({
                              ...current,
                              [offer.id]: Number.isSafeInteger(value) ? Math.min(offer.maxCreditsUsable, Math.max(0, value)) : 0,
                            }));
                          }}
                          style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--kiosk-border-strong)", background: "var(--kiosk-surface)", color: "var(--kiosk-text)" }}
                        />
                        <button type="button" onClick={() => setCreditsToApply(current => ({ ...current, [offer.id]: offer.maxCreditsUsable }))} style={smallButton}>Use max</button>
                        <button type="button" onClick={() => setCreditsToApply(current => ({ ...current, [offer.id]: 0 }))} style={smallButton}>Use none</button>
                      </div>
                      <div style={{ marginTop: 8, padding: 8, borderRadius: 7, background: "var(--kiosk-surface-hover)", color: "var(--kiosk-muted-low)", fontSize: 11, lineHeight: 1.6 }}>
                        <div>Price: ₱{(rewardPreviews[offer.id]?.pricePhp ?? offer.pricePhp).toFixed(2)}</div>
                        <div>Credits applied: {creditsToApply[offer.id] ?? 0} (−₱{(rewardPreviews[offer.id]?.discountPhp ?? 0).toFixed(2)})</div>
                        <div style={{ color: "var(--kiosk-accent-text)", fontWeight: 800 }}>
                          Amount to pay: ₱{(rewardPreviews[offer.id]?.amountDuePhp ?? offer.pricePhp).toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={rewardsBusyId !== null || !rewardPreviews[offer.id] || rewardPreviews[offer.id].creditsApplied !== (creditsToApply[offer.id] ?? 0)}
                        onClick={() => void submitReward(offer)}
                        style={{
                          width: "100%", marginTop: 9, padding: "8px 10px", borderRadius: 7,
                          border: "1px solid var(--kiosk-border-strong)", background: "var(--kiosk-surface-hover)",
                          color: "var(--kiosk-accent-text)", fontWeight: 700, cursor: "pointer",
                          opacity: rewardsBusyId !== null ? 0.55 : 1,
                        }}
                      >
                        {rewardsBusyId === offer.id ? "Submitting..." : rewardPreviews[offer.id]?.amountDuePhp === 0
                          ? "Redeem with credits"
                          : `Confirm - pay ₱${(rewardPreviews[offer.id]?.amountDuePhp ?? offer.pricePhp).toFixed(2)}`}
                      </button>
                    </article>
                  )) : !rewardsLoading && <div style={{ gridColumn: "1 / -1", color: "var(--kiosk-muted-low)", fontSize: 12 }}>There are no active offers right now.</div>}
                </div>

                {!!rewards?.redemptions.length && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--kiosk-muted-low)", marginBottom: 6 }}>YOUR REDEMPTIONS</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {rewards.redemptions.map(redemption => (
                        <div key={redemption.id} style={{ borderTop: "1px solid var(--kiosk-border)", paddingTop: 7, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div>
                            <strong style={{ fontSize: 12, color: "var(--kiosk-text)" }}>{redemption.rewardTitle}</strong>
                            <span style={{ fontSize: 11, color: "var(--kiosk-muted-low)" }}>
                              {" · "}{redemption.status} · ₱{redemption.pricePhp.toFixed(2)} · {redemption.creditsApplied} credits · −₱{redemption.discountPhp.toFixed(2)} · Pay ₱{redemption.amountDuePhp.toFixed(2)}
                            </span>
                            {redemption.resolutionNote && <div style={{ fontSize: 11, color: "var(--kiosk-muted-dim)" }}>{redemption.resolutionNote}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* credit & impact info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                <div style={statCard}>
                  <div style={statLabel}>Bottles deposited</div>
                  <div style={statVal}>{allTxns.filter(h => h.type === "deposit").length}</div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>Plastic Deposited in kg</div>
                  <div style={{ ...statVal, fontSize: 18, color: "var(--kiosk-success-text)" }}>
                    {(allTxns.filter(h => h.type === "deposit").reduce((a, h) => a + (h.weight_g ?? 0), 0) / 1000).toFixed(2)} kg
                  </div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>CO2e Avoided</div>
                  <div style={{ ...statVal, fontSize: 18, color: "var(--kiosk-info-text)" }}>
                    {(allTxns.filter(h => h.type === "deposit").reduce((total, transaction) => total + (transaction.weight_g ?? 0) * CO2E_KG_PER_KG_PET, 0)).toFixed(0)} g
                  </div>
                </div>
                <div style={statCard}>
                  <div style={statLabel}>Print jobs done</div>
                  <div style={statVal}>{allTxns.filter(h => h.type === "print").length}</div>
                </div>
              </div>

              {/* recent activity */}
              {history.length > 0 && (
                <div style={{ background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, color: "var(--kiosk-muted-low)", marginBottom: 12, fontWeight: 600, letterSpacing: 1 }}>
                    RECENT ACTIVITY
                  </div>
                  {history.map((h, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 0", borderBottom: i < history.length - 1 ? "1px solid var(--kiosk-surface-hover)" : "none",
                    }}>
                      <div>
                        <div style={{ fontSize: 13, color: "var(--kiosk-text-secondary)", display: "flex", alignItems: "center", gap: 7 }}>
                          {h.type === "deposit" && <><RecyclingIcon size={16} color="#2ecc71" /> Bottle deposited ({h.size ?? "—"}, {h.weight_g ?? 0}g)</>}
                          {h.type === "print" && <><PrintIcon size={16} color="#e74c3c" /> Print job voucher</>}
                          {h.type === "transfer_out" && <>Transferred credits</>}
                          {h.type === "transfer_in" && <>Received credits</>}
                          {h.type === "adjust" && <>Admin adjustment</>}
                          {h.type === "reward_request" && <>Reward request · credits reserved</>}
                          {h.type === "reward_return" && <>Reward credits returned</>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--kiosk-muted-dim)", marginTop: 2 }}>{new Date(h.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{
                        fontWeight: 700, fontSize: 14,
                        color: signedCredits(h) > 0 ? "var(--kiosk-success-text)" : signedCredits(h) < 0 ? "var(--kiosk-danger-text)" : "var(--kiosk-muted)",
                      }}>
                        {signedCredits(h) > 0 ? `+${signedCredits(h)}` : signedCredits(h) < 0 ? `-${Math.abs(signedCredits(h))}` : `0`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={onBack} style={backBtn}>Done</button>
            </div>
          )
        }
      </div>

      {/* Step 1: Transfer Search & Amount Modal */}
      {showTransfer && transferStep === "search" && (
        <div style={overlay}>
          <div style={{ ...modal, maxHeight: "calc(100% - 32px)", overflowY: "auto" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Transfer Credits</div>
            <div style={{ fontSize: 13, color: "var(--kiosk-muted-low)", marginBottom: 20 }}>Type recipient's name or student ID</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--kiosk-muted-secondary)", marginBottom: 4 }}>Find Recipient</div>
                {selectedRecipient ? (
                  <div style={{ 
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", background: "var(--kiosk-success-bg)", border: "1px solid var(--kiosk-success-text)", borderRadius: 8
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "var(--kiosk-text)", fontSize: 14 }}>{selectedRecipient.name}</div>
                      <div style={{ fontSize: 11, color: "var(--kiosk-muted)" }}>ID: {selectedRecipient.studentId || "None"}</div>
                    </div>
                    <button 
                      onClick={() => { setSelectedRecipient(null); setSearchQuery(""); }} 
                      style={{ background: "none", border: "none", color: "var(--kiosk-danger-text)", cursor: "pointer", fontWeight: 700 }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      data-kb="digits"
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Type name or student ID..."
                      style={inputStyle}
                      autoFocus
                    />
                    {searchResults.length > 0 && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, background: "var(--kiosk-surface)",
                        border: "1px solid var(--kiosk-muted-faint)", borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 150, overflowY: "auto"
                      }}>
                        {searchResults.map(r => (
                          <div
                            key={r.rfid}
                            onClick={() => {
                              setSelectedRecipient(r);
                              setSearchResults([]);
                              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                            }}
                            style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--kiosk-border)", fontSize: 13 }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--kiosk-text)" }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: "var(--kiosk-muted-secondary)" }}>ID: {r.studentId || "None"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedRecipient && (
                <div>
                  <div style={{ fontSize: 12, color: "var(--kiosk-muted-secondary)", marginBottom: 4 }}>Amount to Transfer</div>
                  <div
                    aria-live="polite"
                    aria-label={`Transfer amount: ${transferAmount || "not entered"} credits`}
                    style={transferAmountDisplay}
                  >
                    {transferAmount || <span style={{ color: "var(--kiosk-muted-low)" }}>Enter amount</span>}
                    {transferAmount && <span style={{ fontSize: 14, color: "var(--kiosk-muted-secondary)", marginLeft: 8 }}>credits</span>}
                  </div>
                  <div style={transferKeypad}>
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => (
                      <button key={digit} type="button" onClick={() => enterTransferDigit(digit)} style={transferKey}>
                        {digit}
                      </button>
                    ))}
                    <button type="button" onClick={clearTransferAmount} style={transferUtilityKey}>Clear</button>
                    <button type="button" onClick={() => enterTransferDigit("0")} style={transferKey}>0</button>
                    <button type="button" onClick={deleteTransferDigit} aria-label="Delete last digit" style={transferUtilityKey}>⌫</button>
                  </div>
                  <div style={{
                    display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8,
                    padding: "10px 12px", background: "var(--kiosk-input)", border: "1px solid var(--kiosk-border-strong)", borderRadius: 8,
                  }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--kiosk-muted-secondary)" }}>Available now</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--kiosk-accent-text)" }}>
                        {user?.credits ?? 0} credits
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--kiosk-muted-secondary)" }}>After transfer</div>
                      <div style={{
                        fontSize: 17, fontWeight: 700,
                        color: hasTransferAmount && remainingCredits < 0 ? "var(--kiosk-danger-text)" : "var(--kiosk-text)",
                      }}>
                        {hasTransferAmount && remainingCredits >= 0 ? `${remainingCredits} credits` : hasTransferAmount ? "Not enough" : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {transferMsg && (
              <div style={{ 
                background: transferMsg.startsWith("Successfully") ? "rgba(46, 204, 113, 0.1)" : "rgba(231, 76, 60, 0.15)",
                border: `1px solid ${transferMsg.startsWith("Successfully") ? "#2ecc71" : "var(--kiosk-danger-text)"}`,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13, 
                color: transferMsg.startsWith("Successfully") ? "var(--kiosk-success-text)" : "var(--kiosk-danger-text)",
                marginTop: 12,
                textAlign: "left",
                fontWeight: 600
              }}>
                {transferMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowTransfer(false)} style={ghostBtn}>Cancel</button>
              <button onClick={handleProceedToConfirm} disabled={!selectedRecipient || !transferAmount} style={confirmBtn}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Confirmation Prompt Modal */}
      {showTransfer && transferStep === "confirm" && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ marginBottom: 12 }}><AlertTriangleIcon size={36} color="#f0a500" /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Confirm Transfer</div>
            <div style={{ fontSize: 14, color: "var(--kiosk-text-secondary)", marginBottom: 24, lineHeight: 1.5 }}>
              Are you sure you want to transfer <strong style={{ color: "var(--kiosk-accent-text)" }}>{transferAmount} credits</strong> to <strong style={{ color: "var(--kiosk-text)" }}>{selectedRecipient?.name}</strong>?
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", marginBottom: 20,
              padding: "10px 12px", background: "var(--kiosk-input)", border: "1px solid var(--kiosk-border-strong)", borderRadius: 8,
              fontSize: 13, color: "var(--kiosk-muted)",
            }}>
              <span>Balance after transfer</span>
              <strong style={{ color: "var(--kiosk-accent-text)" }}>{remainingCredits} credits</strong>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setTransferStep("search")} style={ghostBtn}>Back</button>
              <button
                onClick={() => {
                  handleProceedToPin();
                }}
                style={confirmBtn}
              >
                Yes, Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Secure PIN Pad overlay for executing transfer */}
      {showTransfer && transferStep === "pin" && (
        <PINpad
          title="Enter PIN"
          subtitle={`Enter your 6-digit PIN to finalize transfer`}
          error={transferPinError}
          disabled={transferLoading}
          disabledMessage={transferLoading ? "Processing transfer..." : undefined}
          onSubmit={handleVerifyPinAndTransfer}
          onCancel={() => setTransferStep("confirm")}
        />
      )}
      {receipt && (
        <div role="dialog" aria-modal="true" aria-labelledby="reward-receipt-title" style={{ ...overlay, zIndex: 11000 }}>
          <div style={{ ...modal, maxWidth: 430 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>Redemption submitted</div>
            <h2 id="reward-receipt-title" style={{ margin: "0 0 16px", color: "var(--kiosk-text)" }}>{receipt.rewardTitle}</h2>
            <div style={{ display: "grid", gap: 8, textAlign: "left", color: "var(--kiosk-muted)" }}>
              <div>Price <strong style={{ float: "right", color: "var(--kiosk-text)" }}>₱{receipt.pricePhp.toFixed(2)}</strong></div>
              <div>Credits applied <strong style={{ float: "right", color: "var(--kiosk-text)" }}>{receipt.creditsApplied}</strong></div>
              <div>Discount <strong style={{ float: "right", color: "var(--kiosk-success-text)" }}>−₱{receipt.discountPhp.toFixed(2)}</strong></div>
              <div>Amount to pay <strong style={{ float: "right", color: "var(--kiosk-accent-text)" }}>₱{receipt.amountDuePhp.toFixed(2)}</strong></div>
            </div>
            <p style={{ color: "var(--kiosk-muted-low)", fontSize: 12, lineHeight: 1.5 }}>
              The organization will review your request and confirm payment and pickup. Returning home in 10 seconds.
            </p>
            <button type="button" onClick={() => { setReceipt(null); onBack(); }} style={confirmBtn}>Back to home</button>
          </div>
        </div>
      )}
    </div>
  );
}
const signedCredits = (h: any) =>
  h.type === "print" ? -Math.abs(h.credits) :
  h.type === "transfer_out" ? -Math.abs(h.credits)
  : h.type === "deposit" || h.type === "transfer_in" || h.type === "adjust" || h.type === "reward_return" ? h.credits
  : h.credits < 0 ? h.credits : 0;

const fullScreen: React.CSSProperties = {
  width: "100%", height: "100%", flex: 1, background: "var(--kiosk-bg)",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const smallButton: React.CSSProperties = {
  border: "1px solid var(--kiosk-border-strong)",
  background: "var(--kiosk-surface-hover)",
  color: "var(--kiosk-text)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
const header: React.CSSProperties = {
  padding: "14px 24px", borderBottom: "1px solid var(--kiosk-surface-hover)",
  display: "flex", alignItems: "center", gap: 12, paddingLeft: 80,
  flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "var(--kiosk-text)" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "var(--kiosk-muted-dim)" };
const body: React.CSSProperties = {
  flex: 1, minHeight: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16,
  overflowY: "auto",
};
const scrollWrap: React.CSSProperties = {
  width: "100%", maxWidth: 580, overflow: "visible",
  display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box",
};
const profileCard: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 14,
  padding: "20px 24px", display: "flex", alignItems: "center", gap: 16,
};
const avatar: React.CSSProperties = {
  width: 52, height: 52, borderRadius: "50%", background: "var(--kiosk-accent-text)",
  color: "#000", fontWeight: 800, fontSize: 22,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const statCard: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-border)", borderRadius: 12,
  padding: "14px 18px",
};
const statLabel: React.CSSProperties = { fontSize: 11, color: "var(--kiosk-muted-low)", marginBottom: 4 };
const statVal: React.CSSProperties = { fontSize: 26, fontWeight: 700, color: "var(--kiosk-text)" };
const backBtn: React.CSSProperties = {
  padding: "12px", borderRadius: 10, background: "var(--kiosk-accent-text)",
  color: "#000", fontWeight: 700, fontSize: 15, border: "none",
  cursor: "pointer", width: "100%",
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "var(--kiosk-surface)", border: "1px solid var(--kiosk-muted-faint)", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 380, width: "100%",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "var(--kiosk-input)",
  border: "1px solid var(--kiosk-border-strong)", borderRadius: 8, color: "var(--kiosk-text)",
  fontSize: 15, outline: "none", boxSizing: "border-box",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "var(--kiosk-muted)",
  border: "1px solid var(--kiosk-border-strong)", cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 700,
  fontSize: 14, background: "var(--kiosk-accent-text)", color: "#000",
  border: "none", cursor: "pointer",
};
const transferAmountDisplay: React.CSSProperties = {
  minHeight: 56, display: "flex", alignItems: "center", justifyContent: "center",
  padding: "8px 14px", marginBottom: 8, background: "var(--kiosk-deep)",
  border: "1px solid var(--kiosk-muted-dim)", borderRadius: 8, color: "var(--kiosk-text)",
  fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums",
};
const transferKeypad: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8,
};
const transferKey: React.CSSProperties = {
  height: 48, borderRadius: 8, border: "1px solid var(--kiosk-muted-faint)", background: "var(--kiosk-border)",
  color: "var(--kiosk-text)", fontSize: 22, fontWeight: 700, cursor: "pointer", touchAction: "manipulation",
};
const transferUtilityKey: React.CSSProperties = {
  ...transferKey, background: "var(--kiosk-surface)", color: "var(--kiosk-accent-text)", fontSize: 15,
};