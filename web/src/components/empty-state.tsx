import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}

export function EmptyState({ icon = "📭", title, description, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-4xl mb-4" role="img" aria-label={title}>{icon}</span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && (
        <Button className="mt-4" onClick={action.onClick}>{action.label}</Button>
      )}
      {children}
    </div>
  );
}
