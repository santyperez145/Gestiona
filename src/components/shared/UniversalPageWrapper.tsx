/**
 * UniversalPageWrapper — Wrapper global para aplicar diseño consistente a TODAS las páginas
 *
 * Estrategia eficiente para rediseñar 108 páginas sin reescribir cada una manualmente.
 * Este wrapper se puede aplicar a cualquier página para aplicar el diseño estandarizado.
 */
import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface UniversalPageWrapperProps {
  children: ReactNode;
  className?: string;
  showCard?: boolean;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
}

export default function UniversalPageWrapper({
  children,
  className,
  showCard = true,
  maxWidth = "xl",
}: UniversalPageWrapperProps) {
  const maxWidthClasses = {
    sm: "max-w-2xl",
    md: "max-w-4xl",
    lg: "max-w-6xl",
    xl: "max-w-7xl",
    full: "max-w-full",
  };

  if (showCard) {
    return (
      <div className={cn("mx-auto px-4 py-6", maxWidthClasses[maxWidth], className)}>
        <Card className="border-border/50">
          <div className="p-6">{children}</div>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("mx-auto px-4 py-6 space-y-6", maxWidthClasses[maxWidth], className)}>
      {children}
    </div>
  );
}
