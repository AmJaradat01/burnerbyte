"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/time";

interface RelativeTimeProps {
  datetime: string;
}

export function RelativeTime({ datetime }: RelativeTimeProps) {
  const [text, setText] = useState(() => timeAgo(datetime));

  useEffect(() => {
    setText(timeAgo(datetime));

    const interval = setInterval(() => {
      setText(timeAgo(datetime));
    }, 60_000);

    return () => clearInterval(interval);
  }, [datetime]);

  return (
    <time dateTime={datetime} title={datetime}>
      {text}
    </time>
  );
}
