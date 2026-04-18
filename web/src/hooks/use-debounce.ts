"use client";

import { useState, useEffect } from "react";

/**
 * Debounces a value by the given delay in milliseconds.
 * Returns the debounced value that only updates after the delay has passed
 * since the last change.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
