export function creatorOperationError(cause: unknown, fallback: string): string {
  const error = cause as { code?: string; message?: string } | null;
  if (error?.message?.includes("insufficient_balance")) return "Tu saldo cambió. Actualizá el portal y revisá el monto disponible.";
  if (error?.code === "42501") return "Tu sesión no permite esta operación. Volvé a iniciar sesión con tu cuenta de creador.";
  if (error?.code === "53400") return "Alcanzaste el límite de solicitudes. Intentá más tarde.";
  if (error?.code === "55000") return "Esta colaboración cambió o ya está cerrada. Actualizá el portal antes de continuar.";
  return fallback;
}
