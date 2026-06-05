"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface ShortcutMap {
  [key: string]: () => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  // Keep the latest map in a ref so the keydown listener is registered once
  // instead of re-attached on every render when callers pass an inline object.
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => { shortcutsRef.current = shortcuts; });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const fn = shortcutsRef.current[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

export function useShortcutHelp() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggle };
}
