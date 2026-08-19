/**
 * Billetera — las reglas de lectura, del lado del cliente.
 *
 * El saldo lo deriva la base del ledger (`wallet_saldo`) y el retiro lo valida
 * `wallet_solicitar_retiro` contra el libro, con candado. Acá vive lo que la
 * pantalla necesita para **explicar** esos números y para frenar un pedido
 * imposible antes de mandarlo — que es la diferencia entre corregir un campo y
 * comerse un error del servidor.
 *
 * ⚠️ Nada de esto es la autoridad. Si el cliente y la base discrepan, manda la
 * base: el cliente puede estar mirando un saldo de hace treinta segundos.
 */

export interface SaldoBilletera {
  /** Cobrado y todavía no acreditado por el procesador. */
  pendiente: number;
  /** Acreditado, en la billetera. */
  disponible: number;
  /** Ya pedido para retirar y todavía no salido. */
  en_retiro: number;
  /** Lo que realmente se puede pedir hoy: disponible − en retiro. */
  retirable: number;
  total: number;
  moneda?: string;
}

export type EstadoRetiro = "solicitado" | "en_proceso" | "pagado" | "rechazado";

export const ESTADO_RETIRO: Record<EstadoRetiro, { label: string; tono: "amber" | "blue" | "green" | "red" }> = {
  solicitado: { label: "Solicitado", tono: "amber" },
  en_proceso: { label: "En proceso", tono: "blue" },
  pagado:     { label: "Pagado",     tono: "green" },
  rechazado:  { label: "Rechazado",  tono: "red" },
};

export const saldoVacio: SaldoBilletera = {
  pendiente: 0, disponible: 0, en_retiro: 0, retirable: 0, total: 0, moneda: "ARS",
};

/** Normaliza lo que devuelve el RPC, que llega con los números como texto. */
export function leerSaldo(raw: unknown): SaldoBilletera {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(o[k]);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    pendiente: n("pendiente"),
    disponible: n("disponible"),
    en_retiro: n("en_retiro"),
    retirable: n("retirable"),
    total: n("total"),
    moneda: typeof o.moneda === "string" ? o.moneda : "ARS",
  };
}

export interface ValidacionRetiro {
  puede: boolean;
  motivo?: string;
}

/**
 * ¿Se puede pedir este retiro?
 *
 * Espejo de las validaciones de `wallet_solicitar_retiro`, en el mismo orden:
 * primero lo que el comercio puede resolver —cargar una cuenta— y después el
 * monto. Decirle "no te alcanza" a quien además no tiene cuenta bancaria lo
 * manda a arreglar lo que no era.
 */
export function validarRetiro(
  monto: number,
  saldo: SaldoBilletera | null | undefined,
  tieneCuenta: boolean,
  fmt: (n: number) => string = n => `$${n.toLocaleString("es-AR")}`,
): ValidacionRetiro {
  if (!tieneCuenta) {
    return { puede: false, motivo: "Cargá una cuenta bancaria antes de retirar" };
  }

  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0) {
    return { puede: false, motivo: "Ingresá un monto mayor a cero" };
  }

  const retirable = Number(saldo?.retirable ?? 0);
  if (retirable <= 0) {
    return { puede: false, motivo: "No tenés saldo disponible para retirar" };
  }

  if (m > retirable) {
    return { puede: false, motivo: `Podés retirar hasta ${fmt(retirable)}` };
  }

  return { puede: true };
}

/**
 * Valida un CBU o CVU: 22 dígitos y el dígito verificador de cada bloque.
 *
 * El CBU tiene **dos** verificadores —uno en el bloque de 8 y otro en el de
 * 14— y validarlos agarra casi cualquier error de tipeo. Un CBU mal escrito no
 * rebota en el momento: la transferencia sale, la rechaza el banco días
 * después, y mientras tanto el comercio cree que le pagaron.
 *
 * Espejo parcial del CHECK de la base, que sólo mira que sean 22 dígitos: acá
 * se valida además la estructura, porque el cliente puede avisar antes.
 */
export function validarCbu(valor: string | null | undefined): boolean {
  const limpio = String(valor ?? "").replace(/[^0-9]/g, "");
  if (limpio.length !== 22) return false;

  // Bloque 1: 8 dígitos (banco 3, sucursal 4, verificador 1).
  const b1 = limpio.slice(0, 8);
  const p1 = [7, 1, 3, 9, 7, 1, 3];
  const s1 = p1.reduce((acc, p, i) => acc + p * Number(b1[i]), 0);
  if ((10 - (s1 % 10)) % 10 !== Number(b1[7])) return false;

  // Bloque 2: 14 dígitos (cuenta 13, verificador 1).
  const b2 = limpio.slice(8);
  const p2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  const s2 = p2.reduce((acc, p, i) => acc + p * Number(b2[i]), 0);
  return (10 - (s2 % 10)) % 10 === Number(b2[13]);
}

/** `0170099220000067797393` → `0170 0992 2000 0067 7973 93` */
export function formatearCbu(valor: string | null | undefined): string {
  const limpio = String(valor ?? "").replace(/[^0-9]/g, "");
  if (limpio.length !== 22) return String(valor ?? "");
  return limpio.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Qué se le dice al comercio sobre su plata pendiente.
 *
 * Es el número que más confunde: está cobrado pero no se puede usar. Explicarlo
 * en una línea evita el ticket de soporte "me falta plata".
 */
export function explicarPendiente(saldo: SaldoBilletera | null | undefined): string | null {
  const p = Number(saldo?.pendiente ?? 0);
  if (p <= 0) return null;
  return "Ya lo cobraste, pero MercadoPago todavía no lo acreditó. Se libera solo.";
}
