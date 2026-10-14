import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ReactNode, useState } from "react";
import { Input } from "@/components/ui/input";

interface ConfirmDialogProps {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void | Promise<void>;
  /** Para acciones masivas: hay que escribir este texto para confirmar. */
  requireText?: string;
}

export default function ConfirmDialog({
  trigger, open, onOpenChange, title = "¿Estás seguro?", description = "Esta acción no se puede deshacer.",
  confirmText = "Confirmar", cancelText = "Cancelar", variant = "destructive", onConfirm, requireText,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent className="bg-card border-border/60">
        {/* El contenido se desmonta al cerrar: lo escrito para confirmar no queda. */}
        <Cuerpo title={title} description={description} confirmText={confirmText} cancelText={cancelText}
          variant={variant} onConfirm={onConfirm} requireText={requireText} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Cuerpo({ title, description, confirmText, cancelText, variant, onConfirm, requireText }: Required<Pick<ConfirmDialogProps,
  "title" | "description" | "confirmText" | "cancelText" | "variant" | "onConfirm">> & { requireText?: string }) {
  const [escrito, setEscrito] = useState("");
  const listo = !requireText || escrito.trim().toLocaleUpperCase("es") === requireText.toLocaleUpperCase("es");
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="font-display">{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {requireText && (
        <div className="space-y-1.5">
          <label className="text-sm" htmlFor="confirmar-texto">Escribí <strong>{requireText}</strong> para confirmar</label>
          <Input id="confirmar-texto" autoComplete="off" value={escrito} onChange={e => setEscrito(e.target.value)} />
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel className="border-border">{cancelText}</AlertDialogCancel>
        <AlertDialogAction
          disabled={!listo}
          onClick={e => { if (!listo) { e.preventDefault(); return; } void onConfirm(); }}
          className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}
        >
          {confirmText}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
