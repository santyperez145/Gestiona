/**
 * Contacto de la vitrina: WhatsApp e Instagram.
 *
 * `ecommerce_stores.social_links` existía y `get_store_by_slug` ya lo
 * devolvía. Commerce nunca lo escribía: Exentry quedó `{}` y el pie de la
 * tienda tenía un hueco de Instagram vacío. Tiendanube/Shopify muestran
 * WhatsApp en la vitrina; acá el número lo carga el comercio, no se toma
 * de `settings.whatsapp_number` (ése es el digest del dueño).
 *
 * El href se construye: no se pega una URL cruda. Un `javascript:` en
 * `social_links` no llega al comprador.
 */

export type StoreSocialLinks = {
  whatsapp?: string;
  instagram?: string;
};

const HANDLE_IG = /^[A-Za-z0-9._]{1,30}$/;

function soloDigitos(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Acepta número, `wa.me` o `api.whatsapp.com/send?phone=`.
 * Devuelve `https://wa.me/E164` o null. No inventa el 54.
 */
export function hrefWhatsApp(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (t.includes(":") && !/^https?:\/\//i.test(t) && !/^tel:/i.test(t)) return null;

  let digits = "";
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (host === "wa.me" || host === "api.whatsapp.com" || host === "whatsapp.com") {
        const phone = u.searchParams.get("phone");
        digits = soloDigitos(phone || u.pathname);
      } else {
        return null;
      }
    } else {
      digits = soloDigitos(t);
    }
  } catch {
    return null;
  }

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}

/** Handle de Instagram, o null. No se acepta URL de otro host. */
export function handleInstagram(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;

  let handle = t.replace(/^@/, "");
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (host !== "instagram.com") return null;
      handle = u.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    return null;
  }

  handle = handle.replace(/^@/, "").replace(/\/+$/, "");
  if (!HANDLE_IG.test(handle)) return null;
  if (handle === "." || handle === "..") return null;
  return handle;
}

export function hrefInstagram(raw: string | null | undefined): string | null {
  const handle = handleInstagram(raw);
  return handle ? `https://www.instagram.com/${handle}/` : null;
}

export function parseStoreSocial(raw: unknown): StoreSocialLinks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const whatsapp = hrefWhatsApp(typeof o.whatsapp === "string" ? o.whatsapp : null);
  const instagram = hrefInstagram(typeof o.instagram === "string" ? o.instagram : null);
  const out: StoreSocialLinks = {};
  if (whatsapp) out.whatsapp = whatsapp;
  if (instagram) out.instagram = instagram;
  return out;
}

/** Lo que se guarda: sólo hrefs construidos. Vacío = `{}`, no se inventa red. */
export function socialLinksParaGuardar(input: {
  whatsapp?: string | null;
  instagram?: string | null;
}): StoreSocialLinks {
  return parseStoreSocial({
    whatsapp: input.whatsapp ?? "",
    instagram: input.instagram ?? "",
  });
}

/** Campo de edición: dígitos, no el href. */
export function displayWhatsApp(href: string | null | undefined): string {
  const parsed = hrefWhatsApp(href);
  return parsed ? parsed.replace("https://wa.me/", "") : "";
}

export function displayInstagram(href: string | null | undefined): string {
  const handle = handleInstagram(href);
  return handle ? `@${handle}` : "";
}

/**
 * Consulta con el nombre de la tienda. El texto lo elige Nerqia, no el
 * comercio: un `text=` pegado podría ser un reclamo falso prearmado.
 */
export function hrefWhatsAppConsultar(
  waMe: string | null | undefined,
  storeName: string | null | undefined,
): string | null {
  const base = hrefWhatsApp(waMe);
  if (!base) return null;
  const nombre = String(storeName ?? "").trim();
  const text = nombre
    ? `Hola, quiero consultar por ${nombre}`
    : "Hola, quiero consultar";
  return `${base}?text=${encodeURIComponent(text)}`;
}
