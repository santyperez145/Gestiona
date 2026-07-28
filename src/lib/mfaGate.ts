/**
 * Decisión pura del gate de MFA, separada de Supabase para poder testearla.
 *
 * Contexto: `signInWithPassword` devuelve una sesión válida en AAL1 aunque el
 * usuario tenga TOTP enrolado. Sin este chequeo, activar 2FA no protegía nada.
 */

export type MfaDecision = "ok" | "needs_code" | "needs_enrollment";

export interface AalInfo {
  currentLevel: string | null;
  nextLevel: string | null;
}

export interface FactorInfo {
  id: string;
  status: string;
}

export interface GateContext {
  isAdmin: boolean;
  orgRequiresMfa: boolean;
}

/**
 * @param aal      nivel actual/requerido según Supabase, o null si falló la consulta
 * @param factors  factores TOTP del usuario
 */
export function decideMfaState(
  aal: AalInfo | null,
  factors: FactorInfo[],
  ctx: GateContext,
): { decision: MfaDecision; factorId?: string } {
  // Si no se pudo leer el nivel, no bloqueamos: preferimos no dejar a nadie
  // afuera de su propio negocio por un error de red.
  if (!aal) return { decision: "ok" };

  const verified = factors.filter(f => f.status === "verified");

  // Tiene un factor verificado y la sesión todavía es de un solo factor.
  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2" && verified.length > 0) {
    return { decision: "needs_code", factorId: verified[0].id };
  }

  // La organización exige 2FA a sus admins y este todavía no lo configuró.
  if (ctx.orgRequiresMfa && ctx.isAdmin && verified.length === 0) {
    return { decision: "needs_enrollment" };
  }

  return { decision: "ok" };
}
