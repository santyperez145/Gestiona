type BrandOptions = {
  faviconUrl?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  storeName: string;
};

type AttributeSnapshot = { element: Element; name: string; value: string | null };

function remember(element: Element, name: string, snapshots: AttributeSnapshot[]) {
  snapshots.push({ element, name, value: element.getAttribute(name) });
}

function headElement(selector: string, tag: "link" | "meta") {
  const current = document.head.querySelector<HTMLElement>(selector);
  if (current) return { element: current, created: false };
  const element = document.createElement(tag);
  document.head.appendChild(element);
  return { element, created: true };
}

/** Aplica identidad de la tienda y devuelve una restauración para volver al panel. */
export function applyStorefrontDocumentBrand(options: BrandOptions): () => void {
  const favicon = options.faviconUrl?.trim() || options.logoUrl?.trim() || "/brand/nerqia-mark.png";
  const snapshots: AttributeSnapshot[] = [];
  const created: Element[] = [];

  const icon = headElement('link[rel="icon"]', "link");
  if (icon.created) created.push(icon.element);
  for (const attribute of ["rel", "href", "type", "sizes"]) remember(icon.element, attribute, snapshots);
  icon.element.setAttribute("rel", "icon");
  icon.element.setAttribute("href", favicon);
  icon.element.removeAttribute("type");
  icon.element.removeAttribute("sizes");

  const apple = headElement('link[rel="apple-touch-icon"]', "link");
  if (apple.created) created.push(apple.element);
  for (const attribute of ["rel", "href"]) remember(apple.element, attribute, snapshots);
  apple.element.setAttribute("rel", "apple-touch-icon");
  apple.element.setAttribute("href", favicon);

  const color = options.primaryColor?.trim();
  if (color && /^#[0-9a-f]{6}$/i.test(color)) {
    const theme = headElement('meta[name="theme-color"]', "meta");
    if (theme.created) created.push(theme.element);
    for (const attribute of ["name", "content"]) remember(theme.element, attribute, snapshots);
    theme.element.setAttribute("name", "theme-color");
    theme.element.setAttribute("content", color);
  }

  const appTitle = headElement('meta[name="apple-mobile-web-app-title"]', "meta");
  if (appTitle.created) created.push(appTitle.element);
  for (const attribute of ["name", "content"]) remember(appTitle.element, attribute, snapshots);
  appTitle.element.setAttribute("name", "apple-mobile-web-app-title");
  appTitle.element.setAttribute("content", options.storeName.trim() || "Tienda online");

  return () => {
    for (const { element, name, value } of snapshots.reverse()) {
      if (created.includes(element)) continue;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    for (const element of created) element.remove();
  };
}
