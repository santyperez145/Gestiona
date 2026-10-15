/**
 * Estado de los servicios que vienen con Nerqia (2026-10-15). Antes todos
 * decían «✓ Activo» fijo, aunque WhatsApp no estuviera configurado en la
 * plataforma o el respaldo del negocio hubiera fallado.
 */
export interface EstadoDeServicio {
  id: "ia" | "correo" | "campanas" | "respaldos" | "suscripcion" | "whatsapp";
  nombre: string;
  detalle: string;
  estado: "activo" | "atencion" | "no_disponible" | "sin_datos";
  etiqueta: string;
}

export function estadoDeServicios(f: {
  /** `mensajeria_de_plataforma()`; undefined = cargando, null = no se pudo leer. */
  mensajeria: { email_listo?: boolean; smtp_configurado?: boolean; whatsapp_listo?: boolean } | null | undefined;
  /** Último respaldo del negocio; undefined = cargando, null = ninguno o no se pudo leer. */
  ultimoRespaldo: { status: string; created_at: string } | null | undefined;
  puedeVerRespaldos: boolean;
  /** ¿El plan vigente incluye IA? undefined = cargando. */
  iaIncluida?: boolean;
  ahora?: Date;
}): EstadoDeServicio[] {
  const ahora = f.ahora ?? new Date();
  const cargando = f.mensajeria === undefined;
  const correoListo = !!(f.mensajeria?.email_listo || f.mensajeria?.smtp_configurado);
  const correo = (id: "correo" | "campanas", nombre: string, detalle: string): EstadoDeServicio =>
    cargando ? { id, nombre, detalle, estado: "sin_datos", etiqueta: "…" }
      : f.mensajeria === null ? { id, nombre, detalle, estado: "sin_datos", etiqueta: "Sin datos" }
        : correoListo ? { id, nombre, detalle, estado: "activo", etiqueta: "✓ Activo" }
          : { id, nombre, detalle: `${detalle}. Se está configurando: los envíos quedan en espera, no se pierden`, estado: "atencion", etiqueta: "En espera" };

  const respaldos = ((): EstadoDeServicio => {
    const base = { id: "respaldos" as const, nombre: "Respaldos automáticos" };
    if (!f.puedeVerRespaldos) return { ...base, detalle: "Respaldo de toda tu información (lo ve el dueño)", estado: "activo", etiqueta: "✓ Incluido" };
    if (f.ultimoRespaldo === undefined) return { ...base, detalle: "Respaldo de toda tu información", estado: "sin_datos", etiqueta: "…" };
    if (f.ultimoRespaldo === null) return { ...base, detalle: "Todavía no hay un respaldo de tu negocio: se hace solo por la noche", estado: "atencion", etiqueta: "Pendiente" };
    const dias = Math.floor((ahora.getTime() - new Date(f.ultimoRespaldo.created_at).getTime()) / 86_400_000);
    const cuando = dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`;
    if (f.ultimoRespaldo.status !== "completed") return { ...base, detalle: `El último respaldo (${cuando}) falló; se reintenta solo esta noche`, estado: "atencion", etiqueta: "Atención" };
    if (dias > 8) return { ...base, detalle: `Último respaldo completo ${cuando}`, estado: "atencion", etiqueta: "Atención" };
    return { ...base, detalle: `Último respaldo completo ${cuando}`, estado: "activo", etiqueta: "✓ Activo" };
  })();

  const whatsapp: EstadoDeServicio = cargando
    ? { id: "whatsapp", nombre: "WhatsApp en automatizaciones", detalle: "Mensajes automáticos en flujos", estado: "sin_datos", etiqueta: "…" }
    : f.mensajeria?.whatsapp_listo
      ? { id: "whatsapp", nombre: "WhatsApp en automatizaciones", detalle: "Mensajes automáticos en flujos (si aplica a tu plan)", estado: "activo", etiqueta: "✓ Activo" }
      : { id: "whatsapp", nombre: "WhatsApp en automatizaciones", detalle: "Todavía no disponible: los flujos usan correo. Para tu propio número, conectá WhatsApp abajo", estado: "no_disponible", etiqueta: "Próximamente" };

  return [
    // 2026-10-15: decía «✓ Activo» fijo también con la prueba vencida, cuando
    // el plan ya no incluye IA.
    f.iaIncluida === undefined
      ? { id: "ia", nombre: "Inteligencia Artificial", detalle: "Asistente y descripciones automáticas", estado: "sin_datos", etiqueta: "…" }
      : f.iaIncluida
        ? { id: "ia", nombre: "Inteligencia Artificial", detalle: "Asistente y descripciones automáticas", estado: "activo", etiqueta: "✓ Activo" }
        : { id: "ia", nombre: "Inteligencia Artificial", detalle: "Asistente y descripciones automáticas: vienen con los planes pagos", estado: "no_disponible", etiqueta: "Plan pago" },
    correo("correo", "Emails transaccionales", "Facturas por email, recuperación de contraseña"),
    correo("campanas", "Campañas de email", "Email marketing a tus clientes"),
    respaldos,
    { id: "suscripcion", nombre: "Cobros de suscripción", detalle: "Tu plan de Nerqia se cobra en pesos con Mercado Pago", estado: "activo", etiqueta: "✓ Activo" },
    whatsapp,
  ];
}
