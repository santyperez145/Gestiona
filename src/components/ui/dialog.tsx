/**
 * Nerqia Dialog — Modal con estilo cockpit
 *
 * Overlay oscuro, contenido en tarjeta con borde izquierdo de acento.
 */
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  /** Muestra botones de acción (Cancelar/Aceptar) */
  showActions?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  /** Muestra barra de acento lateral */
  accent?: boolean;
  accentColor?: "primary" | "warm" | "teal" | "destructive";
  size?: "default" | "sm" | "md" | "lg" | "xl";
}

const dialogSizes = {
  sm: "max-w-sm",
  default: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function NerqiaDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  showActions = false,
  onCancel,
  onConfirm,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  accent = false,
  accentColor = "primary",
  size = "default",
}: DialogProps) {
  if (!open) return null;

  const accentClasses = {
    primary: "border-l-primary/60",
    warm: "border-l-amber-500/60",
    teal: "border-l-teal-500/60",
    destructive: "border-l-red-500/60",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onPointerDownCapture={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        className={cn(
          "relative flex flex-col gap-4 overflow-y-auto rounded-[10px] border bg-card p-6",
          "shadow-xl shadow-black/20",
          accent ? accentClasses[accentColor] : "border-border/70",
          dialogSizes[size],
          "animate-in fade-in-0 zoom-in-95",
        )}
      >
        {title && (
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        <div>{children}</div>
        {showActions && (
          <div className="flex justify-end gap-2 pt-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-[8px] border border-border/60 bg-transparent px-4 py-2 text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
              >
                {cancelText}
              </button>
            )}
            {onConfirm && (
              <button
                onClick={onConfirm}
                className="rounded-[8px] border border-border/60 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                {confirmText}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Portal para diálogos fullscreen */
export function NerqiaDialogViewport({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
      {children}
    </div>
  );
}