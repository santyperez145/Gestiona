// Salud de cada comercio en rojo/ámbar/verde, de `platform_salud_comercios()`
// (migración 20261010002900). Para acompañar a cada comercio: qué lo traba y
// en qué pantalla del comercio se resuelve.

export type Semaforo = "rojo" | "ambar" | "verde";

export interface MotivoSalud {
  nivel: "rojo" | "ambar";
  id: "importacion" | "bajo_costo" | "sin_ventas" | "respaldo" | "arca" | "tienda" | "prueba";
  texto: string;
  /** Ruta dentro del comercio donde se resuelve. */
  ir: string;
}

export interface SaludComercio {
  org_id: string;
  nombre: string;
  semaforo: Semaforo;
  ventas_7d: number;
  motivos: MotivoSalud[];
}

const PANTALLA: Record<string, string> = {
  "/productos": "Productos",
  "/productos?margen=negative": "Productos › Margen negativo",
  "/pos": "Caja",
  "/facturas": "Facturas",
  "/tienda": "Tienda online",
  "/mi-plan": "Mi plan",
  "/ajustes#system": "Ajustes › Sistema (respaldos)",
};

/** Nombre de la pantalla del comercio donde se resuelve el motivo. */
export function pantallaDe(ruta: string): string {
  return PANTALLA[ruta] ?? ruta;
}

export function contarSemaforos(comercios: SaludComercio[]): Record<Semaforo, number> {
  const out: Record<Semaforo, number> = { rojo: 0, ambar: 0, verde: 0 };
  for (const c of comercios) out[c.semaforo] += 1;
  return out;
}
