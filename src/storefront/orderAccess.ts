const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOrderAccessToken(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

export function orderAccessStorageKey(slug: string, orderNumber: string) {
  return `gestiona.order.access.${slug.toLowerCase()}.${orderNumber}`;
}

export function saveOrderAccessToken(slug: string, orderNumber: string, token: unknown) {
  if (!isOrderAccessToken(token)) return null;
  const clean = token.trim();
  try {
    sessionStorage.setItem(orderAccessStorageKey(slug, orderNumber), clean);
  } catch {
    // Una sesion con storage bloqueado sigue pudiendo usar el token en memoria.
  }
  return clean;
}

export function readOrderAccessToken(slug: string, orderNumber: string) {
  try {
    const token = sessionStorage.getItem(orderAccessStorageKey(slug, orderNumber));
    return isOrderAccessToken(token) ? token.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Los emails llevan la capacidad en el fragmento: el navegador no la envia en
 * el request HTTP ni como Referer. Al abrirla se guarda en sessionStorage y se
 * limpia la barra antes de cargar datos personales.
 */
export function consumeOrderAccessFragment(slug: string, orderNumber: string) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = saveOrderAccessToken(slug, orderNumber, params.get("access"));
  if (token) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
  return token;
}

export function orderAccessFragment(token: unknown) {
  return isOrderAccessToken(token) ? `#access=${encodeURIComponent(token.trim())}` : "";
}
