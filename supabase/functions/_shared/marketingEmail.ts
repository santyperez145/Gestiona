export function escapeMarketingHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

export function applyMarketingTemplate(
  template: string,
  variables: Record<string, string>,
  html = false,
): string {
  // One pass: customer data must never introduce a second template variable.
  return template.replace(/\{\{\s*(\w+)\s*\}\}|(?<!\{)\{\s*(\w+)\s*\}(?!\})/gi,
    (placeholder, doubleKey: string, singleKey: string) => {
      const key = (doubleKey ?? singleKey).toLowerCase();
      if (!Object.hasOwn(variables, key)) return placeholder;
      const value = String(variables[key] ?? "");
      return html ? escapeMarketingHtml(value) : value;
    });
}

export function withMarketingUnsubscribe(html: string, url: string, businessName?: string): string {
  const identity = businessName
    ? `<p>Recibís este email porque aceptaste novedades de ${escapeMarketingHtml(businessName)}.</p>`
    : "";
  const footer = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #ddd;font-size:12px">${identity}<a href="${escapeMarketingHtml(url)}">Cancelar suscripción</a></div>`;
  // An authored placeholder could be hidden; always include a visible link.
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, () => `${footer}</body>`)
    : html + footer;
}
