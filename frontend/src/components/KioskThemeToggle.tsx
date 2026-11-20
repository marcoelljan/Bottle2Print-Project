interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export default function KioskThemeToggle({ theme, onToggleTheme }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "light"}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={onToggleTheme}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
        borderRadius: 999, border: "1px solid var(--kiosk-border-strong)", background: "var(--kiosk-surface)",
        color: "var(--kiosk-text)", fontSize: 16, fontWeight: 700, cursor: "pointer",
      }}
    >
      <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
      <span style={{
        width: 46, height: 26, padding: 3, borderRadius: 999,
        background: theme === "light" ? "var(--kiosk-accent-text)" : "var(--kiosk-muted-dim)",
        display: "flex", alignItems: "center", justifyContent: theme === "light" ? "flex-end" : "flex-start",
        boxSizing: "border-box",
      }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--kiosk-text)" }} />
      </span>
    </button>
  );
}
