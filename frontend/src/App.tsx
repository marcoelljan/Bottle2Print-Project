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

    let activePointer: number | null = null;
    let pointerY = 0;
    let pointerOrigin: EventTarget | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      activePointer = event.pointerId;
      pointerY = event.clientY;
      pointerOrigin = event.target;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      const delta = pointerY - event.clientY;
      pointerY = event.clientY;
      if (!delta) return;

      const target = findScrollTarget(pointerOrigin, delta);
      if (!target) return;
      event.preventDefault();
      target.scrollTop += delta;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      pointerOrigin = null;
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove, { passive: false });
    root.addEventListener("pointerup", onPointerEnd);
    root.addEventListener("pointercancel", onPointerEnd);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerEnd);
      root.removeEventListener("pointercancel", onPointerEnd);
    };
  }, []);

  const go = (s: Screen) => setScreen(s);
  const home = () => setScreen("home");
  const toggleTheme = () => setTheme(current => current === "dark" ? "light" : "dark");

  return (
    <div id="kiosk-app" data-kiosk-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {screen === "home"     && <HomeScreen
        onNavigate={go}
        theme={theme}
        onToggleTheme={toggleTheme}
      />}
      {screen === "print"    && <PrintScreen onBack={home} theme={theme} onToggleTheme={toggleTheme} />}
      {screen === "balance"  && <CheckBalanceScreen onBack={home} theme={theme} onToggleTheme={toggleTheme} />}
      {screen === "deposit"  && <DepositScreen onBack={home} onNavigate={go} theme={theme} onToggleTheme={toggleTheme} />}
      {screen === "register" && <RegisterScreen onBack={home} theme={theme} onToggleTheme={toggleTheme} />}
      {screen === "admin"    && <AdminScreen theme={theme} onToggleTheme={toggleTheme} />}
    </div>
  );
}