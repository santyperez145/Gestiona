// Experimento E5 de docs/TESIS.md: «Se paga al reemplazar herramientas».
// Mínimo: ofrecer Starter a comercios con 4 semanas de uso, mostrando lo que
// dejan de pagar. Éxito si ≥ 30% paga con Mercado Pago (2026-12-15).
//
// El panel con la cuenta ya está en Mi plan («Lo que Nerqia reemplaza»); esto
// decide cuándo ofrecerlo en el Inicio: al dueño o administrador de un
// comercio que lleva 4 semanas y todavía no paga. Se puede posponer 14 días.

export const SEMANAS_E5 = 4;
export const POSPONER_DIAS = 14;
const DIA = 86_400_000;

export interface EntradaOfertaE5 {
  orgCreadaAt: string | null | undefined;
  rol: string | null | undefined;
  /** Plan contratado y estado de `suscripcion_de_organizacion`. */
  planCode: string | null | undefined;
  estado: string | null | undefined;
  /** Hasta cuándo se pospuso (ISO), si se pospuso. */
  pospuestaHasta: string | null;
  ahora: Date;
}

/** Ya paga: plan distinto de la prueba con la suscripción al día. */
export function yaPaga(planCode: string | null | undefined, estado: string | null | undefined): boolean {
  return Boolean(planCode) && planCode !== "trial" && (estado === "active" || estado === "trialing");
}

export function semanasDeUso(orgCreadaAt: string | null | undefined, ahora: Date): number | null {
  if (!orgCreadaAt) return null;
  const t = new Date(orgCreadaAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((ahora.getTime() - t) / (7 * DIA));
}

export function mostrarOfertaE5(e: EntradaOfertaE5): boolean {
  if (e.rol !== "owner" && e.rol !== "admin") return false;
  const semanas = semanasDeUso(e.orgCreadaAt, e.ahora);
  if (semanas === null || semanas < SEMANAS_E5) return false;
  if (yaPaga(e.planCode, e.estado)) return false;
  if (e.pospuestaHasta && new Date(e.pospuestaHasta).getTime() > e.ahora.getTime()) return false;
  return true;
}

export function pospuestaHasta(ahora: Date): string {
  return new Date(ahora.getTime() + POSPONER_DIAS * DIA).toISOString();
}

export const claveOfertaE5 = (orgId: string) => `nerqia:oferta-e5:${orgId}`;
