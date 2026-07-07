

interface Props {
  onBack: () => void;
}

export default function BackButton({ onBack }: Props) {
  return (
    <button
      onClick={onBack}
      style={{
        position: "absolute",
        top: 14,
        left: 16,
        zIndex: 50,
        width: 52,
        height: 52,
        borderRadius: 12,
        background: "#242424",
        border: "1px solid #333",
        color: "#f0a500",
        fontSize: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "border-color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#f0a500")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#333")}
      aria-label="Back"
    >
      ←
    </button>
  );
}