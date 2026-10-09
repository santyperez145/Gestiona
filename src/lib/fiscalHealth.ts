/**
 * Fiscal Health: lista de controles sobre la conexión ARCA y los comprobantes
 * recientes, con un puntaje 0–100. Sólo lee estado sanitizado
 * (`afip_connection_status` e `invoices`); no consulta ARCA ni corrige datos.
 * El certificado de la plataforma no es visible para el comercio: su vigencia
 * se controla en Platform.
 */
import { grupoPendienteFiscal, type ComprobantePendienteFiscal } from "@/lib/fiscalExceptions";

export type EstadoControlFiscal = "ok" | "atencion" | "falla";

export type ControlFiscal = {
  id: "datos" | "conexion" | "delegacion" | "ambiente" | "rechazos" | "pendientes" | "cae_reciente";
  titulo: string;
  estado: EstadoControlFiscal;
  detalle: string;
};

export type ConexionFiscal = {
  cuit: string | null;
  razon_social: string | null;
  punto_venta: number | null;
  domicilio: string | null;
  ingresos_brutos: string | null;
  inicio_actividades: string | null;
  environment: string | null;
  configured: boolean | null;
  motivo: string | null;
  delegacion_verificada: boolean | null;
};

export type ComprobanteFiscalSalud = ComprobantePendienteFiscal & { issue_date: string | null };

export type SaludFiscal = { puntaje: number; controles: ControlFiscal[] };

const PESO: Record<ControlFiscal["id"], number> = {
  datos: 20, conexion: 25, delegacion: 20, ambiente: 5, rechazos: 15, pendientes: 5, cae_reciente: 10,
};
const VALOR: Record<EstadoControlFiscal, number> = { ok: 1, atencion: 0.5, falla: 0 };
const DIAS_CAE_RECIENTE = 30;

const vacio = (value: unknown) => !String(value ?? "").trim();

export function saludFiscal(
  conexion: ConexionFiscal | null,
  comprobantes: ComprobanteFiscalSalud[],
  ahora: Date = new Date(),
): SaludFiscal {
  const controles: ControlFiscal[] = [];
  const produccion = conexion?.environment === "produccion";

  const faltantes = [
    vacio(conexion?.cuit) && "CUIT",
    vacio(conexion?.razon_social) && "razón social",
    !conexion?.punto_venta && "punto de venta",
    vacio(conexion?.domicilio) && "domicilio fiscal",
    produccion && vacio(conexion?.ingresos_brutos) && "Ingresos Brutos",
    produccion && !conexion?.inicio_actividades && "inicio de actividades",
  ].filter((f): f is string => !!f);
  controles.push({
    id: "datos",
    titulo: "Datos fiscales del emisor",
    estado: faltantes.length === 0 ? "ok" : vacio(conexion?.cuit) || !conexion?.punto_venta ? "falla" : "atencion",
    detalle: faltantes.length === 0 ? "Completos." : `Falta: ${faltantes.join(", ")}.`,
  });

  const conectado = !!conexion?.configured && conexion.motivo !== "falta_ambiente";
  controles.push({
    id: "conexion",
    titulo: "Conexión con ARCA",
    estado: conectado ? "ok" : "falla",
    detalle: conectado
      ? "Nerqia puede pedir autorización a ARCA."
      : conexion?.motivo === "falta_ambiente"
        ? "El ambiente elegido no tiene certificado disponible."
        : "Todavía no se puede pedir CAE.",
  });

  controles.push({
    id: "delegacion",
    titulo: "Delegación y punto de venta verificados",
    estado: conexion?.delegacion_verificada ? "ok"
      : conexion?.motivo === "esperando_plataforma" ? "atencion" : "falla",
    detalle: conexion?.delegacion_verificada
      ? "ARCA confirmó el CUIT y el punto de venta."
      : conexion?.motivo === "esperando_plataforma"
        ? "La activación está en revisión de Nerqia."
        : "Falta verificar la delegación y el punto de venta con ARCA.",
  });

  controles.push({
    id: "ambiente",
    titulo: "Ambiente",
    estado: produccion ? "ok" : "atencion",
    detalle: produccion ? "Producción: los comprobantes tienen validez fiscal." : "Homologación: los comprobantes son de prueba.",
  });

  const grupos = comprobantes.map(c => grupoPendienteFiscal(c));
  const conError = grupos.filter(g => g && g !== "sin_autorizar" && g !== "en_verificacion").length;
  controles.push({
    id: "rechazos",
    titulo: "Comprobantes con error",
    estado: conError === 0 ? "ok" : "falla",
    detalle: conError === 0 ? "Sin rechazos pendientes en los comprobantes recientes."
      : `${conError} ${conError === 1 ? "comprobante necesita" : "comprobantes necesitan"} una acción.`,
  });

  const sinAutorizar = grupos.filter(g => g === "sin_autorizar").length;
  const enVerificacion = grupos.filter(g => g === "en_verificacion").length;
  controles.push({
    id: "pendientes",
    titulo: "Pendientes de autorizar",
    estado: sinAutorizar + enVerificacion === 0 ? "ok" : "atencion",
    detalle: sinAutorizar + enVerificacion === 0 ? "Nada pendiente."
      : [sinAutorizar && `${sinAutorizar} sin autorizar`, enVerificacion && `${enVerificacion} en verificación`].filter(Boolean).join(" · ") + ".",
  });

  const ultimoCae = comprobantes
    .filter(c => c.cae && c.afip_status === "authorized" && c.issue_date)
    .map(c => Date.parse(`${String(c.issue_date).slice(0, 10)}T12:00:00Z`))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const dias = ultimoCae === undefined ? null : Math.floor((ahora.getTime() - ultimoCae) / 86_400_000);
  controles.push({
    id: "cae_reciente",
    titulo: "CAE reciente",
    estado: dias !== null && dias <= DIAS_CAE_RECIENTE ? "ok" : "atencion",
    detalle: dias === null ? "Todavía no hay un CAE otorgado en los comprobantes recientes."
      : dias <= 0 ? "Último CAE: hoy."
      : `Último CAE hace ${dias} ${dias === 1 ? "día" : "días"}.`,
  });

  const total = controles.reduce((s, c) => s + PESO[c.id], 0);
  const obtenido = controles.reduce((s, c) => s + PESO[c.id] * VALOR[c.estado], 0);
  return { puntaje: Math.round((obtenido / total) * 100), controles };
}
