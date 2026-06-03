"use client";

import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Error({ error: _error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <span className="text-4xl">⚠️</span>
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">Something went wrong. Please try again or contact support.</p>
      <Button variant="outline" onClick={reset}>Try again</Button>
    </div>
  );
}
