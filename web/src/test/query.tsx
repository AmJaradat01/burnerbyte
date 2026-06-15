import { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// renderWithClient wraps a component in a fresh React Query client configured
// for tests (no retries, no refetching) so query-driven components can be
// rendered and asserted against with React Testing Library.
export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
