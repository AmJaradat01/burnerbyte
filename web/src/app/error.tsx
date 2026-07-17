"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Error({ error: _error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">An unexpected error occurred. Please try again.</p>
      </div>
      <Button variant="outline" onClick={reset}>Try again</Button>
    </div>
  );
}
