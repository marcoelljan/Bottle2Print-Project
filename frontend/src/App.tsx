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

  const go = (s: Screen) => setScreen(s);
  const home = () => setScreen("home");

  return (
    <div id="kiosk-app" data-kiosk-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {screen === "home"     && <HomeScreen onNavigate={go} theme={theme} onToggleTheme={() => setTheme(current => current === "dark" ? "light" : "dark")} />}
      {screen === "print"    && <PrintScreen onBack={home} />}
      {screen === "balance"  && <CheckBalanceScreen onBack={home} />}
      {screen === "deposit"  && <DepositScreen onBack={home} onNavigate={go} />}
      {screen === "register" && <RegisterScreen onBack={home} />}
      {screen === "admin"    && <AdminScreen onBack={home} />}
    </div>
  );
}