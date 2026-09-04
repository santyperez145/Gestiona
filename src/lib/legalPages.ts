/**
 * Las páginas legales de la tienda, generadas a partir de los datos reales.
 *
 * ── Por qué esto existe ───────────────────────────────────────────────────
 *
 * La tienda arrancó con páginas semilla, y se verificó contra la base que
 * siguen **tal cual salieron**: los términos publicados dicen "Mi Tienda
 * Online" y cierran con "Completá acá tu razón social, CUIT, domicilio y un
 * medio de contacto". Eso está online. Una plantilla sin completar es peor
 * que no tener la página, porque parece que el tema está resuelto.
 *
 * Y falta entera la **política de privacidad**, que la Ley 25.326 exige apenas
 * se recolecta un email.
 *
 * ── La distinción que hace que esto sirva ────────────────────────────────
 *
 * El patrón del repo es "nunca pisar lo cargado a mano". Acá eso solo dejaría
 * el marcador para siempre, porque el marcador *es* contenido. Por eso
 * `esPlantillaSinCompletar` existe: un texto que todavía dice "Completá acá"
 * o nombra a "Mi Tienda Online" **no es** trabajo de nadie, y se puede
 * reemplazar. Cualquier otra cosa, no se toca.
 *
 * ── Lo que el generador puede y no puede saber ───────────────────────────
 *
 * Puede saber **qué hace el sistema con los datos**, porque eso está en el
 * código: dónde se alojan, qué proveedores intervienen, qué se guarda. Eso es
 * justamente lo que un comercio no sabe escribir y lo que más se omite.
 *
 * No puede saber la razón social, el CUIT ni el domicilio. Si faltan, el texto
 * **no se genera con un hueco**: `datosFaltantes` los devuelve para que la
 * pantalla los pida antes. Publicar una política con "[completar]" adentro es
 * volver al problema que esto viene a resolver.
 *
 * ⚠️ Esto no es asesoramiento legal. Es un punto de partida honesto sobre lo
 * que el sistema realmente hace, para que un profesional lo revise. Ver
 * docs/LEGAL.md.
 */

export interface DatosDelComercio {
  /** Nombre de fantasía de la tienda. */
  nombreTienda: string;
  razonSocial: string;
  cuit: string;
  domicilio: string;
  emailContacto: string;
  /** Si está vacío no se menciona: prometer un teléfono que no atiende es peor. */
  telefono?: string;
  /** Píxeles activos. Cambia el párrafo de terceros, no se puede omitir. */
  usaPixeles?: boolean;
}

export type CampoFaltante = "razonSocial" | "cuit" | "domicilio" | "emailContacto";

const ETIQUETAS: Record<CampoFaltante, string> = {
  razonSocial: "razón social",
  cuit: "CUIT",
  domicilio: "domicilio comercial",
  emailContacto: "email de contacto",
};

/** Qué falta para poder generar. Vacío ⇒ se puede. */
export function datosFaltantes(d: Partial<DatosDelComercio>): CampoFaltante[] {
  const campos: CampoFaltante[] = ["razonSocial", "cuit", "domicilio", "emailContacto"];
  return campos.filter(c => !String(d[c] ?? "").trim());
}

export function etiquetaDeCampo(c: CampoFaltante): string {
  return ETIQUETAS[c];
}

export type EmisorFiscal = {
  cuit?: string | null;
  razon_social?: string | null;
  domicilio?: string | null;
  /** Para sincronizar identidad al generar legales, sin inventar un PV. */
  punto_venta?: number | null;
  environment?: string | null;
  tipo_emisor?: string | null;
};

/** CUIT comparable: sólo dígitos. */
export function cuitSoloDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * ¿Conviene escribir en AFIP lo que se acaba de declarar para el texto legal?
 *
 * Sí cuando Facturas ya tiene CUIT + punto de venta + entorno (identidad
 * iniciada) y el formulario legal completa razón o domicilio que AFIP aún
 * no tiene. No si el CUIT no coincide: eso sería pisar el emisor.
 * El email de contacto no vive en AFIP.
 */
export function puedeSincronizarIdentidadFiscal(
  emisor: EmisorFiscal | null | undefined,
  datos: Pick<DatosDelComercio, "cuit" | "razonSocial" | "domicilio">,
): boolean {
  if (!emisor) return false;
  const pv = Number(emisor.punto_venta);
  if (!Number.isFinite(pv) || pv < 1) return false;
  if (emisor.environment !== "homologacion" && emisor.environment !== "produccion") {
    return false;
  }
  const cuitAfip = cuitSoloDigitos(emisor.cuit);
  const cuitDatos = cuitSoloDigitos(datos.cuit);
  if (cuitAfip.length !== 11 || cuitAfip !== cuitDatos) return false;
  if (!String(datos.razonSocial ?? "").trim()) return false;
  if (!String(datos.domicilio ?? "").trim()) return false;
  const faltabaDomicilio = !String(emisor.domicilio ?? "").trim();
  const faltabaRazon = !String(emisor.razon_social ?? "").trim();
  return faltabaDomicilio || faltabaRazon;
}

/** Acción del checklist según si falta generar o sólo publicar borradores. */
export function accionLegalDelChecklist(input: {
  missingOrTemplate: number;
  drafts: number;
}): { actionLabel: string; actionHref: string } {
  if (input.missingOrTemplate > 0) {
    return {
      actionLabel: "Completar legales",
      actionHref: "/tienda-online?tab=pages",
    };
  }
  if (input.drafts > 0) {
    return {
      actionLabel: "Revisar y publicar",
      actionHref: "/tienda-online?tab=pages",
    };
  }
  return {
    actionLabel: "Ver legales",
    actionHref: "/tienda-online?tab=pages",
  };
}

export type TiendaParaLegales = {
  name?: string | null;
  notification_email?: string | null;
  meta_pixel_id?: string | null;
  ga_measurement_id?: string | null;
  tiktok_pixel_id?: string | null;
};

/**
 * Semilla del formulario legal: sólo lo que el comercio ya declaró.
 *
 * La autoridad del emisor es `afip_connection_status` (la misma que Facturas).
 * `settings.afip_*` es un espejo; el nombre de fantasía no es razón social.
 * El email de avisos de la tienda sí es un contacto comercial; el login del
 * SaaS no. Vacío significa «todavía no está», no se rellena con un ejemplo.
 */
export function semillaLegalDelComercio(input: {
  emisor?: EmisorFiscal | null;
  tienda?: TiendaParaLegales | null;
  nombreFantasia?: string | null;
}): DatosDelComercio {
  const razonSocial = String(input.emisor?.razon_social ?? "").trim();
  const nombreTienda = String(
    input.tienda?.name
    || input.nombreFantasia
    || razonSocial,
  ).trim();
  const t = input.tienda;
  return {
    nombreTienda,
    razonSocial,
    cuit: String(input.emisor?.cuit ?? "").trim(),
    domicilio: String(input.emisor?.domicilio ?? "").trim(),
    emailContacto: String(t?.notification_email ?? "").trim(),
    usaPixeles: Boolean(t?.meta_pixel_id || t?.ga_measurement_id || t?.tiktok_pixel_id),
  };
}

/**
 * ¿El contenido sigue siendo la plantilla semilla?
 *
 * Se busca por marcas que **nadie escribiría a propósito**. Un comercio que
 * redactó sus términos no deja "Completá acá" adentro, y no se llama a sí
 * mismo "Mi Tienda Online". Ante la duda se responde `false`: pisar el texto
 * de alguien es mucho peor que dejar un marcador un rato más.
 */
export function esPlantillaSinCompletar(contenido: string | null | undefined): boolean {
  const t = (contenido ?? "").toLowerCase();
  if (!t.trim()) return true;
  return [
    "completá acá",
    "completa aca",
    "mi tienda online",
    "[completar]",
    "lorem ipsum",
  ].some(marca => t.includes(marca));
}

/** El CUIT como lo escribe la gente, sin importar cómo vino cargado. */
export function formatearCuit(cuit: string): string {
  const d = (cuit ?? "").replace(/\D/g, "");
  if (d.length !== 11) return (cuit ?? "").trim();
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

function bloqueIdentificacion(d: DatosDelComercio): string {
  return [
    `**${d.razonSocial}**`,
    `CUIT ${formatearCuit(d.cuit)}`,
    d.domicilio,
    d.emailContacto,
    d.telefono?.trim() ? d.telefono.trim() : null,
  ].filter(Boolean).join("  \n");
}

/**
 * Política de privacidad — Ley 25.326.
 *
 * Los proveedores que se nombran son **los que el sistema realmente usa**, no
 * una lista genérica: alojamiento en Supabase sobre AWS `us-east-1`, cobro por
 * MercadoPago, emails por Resend, envíos por el correo. Y se declara la
 * transferencia a Estados Unidos, que es el punto que nadie escribe solo y el
 * que la AAIP mira: para el organismo Estados Unidos **no** tiene nivel
 * adecuado de protección, así que la transferencia necesita consentimiento
 * informado — y el lugar de informarlo es éste.
 */
export function politicaDePrivacidad(d: DatosDelComercio): string {
  const terceros = [
    "**Alojamiento:** Supabase Inc., sobre servidores de Amazon Web Services ubicados en Estados Unidos.",
    "**Cobros:** MercadoPago, que procesa el pago. Nunca recibimos ni guardamos los datos de tu tarjeta.",
    "**Envíos:** el correo o transporte que despacha tu pedido, que recibe tu nombre, dirección y teléfono para poder entregarlo.",
    "**Emails:** el proveedor de correo con el que te mandamos la confirmación de compra y el seguimiento.",
    d.usaPixeles
      ? "**Analítica y publicidad:** Meta, Google Analytics y/o TikTok, sólo si aceptás la medición en esta tienda. Podés cambiar la decisión desde «Preferencias de privacidad» en el pie."
      : null,
  ].filter(Boolean).map(t => `- ${t}`).join("\n");

  return `## Quién trata tus datos

${bloqueIdentificacion(d)}

Somos responsables de la base de datos donde se guardan tus datos personales,
en los términos de la Ley 25.326 de Protección de los Datos Personales.

## Qué datos guardamos y para qué

Cuando comprás en ${d.nombreTienda} guardamos tu nombre, email, teléfono y la
dirección de envío. Los usamos para procesar tu compra, despachar el pedido,
emitir el comprobante y responderte si nos escribís. También queda registrado
qué compraste, porque lo necesitamos para la garantía y para la contabilidad.

${storeAnalyticsDisclosureBlock()}

Si creás una cuenta, guardamos además tu historial de pedidos para que puedas
consultarlo.

No pedimos ni guardamos datos sensibles, y no vendemos tus datos a nadie.

## Con quién los compartimos

Sólo con quienes hacen falta para que la compra funcione:

${terceros}

## Tus datos se alojan en Estados Unidos

Los servidores donde vive nuestra base de datos están en Estados Unidos. Para
la Agencia de Acceso a la Información Pública, ese país no cuenta con un nivel
adecuado de protección de datos personales, por lo que la transferencia se
realiza con tu consentimiento informado: al comprar o crear una cuenta, aceptás
que tus datos se traten allí.

## Cuánto tiempo los guardamos

Mientras tu cuenta esté activa, y después el tiempo que exige la normativa
fiscal y comercial para conservar los respaldos de una operación. Cumplido ese
plazo, se eliminan.

## Tus derechos

Podés pedirnos, gratis:

- **Acceso:** que te digamos qué datos tuyos tenemos.
- **Rectificación:** que corrijamos los que estén mal.
- **Supresión:** que los borremos, salvo los que estemos obligados a conservar
  por la normativa fiscal.
- **Actualización** de cualquiera de ellos.

Escribinos a ${d.emailContacto} y te respondemos dentro de los diez días
corridos, como establece el artículo 14 de la Ley 25.326.

Si querés dejar de recibir nuestros emails, cada uno trae un link para darte de
baja al pie, y la baja es inmediata.

## Autoridad de control

La **Agencia de Acceso a la Información Pública**, órgano de control de la Ley
25.326, atiende las denuncias de quien considere afectados sus derechos.

## Cambios

Si actualizamos esta política, publicamos la nueva versión en esta misma
página. Te recomendamos revisarla de vez en cuando.`;
}

/**
 * Términos y condiciones — Ley 24.240 art. 4 y Res. 424/2020.
 *
 * Lo que la plantilla vieja no tenía y es exigible: quién vende, con nombre,
 * CUIT y domicilio; el derecho de arrepentimiento con su plazo y quién paga el
 * envío de vuelta; la garantía legal; y dónde reclamar si no nos ponemos de
 * acuerdo.
 */
export function terminosYCondiciones(d: DatosDelComercio): string {
  return `## Quién vende

${bloqueIdentificacion(d)}

Estos términos regulan las compras hechas en la tienda online de
${d.nombreTienda}. Al confirmar una orden, aceptás lo que sigue.

## Precios y stock

Los precios están expresados en pesos argentinos e incluyen el IVA. Pueden
cambiar sin aviso: rige el precio vigente al momento en que confirmás la orden.
Todas las publicaciones están sujetas a disponibilidad de stock.

Cuando ofrecemos un descuento por un medio de pago determinado, el precio con
ese descuento se muestra antes de que confirmes la compra.

## Cómo se confirma tu compra

La orden queda confirmada cuando se acredita el pago. Hasta entonces
reservamos el stock, pero la operación no está cerrada. Te avisamos por email
en cada paso.

## Envíos

Despachamos a la dirección que indicaste. El costo y el plazo estimado se
muestran en el checkout antes de pagar. Los plazos son estimados del correo y
no dependen de nosotros una vez despachado el pedido.

## Botón de arrepentimiento

Tenés **diez días corridos desde que recibís el pedido** para arrepentirte de
la compra, sin necesidad de expresar ningún motivo y sin costo alguno, según el
artículo 34 de la Ley 24.240 y la Resolución 424/2020.

El producto tiene que estar sin uso y en su embalaje original. **El costo de
devolverlo lo pagamos nosotros.** Te devolvemos lo que pagaste por el mismo
medio en que lo hiciste.

Para ejercerlo, usá el botón de arrepentimiento que está en la parte superior
de nuestro sitio, o escribinos a ${d.emailContacto}.

## Garantía

Los productos nuevos tienen la garantía legal de **seis meses** por defectos de
fabricación que establece el artículo 11 de la Ley 24.240. Si algo llega
fallado, escribinos y lo resolvemos.

## Datos personales

Tratamos tus datos según nuestra Política de Privacidad, que podés consultar en
este mismo sitio. Podés pedir su acceso, rectificación o supresión cuando
quieras, escribiendo a ${d.emailContacto} (Ley 25.326).

## Reclamos

Si tenés un problema, escribinos primero a ${d.emailContacto}: es la forma más
rápida de resolverlo. Si aun así no llegamos a un acuerdo, podés presentar tu
reclamo ante la **Ventanilla Única Federal de Reclamos** de la Dirección
Nacional de Defensa del Consumidor, en
https://autogestion.produccion.gob.ar/consumidores`;
}

export interface PaginaLegal {
  slug: string;
  title: string;
  content: string;
  /** Por qué se propone: nueva, o la plantilla que nunca se completó. */
  motivo: "falta" | "plantilla";
}

/** Las dos páginas mínimas antes de recibir datos y pagos en la tienda. */
export const SLUGS_LEGALES_OBLIGATORIOS = [
  "politica-de-privacidad",
  "terminos-y-condiciones",
] as const;

/**
 * Bloque mínimo, legible y reutilizable para una política existente.
 * Se exporta para que el editor pueda proponerlo como borrador sin reemplazar
 * el texto propio del comercio ni publicarlo en su nombre.
 */
export function storeAnalyticsDisclosureBlock(): string {
  return `## Medición propia de la tienda

Para medir si la tienda funciona, registramos visitas de 30 minutos con un
identificador aleatorio cuyo valor se guarda hasheado, la primera fuente UTM y
el dominio que te derivó. Esta medición no guarda tu IP, identidad, URL completa
ni datos de los formularios, y se elimina automáticamente a los 13 meses.`;
}

/** Mismos cinco límites que valida la función SQL, sin exigir publicación. */
export function storeAnalyticsDisclosureContentReady(content: string | null): boolean {
  const normalized = String(content ?? '').toLocaleLowerCase('es-AR');
  return [
    'visitas de 30 minutos',
    'utm',
    'ip',
    'url completa',
    '13 meses',
  ].every(fragment => normalized.includes(fragment));
}

/**
 * Gate visible equivalente a `store_analytics_disclosure_ready` en SQL.
 * No firma por el comercio: sólo verifica que la política publicada contiene
 * los cinco límites que el owner debe reconocer al activar la medición.
 */
export function storeAnalyticsDisclosureReady(
  pages: { slug: string; content: string | null; status: string | null }[],
): boolean {
  const privacy = pages.find(page => (
    page.slug === 'politica-de-privacidad' && page.status === 'published'
  ));
  return storeAnalyticsDisclosureContentReady(privacy?.content ?? null);
}

export interface EstadoPublicacionLegal {
  /** Hay contenido propio (o generado y revisado) publicado para ambas páginas. */
  listaParaPublicar: boolean;
  /** Falta la página o conserva texto semilla que no identifica al comercio. */
  faltantesOPlantilla: number;
  /** El texto existe pero todavía no lo ve quien compra. */
  borradores: number;
}

/**
 * Distingue "hay texto" de "el comprador lo puede leer".
 *
 * El generador crea borradores a propósito: publicar una política por el
 * comercio sería firmarla en su nombre. Por eso un borrador no habilita la
 * tienda, aunque no sea una plantilla incompleta.
 */
export function estadoPublicacionLegal(
  existentes: { slug: string; content: string | null; status?: string | null }[],
): EstadoPublicacionLegal {
  let faltantesOPlantilla = 0;
  let borradores = 0;

  for (const slug of SLUGS_LEGALES_OBLIGATORIOS) {
    const pagina = existentes.find(p => p.slug === slug);
    if (!pagina || esPlantillaSinCompletar(pagina.content)) {
      faltantesOPlantilla += 1;
    } else if (pagina.status !== "published") {
      borradores += 1;
    }
  }

  return {
    listaParaPublicar: faltantesOPlantilla === 0 && borradores === 0,
    faltantesOPlantilla,
    borradores,
  };
}

/**
 * Qué páginas legales hay que crear o reemplazar.
 *
 * Devuelve **sólo** lo que falta o sigue siendo plantilla. Una página que el
 * comercio escribió no aparece, así que apretar el botón dos veces no puede
 * pisar nada — es la misma garantía que "Completar pesos" y "Completar el
 * tarifario".
 */
export function paginasLegalesPendientes(
  d: DatosDelComercio,
  existentes: { slug: string; content: string | null }[],
): PaginaLegal[] {
  const propuestas: { slug: string; title: string; content: string }[] = [
    {
      slug: "politica-de-privacidad",
      title: "Política de privacidad",
      content: politicaDePrivacidad(d),
    },
    {
      slug: "terminos-y-condiciones",
      title: "Términos y condiciones",
      content: terminosYCondiciones(d),
    },
  ];

  const salida: PaginaLegal[] = [];
  for (const p of propuestas) {
    const actual = existentes.find(e => e.slug === p.slug);
    if (!actual) { salida.push({ ...p, motivo: "falta" }); continue; }
    if (esPlantillaSinCompletar(actual.content)) {
      salida.push({ ...p, motivo: "plantilla" });
    }
  }
  return salida;
}
