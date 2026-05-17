import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  illustration?: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}

export function EmptyState({ icon, illustration, title, description, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-in fade-in duration-300">
      {illustration ? (
        <div className="mb-6">{illustration}</div>
      ) : icon ? (
        <span className="text-4xl mb-6" role="img" aria-label={title}>{icon}</span>
      ) : (
        <div className="mb-6 h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
          <span className="text-2xl text-muted-foreground/60">∅</span>
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      {action && (
        <Button className="mt-5" onClick={action.onClick}>{action.label}</Button>
      )}
      {children}
    </div>
  );
}
