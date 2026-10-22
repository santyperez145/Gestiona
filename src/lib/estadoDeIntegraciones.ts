import { estadoCertificado } from "@/lib/certificadoPropio";
import { fechaLocal } from "@/lib/fechaAR";
/**
 * Estado de las integraciones (2026-10-14, funciones incoherentes).
 *
 * El panel se armaba con `integration_logs`, pero nada escribe ahí registros
 * de Mercado Pago, ARCA ni la API (0 filas al 2026-10-14): todo figuraba «Sin
 * actividad», ARCA salía siempre «configurado» y el refresco automático usaba
 * un estado viejo de Mercado Pago. Ahora cada tarjeta sale de la conexión real
 * (las vistas *_status y las claves de API), y si una fuente no se pudo leer
 * lo dice en vez de mostrarse vacía.
 */

export type EstadoDeIntegracion = "ok" | "atencion" | "error" | "sin_configurar" | "sin_datos";

export interface TarjetaDeIntegracion {
  id: "mercadopago" | "arca" | "api" | "whatsapp" | "correo";
  nombre: string;
  estado: EstadoDeIntegracion;
  detalle: string;
}

/** Lo leído de cada fuente; `null` si la consulta falló. */
export interface FuentesDeIntegraciones {
  mercadoPago: { conectado?: boolean | null; vigente?: boolean | null; expires_at?: string | null; last_error?: string | null; nickname?: string | null; email?: string | null; live_mode?: boolean | null } | null | undefined;
  arca: { configured?: boolean | null; environment?: string | null; cuit?: string | null; punto_venta?: number | null; razon_social?: string | null; last_error?: string | null; modo?: string | null; delegacion_verificada?: boolean | null; motivo?: string | null } | null | undefined;
  claves: Array<{ revoked_at?: string | null; expires_at?: string | null; last_used_at?: string | null }> | null;
  whatsapp: { configured?: boolean | null; instance?: string | null } | null | undefined;
  correo: { configured?: boolean | null; from_email?: string | null } | null | undefined;
  /** Cuáles fuentes fallaron al leerse. */
  fallidas: Array<TarjetaDeIntegracion["id"]>;
}

const fecha = (iso: string) => fechaLocal(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function estadoDeIntegraciones(f: FuentesDeIntegraciones, ahora = new Date()): TarjetaDeIntegracion[] {
  const fallo = (id: TarjetaDeIntegracion["id"]) => f.fallidas.includes(id);
  const sinDatos = (id: TarjetaDeIntegracion["id"], nombre: string): TarjetaDeIntegracion =>
    ({ id, nombre, estado: "sin_datos", detalle: "No se pudo leer el estado: actualizá" });

  const mp = ((): TarjetaDeIntegracion => {
    const nombre = "Mercado Pago";
    if (fallo("mercadopago")) return sinDatos("mercadopago", nombre);
    const c = f.mercadoPago;
    if (!c?.conectado) return { id: "mercadopago", nombre, estado: "sin_configurar", detalle: "Sin conectar" };
    if (c.last_error) return { id: "mercadopago", nombre, estado: "error", detalle: c.last_error };
    const vencida = c.vigente === false || (c.expires_at ? new Date(c.expires_at) < ahora : false);
    if (vencida) return { id: "mercadopago", nombre, estado: "atencion", detalle: "La conexión venció: reconectá la cuenta" };
    if (c.live_mode === false) return { id: "mercadopago", nombre, estado: "atencion", detalle: "Conectada en modo prueba: los cobros no son reales" };
    return { id: "mercadopago", nombre, estado: "ok", detalle: c.nickname || c.email || "Conectada" };
  })();

  const arca = ((): TarjetaDeIntegracion => {
    const nombre = "ARCA (factura electrónica)";
    if (fallo("arca")) return sinDatos("arca", nombre);
    const c = f.arca;
    if (c?.modo === "propio") {
      const cert = estadoCertificado(c);
      if (cert.fase === "vencido") return { id: "arca", nombre, estado: "error", detalle: "Tu certificado de ARCA venció: renovalo desde la página de ARCA" };
      if (cert.fase === "rechazado" || cert.fase === "falta_asociar") return { id: "arca", nombre, estado: "error", detalle: cert.motivo ?? "ARCA rechazó tu certificado" };
      if (cert.fase === "sin_certificado" || cert.fase === "pedido_pendiente" || cert.fase === "sin_cuit") return { id: "arca", nombre, estado: "sin_configurar", detalle: "Falta conectar tu certificado de ARCA" };
      if (cert.fase === "por_vencer") return { id: "arca", nombre, estado: "atencion", detalle: `Tu certificado vence en ${cert.dias} días: renovalo` };
    }
    if (!c?.configured) return { id: "arca", nombre, estado: "sin_configurar", detalle: "Sin configurar" };
    if (c.last_error) return { id: "arca", nombre, estado: "error", detalle: c.last_error };
    if (c.delegacion_verificada === false) return { id: "arca", nombre, estado: "atencion", detalle: c.modo === "propio" ? "Falta verificar tu punto de venta con ARCA" : "Falta verificar la delegación en ARCA" };
    const homologacion = c.environment !== "produccion";
    const quien = [c.razon_social, c.cuit ? `CUIT ${c.cuit}` : null, c.punto_venta ? `PV ${c.punto_venta}` : null].filter(Boolean).join(" · ");
    if (homologacion) return { id: "arca", nombre, estado: "atencion", detalle: `En homologación: los comprobantes no tienen validez fiscal${quien ? ` · ${quien}` : ""}` };
    return { id: "arca", nombre, estado: "ok", detalle: quien || "Configurada" };
  })();

  const api = ((): TarjetaDeIntegracion => {
    const nombre = "API pública";
    if (fallo("api") || f.claves === null) return sinDatos("api", nombre);
    const vivas = f.claves.filter(k => !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > ahora));
    if (vivas.length === 0) return { id: "api", nombre, estado: "sin_configurar", detalle: "Sin claves activas" };
    const ultima = vivas.map(k => k.last_used_at).filter((x): x is string => !!x).sort().at(-1);
    return { id: "api", nombre, estado: "ok", detalle: `${vivas.length} ${vivas.length === 1 ? "clave activa" : "claves activas"}${ultima ? ` · último uso ${fecha(ultima)}` : " · sin uso todavía"}` };
  })();

  const whatsapp = ((): TarjetaDeIntegracion => {
    const nombre = "WhatsApp (Evolution)";
    if (fallo("whatsapp")) return sinDatos("whatsapp", nombre);
    return f.whatsapp?.configured
      ? { id: "whatsapp", nombre, estado: "ok", detalle: f.whatsapp.instance ? `Instancia ${f.whatsapp.instance}` : "Configurado" }
      : { id: "whatsapp", nombre, estado: "sin_configurar", detalle: "Sin configurar" };
  })();

  const correo = ((): TarjetaDeIntegracion => {
    const nombre = "Correo propio (SMTP)";
    if (fallo("correo")) return sinDatos("correo", nombre);
    return f.correo?.configured
      ? { id: "correo", nombre, estado: "ok", detalle: f.correo.from_email || "Configurado" }
      : { id: "correo", nombre, estado: "sin_configurar", detalle: "Se usa el correo de Nerqia" };
  })();

  return [mp, arca, api, whatsapp, correo];
}
