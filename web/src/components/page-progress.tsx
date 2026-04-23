"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function PageProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    // Start progress on route change
    setVisible(true);
    setProgress(30);

    const mid = setTimeout(() => setProgress(70), 100);
    const end = setTimeout(() => setProgress(100), 300);
    const hide = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 500);

    timeoutRef.current = hide;

    return () => {
      clearTimeout(mid);
      clearTimeout(end);
      clearTimeout(hide);
    };
  }, [pathname]);

  if (!visible && progress === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[110] h-0.5 bg-primary/20"
      role="progressbar"
      aria-valuenow={progress}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{ width: `${progress}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
