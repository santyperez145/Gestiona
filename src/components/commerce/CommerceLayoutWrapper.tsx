/**
 * CommerceLayoutWrapper — Wrapper para aplicar diseño consistente a páginas de Commerce
 *
 * Estrategia eficiente para rediseñar TODAS las páginas sin reescribir cada una manualmente.
 * Este wrapper aplica el diseño estandarizado alrededor del contenido existente.
 */
import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CommerceLayoutWrapperProps {
  children: ReactNode;
  className?: string;
  showCard?: boolean;
}

export default function CommerceLayoutWrapper({
  children,
  className,
  showCard = true,
}: CommerceLayoutWrapperProps) {
  if (showCard) {
    return (
      <Card className={cn("border-border/50", className)}>
        <div className="p-6">{children}</div>
      </Card>
    );
  }

  return <div className={cn("space-y-6", className)}>{children}</div>;
}
