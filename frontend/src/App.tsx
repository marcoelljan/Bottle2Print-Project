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

    const scrollAxes = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return {
        vertical: ["auto", "scroll", "overlay"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight,
        horizontal: ["auto", "scroll", "overlay"].includes(style.overflowX) &&
          element.scrollWidth > element.clientWidth,
      };
    };

    const markScrollable = (element: Element) => {
      if (!(element instanceof HTMLElement)) return;
      const style = window.getComputedStyle(element);
      const isScrollable = ["auto", "scroll", "overlay"].includes(style.overflowY) ||
        ["auto", "scroll", "overlay"].includes(style.overflowX);
      element.classList.toggle("touch-scrollable", isScrollable);
    };

    const scanSubtree = (element: Element) => {
      markScrollable(element);
      element.querySelectorAll("*").forEach(markScrollable);
    };

    const getFallbackScrollTargets = () => {
      const page = root.querySelector<HTMLElement>(".kiosk-page-scroll");
      const scrollables = Array.from(root.querySelectorAll<HTMLElement>(".touch-scrollable"));
      return page
        ? [page, ...scrollables.filter(element => element !== page)]
        : scrollables;
    };

    scanSubtree(root);
    const pendingRoots = new Set<Element>();
    let scanScheduled = false;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") {
          pendingRoots.add(record.target as Element);
          continue;
        }
        record.addedNodes.forEach(node => {
          if (node instanceof Element) pendingRoots.add(node);
        });
      }

      if (scanScheduled) return;
      scanScheduled = true;
      requestAnimationFrame(() => {
        scanScheduled = false;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        roots.forEach(scanSubtree);
      });
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const canScroll = (element: HTMLElement, axis: "x" | "y", delta: number) => {
      const axes = scrollAxes(element);
      if (axis === "y" && !axes.vertical) return false;
      if (axis === "x" && !axes.horizontal) return false;
      const position = axis === "y" ? element.scrollTop : element.scrollLeft;
      const extent = axis === "y"
        ? element.scrollHeight - element.clientHeight
        : element.scrollWidth - element.clientWidth;
      return delta > 0 ? position < extent : position > 0;
    };

    const findScrollTarget = (origin: EventTarget | null, axis: "x" | "y", delta: number) => {
      let element = origin instanceof Element ? origin : null;
      while (element && root.contains(element)) {
        if (element instanceof HTMLElement && canScroll(element, axis, delta)) return element;
        element = element.parentElement;
      }

      return getFallbackScrollTargets().find(candidate => canScroll(candidate, axis, delta)) ?? null;
    };

    const onWheel = (event: WheelEvent) => {
      const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
      const delta = axis === "y" ? event.deltaY : event.deltaX;
      if (!delta) return;
      const target = findScrollTarget(event.target, axis, delta);
      if (!target) return;
      event.preventDefault();
      if (axis === "y") target.scrollTop += delta;
      else target.scrollLeft += delta;
    };

    const excludedFromDrag = "input, textarea, select, [contenteditable='true'], [role='slider']";
    let activeDrag: {
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      candidates: HTMLElement[];
      startOffsets: Map<HTMLElement, { x: number; y: number }>;
      axis: "x" | "y" | null;
      dragged: boolean;
    } | null = null;
    let suppressClick = false;
    let suppressClickTimer = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const origin = event.target instanceof Element ? event.target : null;
      if (!origin || origin.closest(excludedFromDrag)) return;

      const candidates: HTMLElement[] = [];
      let element: Element | null = origin;
      while (element && root.contains(element)) {
        if (element instanceof HTMLElement) {
          const axes = scrollAxes(element);
          if (axes.vertical || axes.horizontal) candidates.push(element);
        }
        element = element.parentElement;
      }
      if (candidates.length === 0) {
        candidates.push(...getFallbackScrollTargets().filter(candidate => {
          const axes = scrollAxes(candidate);
          return axes.vertical || axes.horizontal;
        }));
      }
      if (candidates.length === 0) return;

      activeDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        candidates,
        startOffsets: new Map(candidates.map(candidate => [
          candidate,
          { x: candidate.scrollLeft, y: candidate.scrollTop },
        ])),
        axis: null,
        dragged: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = activeDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moveX = event.clientX - drag.startX;
      const moveY = event.clientY - drag.startY;
      if (!drag.axis) {
        if (Math.max(Math.abs(moveX), Math.abs(moveY)) <= 5) return;
        drag.axis = Math.abs(moveX) > Math.abs(moveY) ? "x" : "y";
      }

      const delta = drag.axis === "y" ? event.clientY - drag.lastY : event.clientX - drag.lastX;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (!delta) return;

      const totalDelta = drag.axis === "y" ? moveY : moveX;
      const target = drag.candidates.find(candidate => {
        if (!root.contains(candidate)) return false;
        const startOffset = drag.startOffsets.get(candidate);
        if (!startOffset) return false;
        const currentOffset = drag.axis === "y" ? candidate.scrollTop : candidate.scrollLeft;
        const initialOffset = drag.axis === "y" ? startOffset.y : startOffset.x;
        const extent = drag.axis === "y"
          ? candidate.scrollHeight - candidate.clientHeight
          : candidate.scrollWidth - candidate.clientWidth;
        const desiredOffset = Math.max(0, Math.min(extent, initialOffset - totalDelta));
        return desiredOffset !== currentOffset;
      });
      if (!target) return;

      event.preventDefault();
      const startOffset = drag.startOffsets.get(target);
      if (!startOffset) return;
      if (drag.axis === "y") target.scrollTop = startOffset.y - moveY;
      else target.scrollLeft = startOffset.x - moveX;
      drag.dragged = true;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      if (event.type === "pointerup" && activeDrag.dragged) {
        suppressClick = true;
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = window.setTimeout(() => { suppressClick = false; }, 0);
      }
      activeDrag = null;
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const onContextMenu = (event: Event) => event.preventDefault();
    const onSelectStart = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("input, textarea")) event.preventDefault();
    };

    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("selectstart", onSelectStart, true);
    return () => {
      observer.disconnect();
      window.clearTimeout(suppressClickTimer);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("selectstart", onSelectStart, true);
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