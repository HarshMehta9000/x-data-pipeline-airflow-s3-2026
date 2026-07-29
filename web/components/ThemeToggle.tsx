"use client";

import { useSyncExternalStore, useCallback } from "react";

/*
  The theme lives on the document element, so read it from there with
  useSyncExternalStore rather than mirroring it into state from an effect.
*/
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

export function useTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, getSnapshot, () => "light");
}

export function ThemeToggle() {
  const theme = useTheme();
  const toggle = useCallback(() => {
    const next =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("xdp-theme", next);
    } catch {
      /* private mode, the stamp on the element is enough */
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="fixed right-4 top-4 z-50 flex h-9 items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-12 text-muted transition-colors duration-200 hover:text-ink"
    >
      <span aria-hidden="true">{theme === "dark" ? "◐" : "◑"}</span>
      <span>{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
