import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}

export function EmptyState({ title, description, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      {action && (
        <Button className="mt-5" onClick={action.onClick}>{action.label}</Button>
      )}
      {children}
    </div>
  );
}
