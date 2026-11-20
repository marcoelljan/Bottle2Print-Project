import { useState, useEffect } from "react";
import HomeScreen from "./screens/Homescreen";
import PrintScreen from "./screens/Printscreen";
import CheckBalanceScreen from "./screens/CheckBalanceScreen";
import DepositScreen from "./screens/DepositScreen";
import RegisterScreen from "./screens/RegisterScreen";
import AdminScreen from "./screens/AdminScreen";

export type Screen = "home" | "print" | "balance" | "deposit" | "register" | "admin";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const savedTheme = window.localStorage.getItem("kiosk-theme");
    return savedTheme === "light" ? "light" : "dark";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // If the URL specifies the admin screen, includes a reset token from Gmail,
    // or the path is /admin, open admin directly
    if (
      params.get("screen") === "admin" ||
      params.get("reset_token") ||
      window.location.pathname === "/admin"
    ) {
      setScreen("admin");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.kioskTheme = theme;
    window.localStorage.setItem("kiosk-theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.getElementById("kiosk-app");
    if (!root) return;

    const canScroll = (element: HTMLElement, delta: number) => {
      if (element.scrollHeight <= element.clientHeight) return false;
      return delta > 0
        ? element.scrollTop < element.scrollHeight - element.clientHeight
        : element.scrollTop > 0;
    };

    const findScrollTarget = (origin: EventTarget | null, delta: number) => {
      let element = origin instanceof HTMLElement ? origin : null;
      while (element && root.contains(element)) {
        const overflowY = window.getComputedStyle(element).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && canScroll(element, delta)) {
          return element;
        }
        element = element.parentElement;
      }

      const page = root.querySelector<HTMLElement>(".kiosk-page-scroll");
      return page && canScroll(page, delta) ? page : null;
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      const target = findScrollTarget(event.target, event.deltaY);
      if (!target) return;
      event.preventDefault();
      target.scrollTop += event.deltaY;
    };

    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) return;
      const nextY = event.touches[0].clientY;
      const delta = touchY - nextY;
      touchY = nextY;
      if (!delta) return;

      const target = findScrollTarget(event.target, delta);
      if (!target) return;
      event.preventDefault();
      target.scrollTop += delta;
    };
    const onTouchEnd = () => { touchY = null; };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const go = (s: Screen) => setScreen(s);
  const home = () => setScreen("home");

  return (
    <div id="kiosk-app" data-kiosk-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {screen === "home"     && <HomeScreen onNavigate={go} />}
      {screen === "print"    && <PrintScreen onBack={home} />}
      {screen === "balance"  && <CheckBalanceScreen onBack={home} />}
      {screen === "deposit"  && <DepositScreen onBack={home} onNavigate={go} />}
      {screen === "register" && <RegisterScreen onBack={home} />}
      {screen === "admin"    && <AdminScreen theme={theme} onToggleTheme={() => setTheme(current => current === "dark" ? "light" : "dark")} />}
      {screen !== "admin" && <button
        type="button"
        role="switch"
        aria-checked={theme === "light"}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}
        style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 50,
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
          borderRadius: 999, border: "1px solid var(--kiosk-border-strong)",
          background: "var(--kiosk-surface)", color: "var(--kiosk-text)",
          fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}
      >
        {theme === "dark" ? "Dark mode" : "Light mode"}
      </button>}
    </div>
  );
}