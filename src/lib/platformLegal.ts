export const PLATFORM_LEGAL = {
  brand: "Nerqia",
  termsVersion: "2026-09-03",
  privacyVersion: "2026-09-03",
  updatedLabel: "3 de septiembre de 2026",
  legalEmail: "legal@nerqia.app",
  privacyEmail: "privacidad@nerqia.app",
  /**
   * No se completa con la marca: la Ley 25.326 pide identificar al responsable
   * y su domicilio. Inventar una sociedad o un CUIT sería peor que dejar el
   * lanzamiento explícitamente bloqueado hasta que el titular los informe.
   */
  providerIdentityComplete: false,
} as const;

export interface PlatformProcessorDisclosure {
  name: string;
  purpose: string;
  data: string;
  condition: string;
}

/**
 * Proveedores que pueden intervenir en el servicio de plataforma.
 *
 * Esta lista describe capacidad real del código, no asegura que una integración
 * opcional esté encendida. La condición evita prometer transferencias que hoy
 * están bloqueadas por configuración, DPA o aprobación del comercio.
 */
export const PLATFORM_PROCESSORS: PlatformProcessorDisclosure[] = [
  {
    name: "Supabase",
    purpose: "Base de datos, autenticación y almacenamiento",
    data: "Cuenta, organización, operación comercial y archivos que cargás",
    condition: "Infraestructura principal; región AWS us-east-1, Estados Unidos",
  },
  {
    name: "Vercel",
    purpose: "Entrega de la aplicación, dominios y funciones de borde",
    data: "Solicitud web, dirección IP y metadatos técnicos",
    condition: "Infraestructura principal de la aplicación web",
  },
  {
    name: "Mercado Pago",
    purpose: "Suscripción de Nerqia y pagos de tienda o POS cuando se autoricen",
    data: "Importe, referencia de operación y datos que el proveedor solicita",
    condition: "Sólo cuando contratás o conectás el medio de pago",
  },
  {
    name: "Resend o SMTP del comercio",
    purpose: "Emails transaccionales y avisos operativos",
    data: "Email del destinatario y contenido del mensaje",
    condition: "Sólo cuando el canal correspondiente está configurado",
  },
  {
    name: "Sentry",
    purpose: "Diagnóstico de errores y rendimiento",
    data: "Ruta sin parámetros, navegador y detalle técnico minimizado",
    condition: "Sólo si está configurado; la grabación de sesiones está desactivada",
  },
  {
    name: "Anthropic",
    purpose: "Extracción o asistencia opcional con inteligencia artificial",
    data: "Contenido que elegís procesar; puede no estar anonimizado",
    condition: "Desactivado hasta aprobar proveedor, privacidad y habilitación explícita",
  },
];

export const ARGENTINA_PRIVACY_SOURCES = {
  rights: "https://www.argentina.gob.ar/aaip/datospersonales/derechos",
  obligations: "https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones",
  internationalTransfers: "https://www.argentina.gob.ar/transferencias-internacionales",
} as const;
