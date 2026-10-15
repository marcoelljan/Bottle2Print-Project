import { useEffect, useState } from "react";
import { API } from "../config";

// Returns { feature: message } for every part that is switched off
export default function useKioskControls() {
  const [off, setOff] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${API}/api/kiosk/controls`);
        if (!r.ok) return;
        const next: Record<string, string> = {};
        for (const c of await r.json()) if (c.disabled) next[c.feature] = c.message;
        setOff(next);
      } catch {}
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  return off;
}