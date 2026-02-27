"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
