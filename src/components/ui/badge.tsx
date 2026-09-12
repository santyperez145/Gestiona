/**
 * Nerqia Badge — Badge con estilo propio
 *
 * API compatible con shadcn/ui Badge:
 * - variant: default | secondary | destructive | outline | success | warning
 * - size: default | sm | lg
 */
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "blue";
  size?: "default" | "sm" | "lg";
}

const badgeVariants = {
  default: "border bg-primary/15 text-primary",
  secondary: "border bg-secondary/15 text-secondary",
  destructive: "border bg-destructive/15 text-destructive",
  outline: "border border-border/60 text-muted-foreground bg-transparent",
  success: "border bg-emerald-500/15 text-emerald-500",
  warning: "border bg-yellow-500/15 text-yellow-500",
  blue: "border bg-blue-500/15 text-blue-500",
};

const badgeSizes = {
  default: "h-5 px-2 py-0.5 text-xs font-medium",
  sm: "h-4 px-1.5 text-[9px] font-medium",
  lg: "h-6 px-3 py-1 text-sm font-semibold",
};

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", size = "default", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border border-border/30",
          badgeVariants[variant],
          badgeSizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
export default Badge;