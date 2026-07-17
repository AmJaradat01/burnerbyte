import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  /** Optional Lucide icon component displayed above the title. */
  icon?: LucideIcon;
  /** Variant controls the overall size and emphasis. */
  variant?: "default" | "compact" | "full-page";
  action?: { label: string; onClick: () => void };
  children?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  variant = "default",
  action,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "compact" && "py-10",
        variant === "default" && "py-16",
        variant === "full-page" && "py-24",
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-4 flex items-center justify-center rounded-xl bg-muted/60",
            variant === "compact" ? "h-10 w-10" : "h-12 w-12",
          )}
        >
          <Icon
            className={cn(
              "text-muted-foreground",
              variant === "compact" ? "h-5 w-5" : "h-6 w-6",
            )}
            aria-hidden="true"
          />
        </div>
      )}
      <h3
        className={cn(
          "font-semibold",
          variant === "compact" ? "text-sm" : "text-base",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "mt-1.5 leading-relaxed text-muted-foreground",
          variant === "compact"
            ? "max-w-xs text-xs"
            : "max-w-sm text-sm",
        )}
      >
        {description}
      </p>
      {action && (
        <Button
          className="mt-5"
          size={variant === "compact" ? "sm" : "default"}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}
