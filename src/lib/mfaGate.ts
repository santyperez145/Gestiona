/**
 * Decisión pura del gate de MFA, separada de Supabase para poder testearla.
 *
 * Contexto: `signInWithPassword` devuelve una sesión válida en AAL1 aunque el
 * usuario tenga TOTP enrolado. Sin este chequeo, activar 2FA no protegía nada.
 */

export type MfaDecision = "ok" | "needs_code" | "needs_enrollment" | "unavailable";

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
  // Una respuesta ausente o desconocida no demuestra que el segundo factor
  // haya sido satisfecho. Permitir acceso aquí convertía un fallo de red en
  // un bypass del panel de plataforma.
  if (!aal || !["aal1", "aal2"].includes(aal.currentLevel ?? "") ||
      !["aal1", "aal2"].includes(aal.nextLevel ?? "")) {
    return { decision: "unavailable" };
  }

  const verified = factors.filter(f => f.status === "verified");

  if (aal.currentLevel === "aal2") {
    return aal.nextLevel === "aal2" && verified.length > 0
      ? { decision: "ok" }
      : { decision: "unavailable" };
  }

  // Tiene un factor verificado y la sesión todavía es de un solo factor.
  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2" && verified.length > 0) {
    return { decision: "needs_code", factorId: verified[0].id };
  }

  if (aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    return { decision: "unavailable" };
  }

  if (verified.length > 0) return { decision: "unavailable" };

  // La organización exige 2FA a sus admins y este todavía no lo configuró.
  if (ctx.orgRequiresMfa && ctx.isAdmin && verified.length === 0) {
    return { decision: "needs_enrollment" };
  }

  return { decision: "ok" };
}
