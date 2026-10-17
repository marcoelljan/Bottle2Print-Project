import { useEffect, useRef, useState } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = ["text", "email", "search", "tel", "url", "password", "number", ""];
const DIGITS = "1234567890".split("");
const LETTER_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map(r => r.split(""));
const SYMBOL_ROWS = [
  ["-", "_", "/", ":", ";", "(", ")", "&", "@", '"'],
  [".", ",", "?", "!", "'", "#", "%", "+", "="],
];

// Only the kiosk itself (Chromium opens http://localhost:4000) gets the keyboard.
// Phones and laptops reaching the app over Tailscale, 10.42.0.1 or bottle2print.admin never do.
// ?kb=0 turns it off (handy on a dev laptop), ?kb=1 forces it on elsewhere for testing.
function keyboardWanted() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("kb") === "0") return false;
  if (p.get("kb") === "1") return true;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function isTextField(el: Element | null): el is Field {
  if (!el) return false;
  if (el.closest("[data-nokb]")) return false;               // admin panel, PIN screens, anything marked
  if ((el as HTMLElement).getAttribute("inputmode") === "none") return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.includes(el.type) && !el.readOnly && !el.disabled;
  return false;
}

const isWordField = (f: Field) => f instanceof HTMLTextAreaElement || f.type === "text" || f.type === "";
const isNumericField = (f: Field) => f instanceof HTMLInputElement && (f.type === "number" || f.type === "tel" || f.dataset.kb === "numeric");
const wantsDigitRow = (f: Field) => f.dataset.kb === "digits";   // e.g. student ID: letters plus a number row

// Sets the value in a way React's controlled inputs notice
function setValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export default function OnScreenKeyboard() {
  const [wanted] = useState(keyboardWanted);
  const [field, setField] = useState<Field | null>(null);
  const [symbols, setSymbols] = useState(false);
  const [shift, setShift] = useState(false);
  const kbRef = useRef<HTMLDivElement>(null);
  const open = wanted && !!field;

  useEffect(() => {
    if (!wanted) return;
    const onIn = (e: FocusEvent) => {
      const t = e.target as Element;
      if (!isTextField(t)) return;
      setField(t);
      setSymbols(false);
      setShift(isWordField(t) && t.value === "");
      setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    };
    const onOut = () => setTimeout(() => { if (!isTextField(document.activeElement)) setField(null); }, 150);
    const gone = setInterval(() => setField(f => (f && !document.body.contains(f) ? null : f)), 500);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      clearInterval(gone);
    };
  }, [wanted]);

  // Shrink the app above the keyboard instead of letting the keyboard cover it
  useEffect(() => {
    const root = document.getElementById("root") ?? document.body;
    if (!open) { root.style.paddingBottom = ""; return; }
    const el = kbRef.current;
    if (!el) return;
    root.style.boxSizing = "border-box";
    const apply = () => {
      root.style.paddingBottom = el.offsetHeight + "px";
      field?.scrollIntoView({ block: "center" });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.paddingBottom = ""; };
  }, [open]);

  if (!open || !field) return null;

  const numeric = isNumericField(field);
  const digitRowOnTop = !numeric && !symbols && wantsDigitRow(field);

  const press = (k: string) => {
    let v = field.value;
    if (k === "BACK") v = v.slice(0, -1);
    else {
      if (field.maxLength > 0 && v.length >= field.maxLength) return;
      v += shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
    }
    setValue(field, v);
    setShift(isWordField(field) && (v === "" || k === " "));   // capital at the start and after a space
    field.focus();
  };

  const act = (k: string) => {
    if (k === "SHIFT") setShift(s => !s);
    else if (k === "SYM") setSymbols(s => !s);
    else if (k === "DONE") { field.blur(); setField(null); }
    else press(k);
  };

  const label = (k: string) => (!symbols && shift ? k.toUpperCase() : k);
  const btn = (k: string, text?: string, flex = 1, hot = false) => (
    <button
      key={k + (text ?? "")}
      onPointerDown={e => { e.preventDefault(); act(k); }}
      onMouseDown={e => e.preventDefault()}
      style={{ ...keyStyle, flex, ...(hot ? { background: "#f0a500", color: "#000" } : {}) }}
    >
      {text ?? label(k)}
    </button>
  );

  return (
    <div
      ref={kbRef}
      onPointerDown={e => e.preventDefault()}
      onMouseDown={e => e.preventDefault()}
      style={wrap}
    >
      {numeric ? (
        <div style={rowStyle}>{DIGITS.map(d => btn(d))}{btn("BACK", "Del", 1.6)}{btn("DONE", "Done", 1.6, true)}</div>
      ) : (
        <>
          {(symbols || digitRowOnTop) && <div style={rowStyle}>{DIGITS.map(d => btn(d))}</div>}
          {symbols ? (
            <>
              <div style={rowStyle}>{SYMBOL_ROWS[0].map(k => btn(k))}</div>
              <div style={rowStyle}>{SYMBOL_ROWS[1].map(k => btn(k))}{btn("BACK", "Del", 1.6)}</div>
            </>
          ) : (
            <>
              <div style={rowStyle}>{LETTER_ROWS[0].map(k => btn(k))}</div>
              <div style={{ ...rowStyle, padding: "0 4%" }}>{LETTER_ROWS[1].map(k => btn(k))}</div>
              <div style={rowStyle}>{btn("SHIFT", "Shift", 1.6, shift)}{LETTER_ROWS[2].map(k => btn(k))}{btn("BACK", "Del", 1.6)}</div>
            </>
          )}
          <div style={rowStyle}>
            {btn("SYM", symbols ? "abc" : "?123", 1.5)}{btn(",")}{btn(" ", "space", 5)}{btn(".")}{btn("-")}{btn("DONE", "Done", 1.5, true)}
          </div>
        </>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 99999, background: "#161616",
  borderTop: "2px solid #f0a500", padding: "6px 10px 1px", boxSizing: "border-box",
  userSelect: "none", fontFamily: "'Inter', 'Segoe UI', sans-serif",
};
const rowStyle: React.CSSProperties = { display: "flex", gap: 5, marginBottom: 5 };
const keyStyle: React.CSSProperties = {
  height: 42, minWidth: 0, borderRadius: 8, border: "1px solid #3a3a3a", background: "#2a2a2a",
  color: "#fff", fontSize: 18, fontWeight: 600, cursor: "pointer", padding: 0, touchAction: "manipulation",
};