import { useState } from "react";

interface Props {
  context: "print" | "deposit" | "general";
  rfid?: string | null;
  onClose: () => void;
}

const API = "http://localhost:4000";

export default function FeedbackModal({ context, rfid, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      await fetch(`${API}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid: rfid ?? null, context, rating, comment: comment.trim() }),
      });
    } catch {
      // feedback is non-critical — fail silently
    }
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(onClose, 1200);
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <button onClick={onClose} style={closeBtn} aria-label="Skip feedback">✕</button>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🙏</div>
            <div style={{ fontSize: 16, color: "#2ecc71", fontWeight: 700 }}>Thanks for your feedback!</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>
              How was your experience?
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 20, textAlign: "center" }}>
              {context === "print" && "Rate your printing experience"}
              {context === "deposit" && "Rate your bottle deposit experience"}
              {context === "general" && "Tell us how we're doing"}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 32, padding: 2,
                    color: (hover || rating) >= n ? "#f0a500" : "#3a3a3a",
                    transition: "color 0.15s",
                  }}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything you'd like to tell us? (optional)"
              rows={3}
              style={textarea}
            />

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={onClose} style={ghostBtn}>Skip</button>
              <button
                onClick={handleSubmit}
                disabled={rating === 0 || submitting}
                style={{
                  flex: 1, padding: "12px", borderRadius: 10, fontWeight: 700,
                  fontSize: 14, border: "none",
                  cursor: rating === 0 || submitting ? "not-allowed" : "pointer",
                  background: rating === 0 || submitting ? "#333" : "#f0a500",
                  color: rating === 0 || submitting ? "#555" : "#000",
                }}
              >
                {submitting ? "Sending..." : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
};
const modal: React.CSSProperties = {
  position: "relative",
  background: "#242424", border: "1px solid #444", borderRadius: 16,
  padding: "32px 32px 24px", textAlign: "center", maxWidth: 400, width: "100%",
};
const closeBtn: React.CSSProperties = {
  position: "absolute", top: 12, right: 14,
  background: "none", border: "none", color: "#666",
  fontSize: 18, cursor: "pointer", lineHeight: 1,
};
const textarea: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "#1e1e1e",
  border: "1px solid #3a3a3a", borderRadius: 8, color: "#fff",
  fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "12px", borderRadius: 10, fontWeight: 600,
  fontSize: 14, background: "transparent", color: "#aaa",
  border: "1px solid #3a3a3a", cursor: "pointer",
};