"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/time";

interface RelativeTimeProps {
  datetime: string;
}

export function RelativeTime({ datetime }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const text = timeAgo(datetime, now);

  return (
    <time dateTime={datetime} title={datetime}>
      {text}
    </time>
  );
}
