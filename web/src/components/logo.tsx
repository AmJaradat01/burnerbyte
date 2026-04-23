import { cn } from "@/lib/utils";

const sizeClass = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
} as const;

interface LogoProps {
  collapsed?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Logo({ collapsed, size = "md" }: LogoProps) {
  if (collapsed) {
    return <span className="text-lg font-bold text-primary">B</span>;
  }

  return (
    <span className={cn("font-bold tracking-tight", sizeClass[size])}>
      Burner<span className="text-primary">Byte</span>
    </span>
  );
}
