/**
 * FieldHint — ayuda descubrible para campos de configuración.
 *
 * Los textos de ayuda estáticos de 11px nadie los lee. Un icono `?` junto al
 * label con tooltip al hover/tap hace la ayuda descubrible sin ocupar lugar,
 * igual que Shopify/Tiendanube en sus formularios de configuración.
 *
 * El tooltip abre con click (no sólo hover) para que sea usable en móvil.
 */
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface FieldHintProps {
  /** Texto de ayuda. Se muestra en el tooltip. */
  text: string;
}

export default function FieldHint({ text }: FieldHintProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label="Ayuda sobre este campo"
        onClick={(e) => e.preventDefault()}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
