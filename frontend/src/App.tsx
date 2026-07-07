import { useState } from "react";
import HomeScreen from "./screens/Homescreen";
import PrintScreen from "./screens/Printscreen";
import CheckBalanceScreen from "./screens/CheckBalanceScreen";
import DepositScreen from "./screens/DepositScreen";
import RegisterScreen from "./screens/RegisterScreen";
import AdminScreen from "./screens/AdminScreen";

export type Screen = "home" | "print" | "balance" | "deposit" | "register" | "admin";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");

  const go = (s: Screen) => setScreen(s);
  const home = () => setScreen("home");

  return (
    <>
      {screen === "home"     && <HomeScreen onNavigate={go} />}
      {screen === "print"    && <PrintScreen onBack={home} />}
      {screen === "balance"  && <CheckBalanceScreen onBack={home} />}
      {screen === "deposit"  && <DepositScreen onBack={home} />}
      {screen === "register" && <RegisterScreen onBack={home} />}
      {screen === "admin"    && <AdminScreen onBack={home} />}
    </>
  );
}
