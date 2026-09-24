/**
 * Medios seguros de la vitrina.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Google Chrome y Safe Browsing marcan «No seguro» cuando una página HTTPS
 * carga imágenes por HTTP (contenido mixto). Es la primera alerta que ve un
 * cliente cuando entra a la tienda por Google y mata la conversión.
 *
 * Las URLs de producto entran del comercio (import Excel, migración, carga
 * manual) y cualquiera puede venir con `http://`. El servidor las revalida al
 * importar (`catalogMigration.ts`), pero la vitrina no puede confiar en que
 * todo el stock histórico esté limpio: se normaliza al renderizar.
 *
 * 📌 Regla: `http://` se sube a `https://` sólo cuando el host es un dominio
 * público; IPs y localhost se dejan (ambientes de prueba). Si el host no tiene
 * TLS real, el fallback de imagen rota cubre la página — mejor una imagen
 * ausente que una alerta de inseguridad en toda la tienda.
 */

/** Normaliza una URL de medio de la tienda a HTTPS cuando corresponde. */
export function urlMediaSegura(
  value: string | null | undefined,
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // Ya segura: no se toca.
  if (/^https:\/\//i.test(raw)) return raw;

  // Protocolo relativo: hereda el esquema de la página, ya es seguro.
  if (raw.startsWith("//")) return raw;

  // HTTP explícito: dominio público → forzar HTTPS. localhost/IP queda igual.
  if (/^http:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const esLocal = host === "localhost" || host.endsWith(".localhost");
      const esIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
      if (esLocal || esIp) return raw;
      u.protocol = "https:";
      return u.toString();
    } catch {
      return null;
    }
  }

  // Sin esquema: `midominio.com/img.jpg` → HTTPS. Los paths relativos
  // (`/img.jpg`) no pasan por acá: quien los renderiza los resuelve con base.
  if (/^[a-z0-9]/i.test(raw) && raw.includes(".") && !raw.startsWith("/")) {
    return `https://${raw}`;
  }

  // Path relativo o data URI: dejar tal cual.
  return raw;
}

/** `true` si la URL es de un host con HTTPS forzado (para tests y preview). */
export function esUrlHttpInsegura(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.toLowerCase();
    const esLocal = host === "localhost" || host.endsWith(".localhost");
    const esIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    return u.protocol === "http:" && !esLocal && !esIp;
  } catch {
    return false;
  }
}