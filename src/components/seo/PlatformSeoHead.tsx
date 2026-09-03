import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { BRAND_DOMAIN } from '@/lib/brand';
import { normalizeHostname } from '@/lib/storefrontHost';
import { platformCanonicalUrl, platformSeoPage } from '@/lib/platformSeo';

function meta(selector: string, attributes: Record<string, string>): HTMLMetaElement {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/** Mantiene title/canonical/robots correctos también después de navegar la SPA. */
export default function PlatformSeoHead() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const host = normalizeHostname(window.location.hostname);
    const isPlatform = host === BRAND_DOMAIN
      || host === `www.${BRAND_DOMAIN}`
      || host === 'localhost'
      || host === '127.0.0.1';
    if (!isPlatform) return;

    const publicPage = pathname === '/' && user ? null : platformSeoPage(pathname);
    const canonical = platformCanonicalUrl(publicPage?.path ?? pathname);
    let canonicalLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonical;

    const indexable = Boolean(publicPage?.indexable);
    meta('meta[name="robots"]', { name: 'robots', content: indexable ? 'index,follow' : 'noindex,nofollow' });

    if (!publicPage) return;
    document.title = publicPage.title;
    meta('meta[name="description"]', { name: 'description', content: publicPage.description });
    meta('meta[property="og:title"]', { property: 'og:title', content: publicPage.title });
    meta('meta[property="og:description"]', { property: 'og:description', content: publicPage.description });
    meta('meta[property="og:url"]', { property: 'og:url', content: canonical });
  }, [pathname, user]);

  return null;
}
