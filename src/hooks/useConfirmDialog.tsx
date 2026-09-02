import { useCallback, useRef, useState } from "react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

export type ConfirmAskOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "destructive" | "default";
};

/**
 * Confirmación propia (AlertDialog), no `window.confirm`.
 * Usar `ask(...)` en handlers async y montar `{dialog}` una vez en el JSX.
 */
export function useConfirmDialog() {
  const [opts, setOpts] = useState<ConfirmAskOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpts(null);
  }, []);

  const ask = useCallback((next: ConfirmAskOptions) => {
    return new Promise<boolean>((resolve) => {
      // Si ya había un diálogo abierto, cancela el anterior.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setOpts(next);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={opts != null}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
      title={opts?.title}
      description={opts?.description}
      confirmText={opts?.confirmText}
      cancelText={opts?.cancelText}
      variant={opts?.variant ?? "destructive"}
      onConfirm={() => close(true)}
    />
  );

  return { ask, dialog };
}
