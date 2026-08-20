/**
 * De qué certificado se factura — C14.
 *
 * Hay dos modos y esta función es el único lugar que decide entre ellos:
 *
 * - **`propio`**: el comercio subió su certificado. Todo sale de su fila.
 * - **`delegado`**: el comercio sólo cargó CUIT y razón social, y delegó `wsfe`
 *   al CUIT de la plataforma desde el Administrador de Relaciones. El
 *   certificado, la clave y el Ticket de Acceso son los de la plataforma; lo
 *   único que aporta el comercio es **su CUIT**, que va en el `<Auth>` de
 *   FECAESolicitar y es lo que decide a nombre de quién se emite.
 *
 * ⚠️ **El Ticket de Acceso del modo delegado es UNO para toda la plataforma.**
 * WSAA entrega el TA por (certificado, servicio) y rechaza el pedido siguiente
 * mientras el anterior siga vivo. Con un certificado compartido, guardarlo en
 * la fila de cada comercio haría que el segundo en facturar pida uno nuevo y
 * WSAA lo rechace — el mismo error que ya costó una tarde en la sesión 114,
 * pero disparándose entre organizaciones distintas y por lo tanto imposible de
 * reproducir mirando una sola. Por eso el TA delegado se lee y se guarda en
 * `afip_platform_credentials`.
 *
 * ⚠️ **En modo delegado el ambiente lo manda la plataforma, no el comercio.**
 * Un certificado de homologación no sirve contra el WSAA de producción: si el
 * comercio pudiera elegir "producción" mientras la plataforma tiene el
 * certificado de homologación, el error llegaría recién al facturar y sonaría a
 * problema del comercio.
 */

export type ModoAfip = "delegado" | "propio";

export type CredencialesAfip = {
  /** El CUIT que emite. Siempre el del comercio, en los dos modos. */
  cuit: string;
  certificate: string;
  private_key: string;
  environment: string;
  punto_venta: number;
  tipo_emisor: string | null;
  modo: ModoAfip;
  ta_token: string | null;
  ta_sign: string | null;
  ta_expires_at: string | null;
};

type Resultado = { cred: CredencialesAfip; error?: undefined } | { cred?: undefined; error: string };

// deno-lint-ignore no-explicit-any
export async function resolverCredencialesAfip(supabase: any, orgId: string): Promise<Resultado> {
  const { data: org, error: errOrg } = await supabase
    .from("afip_credentials")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  // ⚠️ No se traga el error: "no pude leer" y "no hay nada configurado" son
  // problemas opuestos y el mensaje manda a revisar lugares distintos.
  if (errOrg) return { error: `No se pudo leer la configuración de AFIP: ${errOrg.message}` };
  if (!org?.cuit) return { error: "AFIP no configurado: falta el CUIT" };

  const modo: ModoAfip = org.modo === "propio" ? "propio" : "delegado";

  if (modo === "propio") {
    if (!org.certificate) return { error: "AFIP no configurado: falta el certificado PEM" };
    if (!org.private_key) return { error: "AFIP no configurado: falta la clave privada PEM" };
    return {
      cred: {
        cuit: String(org.cuit),
        certificate: org.certificate,
        private_key: org.private_key,
        environment: org.environment,
        punto_venta: org.punto_venta || 1,
        tipo_emisor: org.tipo_emisor ?? null,
        modo,
        ta_token: org.ta_token ?? null,
        ta_sign: org.ta_sign ?? null,
        ta_expires_at: org.ta_expires_at ?? null,
      },
    };
  }

  const { data: plat, error: errPlat } = await supabase
    .from("afip_platform_credentials")
    .select("*")
    .maybeSingle();

  if (errPlat) return { error: `No se pudo leer el certificado de la plataforma: ${errPlat.message}` };
  if (!plat?.certificate || !plat?.private_key) {
    // Este mensaje es para el comercio y tiene que dejar claro de quién es el
    // problema: no hay nada que él pueda arreglar.
    return { error: "La plataforma todavía no tiene cargado su certificado de AFIP. No es un problema de tu configuración." };
  }

  return {
    cred: {
      cuit: String(org.cuit),
      certificate: plat.certificate,
      private_key: plat.private_key,
      environment: plat.environment,
      punto_venta: org.punto_venta || 1,
      tipo_emisor: org.tipo_emisor ?? null,
      modo,
      ta_token: plat.ta_token ?? null,
      ta_sign: plat.ta_sign ?? null,
      ta_expires_at: plat.ta_expires_at ?? null,
    },
  };
}

/** Guarda el Ticket de Acceso donde corresponde según el modo. */
// deno-lint-ignore no-explicit-any
export async function guardarTicketAcceso(
  supabase: any,
  cred: CredencialesAfip,
  orgId: string,
  ta: { token: string; sign: string; expiresAt: string },
): Promise<{ error?: string }> {
  const fila = {
    ta_token: ta.token,
    ta_sign: ta.sign,
    ta_expires_at: ta.expiresAt,
    updated_at: new Date().toISOString(),
  };

  const { error } = cred.modo === "propio"
    ? await supabase.from("afip_credentials").update(fila).eq("org_id", orgId)
    : await supabase.from("afip_platform_credentials").update(fila).eq("id", true);

  return error ? { error: error.message } : {};
}
