/**
 * Certificado propio de ARCA del comercio (2026-10-22, ver ADR 007).
 *
 * Una sola función decide en qué etapa está el comercio, a partir de
 * `afip_connection_status`. La usan el asistente de conexión, la salud fiscal,
 * el recorrido de alta y la tarjeta de integraciones: así los cuatro dicen lo
 * mismo.
 */

export const ALIAS_ARCA = "nerqia";
/** Desde cuántos días antes del vencimiento se avisa. */
export const AVISO_VENCIMIENTO_DIAS = 30;

export interface ConexionConCertificado {
  cuit?: string | null;
  modo?: string | null;
  motivo?: string | null;
  environment?: string | null;
  delegacion_verificada?: boolean | null;
  certificado_vence?: string | null;
  certificado_emisor?: string | null;
  certificado_verificado_ok?: boolean | null;
  certificado_verificado_at?: string | null;
  certificado_verificado_motivo?: string | null;
  pedido_pendiente?: boolean | null;
  pedido_csr?: string | null;
  pedido_ambiente?: string | null;
  pedido_creado_at?: string | null;
}

export type FaseCertificado =
  | "sin_cuit"          // falta cargar el CUIT
  | "sin_certificado"   // hay que generar el pedido
  | "pedido_pendiente"  // generó el pedido; falta subir el .crt
  | "falta_asociar"     // el certificado es válido pero no está asociado a Facturación Electrónica
  | "rechazado"         // ARCA rechazó el certificado
  | "vencido"
  | "falta_verificar"   // certificado aceptado; falta verificar punto de venta y CUIT con ARCA
  | "por_vencer"
  | "listo";

export interface EstadoCertificado {
  fase: FaseCertificado;
  /** Días hasta el vencimiento, si se conoce. */
  dias: number | null;
  /** Lo que dijo ARCA la última vez, si falló. */
  motivo: string | null;
}

export function diasParaVencer(vence: string | null | undefined, ahora = new Date()): number | null {
  if (!vence) return null;
  const t = new Date(vence).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - ahora.getTime()) / 86_400_000);
}

export function estadoCertificado(c: ConexionConCertificado | null, ahora = new Date()): EstadoCertificado {
  const dias = diasParaVencer(c?.certificado_vence, ahora);
  const motivo = c?.certificado_verificado_motivo?.trim() || null;
  const fase = ((): FaseCertificado => {
    if (!String(c?.cuit ?? "").trim() || c?.motivo === "falta_datos_fiscales") return "sin_cuit";
    switch (c?.motivo) {
      case "falta_certificado_propio": return c?.pedido_pendiente ? "pedido_pendiente" : "sin_certificado";
      case "certificado_vencido": return "vencido";
      case "certificado_rechazado": return /no est[aá] asociado/i.test(motivo ?? "") ? "falta_asociar" : "rechazado";
      case "falta_verificar": return "falta_verificar";
      default:
        if (dias !== null && dias < 0) return "vencido";
        return dias !== null && dias <= AVISO_VENCIMIENTO_DIAS ? "por_vencer" : "listo";
    }
  })();
  return { fase, dias, motivo };
}

/** ¿Puede pedir CAE hoy? */
export const factura = (e: EstadoCertificado) => e.fase === "listo" || e.fase === "por_vencer";

export interface PasoArca { titulo: string; detalle: string[] }

/** Lo que el comercio hace en ARCA, con su clave fiscal, según el ambiente. */
export function pasosEnArca(ambiente: string | null | undefined, renovacion = false): PasoArca[] {
  if (ambiente === "homologacion") {
    return [
      {
        titulo: "Creá el certificado de prueba",
        detalle: [
          "En ARCA entrá a «WSASS - Autogestión Certificados Homologación» (si no lo ves, adherilo en el Administrador de Relaciones).",
          `«Nuevo certificado»: nombre ${ALIAS_ARCA}, pegá el contenido del pedido (.csr) y copiá el certificado que te devuelve en un archivo .crt.`,
        ],
      },
      {
        titulo: "Autorizalo para Facturación Electrónica",
        detalle: [`En WSASS, «Crear autorización a servicio»: computador ${ALIAS_ARCA}, servicio wsfe.`],
      },
    ];
  }
  if (renovacion) {
    return [{
      titulo: "Renová el certificado en ARCA",
      detalle: [
        `En «Administración de Certificados Digitales», abrí el alias ${ALIAS_ARCA} («Ver»), tocá «Agregar certificado» y subí el pedido (.csr).`,
        "Descargá el certificado nuevo (.crt). La asociación a Facturación Electrónica se conserva: no hay que repetirla.",
      ],
    }];
  }
  return [
    {
      titulo: "Creá el certificado en ARCA",
      detalle: [
        "Entrá a arca.gob.ar con tu clave fiscal (nivel 3) y abrí «Administración de Certificados Digitales». Si no lo ves: «Administrador de Relaciones de Clave Fiscal» → «Adherir servicio» → ARCA → «Administración de Certificados Digitales».",
        `Elegí tu CUIT, tocá «Agregar alias», escribí ${ALIAS_ARCA}, subí el pedido (.csr) y confirmá.`,
        `En el alias ${ALIAS_ARCA} tocá «Ver» y descargá el certificado (.crt).`,
      ],
    },
    {
      titulo: "Asocialo a Facturación Electrónica",
      detalle: [
        "En «Administrador de Relaciones de Clave Fiscal» tocá «Nueva relación» → «Buscar» → ARCA → «WebServices» → «Facturación Electrónica».",
        `En «Representante» tocá «Buscar», elegí el computador fiscal ${ALIAS_ARCA} y confirmá.`,
      ],
    },
  ];
}

/** El punto de venta que hay que crear, según la condición frente al IVA. */
export function tipoDePuntoDeVenta(tipoEmisor: string | null | undefined): string {
  return tipoEmisor === "monotributo"
    ? "«Factura Electrónica - Monotributo - Web Services»"
    : "«RECE para aplicativo y web services»";
}
