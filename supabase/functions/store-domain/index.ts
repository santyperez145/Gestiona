/**
 * Alta, verificación y baja de dominios propios de una tienda.
 *
 * VERCEL_TOKEN queda exclusivamente en Supabase. El navegador recibe sólo los
 * challenges/registros DNS sanitizados; nunca la respuesta cruda del proveedor.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { requireUser } from '../_shared/requireUser.ts';
import {
  sanitizedStoreDomainState,
  validateStoreDomainServer,
  type VercelDomainConfig,
  type VercelProjectDomain,
} from '../_shared/storeDomain.ts';

const PROJECT_ID = Deno.env.get('VERCEL_PROJECT_ID') || 'prj_fHuBWInXh7TNHMNhgY4TRg9uKkOu';
const TEAM_ID = Deno.env.get('VERCEL_TEAM_ID') || 'team_OgepxvG3pxNFid7y2F0ZuHiH';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  'https://nerqia.app',
  'https://www.nerqia.app',
  'https://app.nerqia.app',
  'https://exentryimports.vercel.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(req), 'Content-Type': 'application/json' },
});

interface ProviderResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function vercel<T>(token: string, path: string, init?: RequestInit): Promise<ProviderResult<T>> {
  const join = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.vercel.com${path}${join}teamId=${encodeURIComponent(TEAM_ID)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => null) as T | null;
  return { ok: response.ok, status: response.status, data };
}

function safeProviderCode(result: ProviderResult<unknown>): string {
  const data = result.data as { error?: { code?: unknown } | string; code?: unknown } | null;
  const candidate = typeof data?.error === 'object' ? data.error?.code : data?.code;
  return String(candidate ?? `vercel_http_${result.status}`).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
}

Deno.serve(async req => {
  const origin = req.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: 'Origen no permitido' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido' }, 405);

  const auth = await requireUser(req, cors(req));
  if (auth.response) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as { action?: unknown; orgId?: unknown; domain?: unknown };
    const action = String(body.action ?? '');
    const orgId = String(body.orgId ?? '');
    if (!UUID.test(orgId)) return json(req, { error: 'Organización inválida' }, 400);
    if (!['connect', 'verify', 'disconnect'].includes(action)) {
      return json(req, { error: 'Acción inválida' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });
    const { data: membership, error: membershipError } = await asUser
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (membershipError) {
      console.error('store-domain membership:', membershipError);
      return json(req, { error: 'No se pudo validar el permiso' }, 500);
    }
    if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
      return json(req, { error: 'Necesitás ser administrador de esta organización' }, 403);
    }

    const { data: store, error: storeError } = await admin
      .from('ecommerce_stores')
      .select('id, custom_domain, custom_domain_status, custom_domain_verification, custom_domain_verified_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (storeError) {
      console.error('store-domain store:', storeError);
      return json(req, { error: 'No se pudo leer la tienda' }, 500);
    }
    if (!store) return json(req, { error: 'Primero creá y guardá la tienda' }, 409);

    const token = Deno.env.get('VERCEL_TOKEN');
    if (!token) {
      return json(req, {
        error: 'La plataforma todavía no configuró el proveedor de dominios.',
        code: 'provider_not_configured',
      }, 503);
    }

    if (action === 'disconnect') {
      const domain = String(store.custom_domain ?? '');
      if (!domain) return json(req, { ok: true, status: 'none' });
      const localVerification = store.custom_domain_verification && typeof store.custom_domain_verification === 'object'
        ? store.custom_domain_verification as { provider?: unknown; attached?: unknown }
        : {};
      const knownAttached = localVerification.provider === 'vercel' && localVerification.attached === true;
      const removed = await vercel<unknown>(
        token,
        `/v9/projects/${encodeURIComponent(PROJECT_ID)}/domains/${encodeURIComponent(domain)}`,
        { method: 'DELETE' },
      );
      if (!removed.ok && removed.status !== 404 && (knownAttached || removed.status >= 500)) {
        return json(req, { error: 'Vercel no pudo desconectar el dominio. Reintentá.', code: safeProviderCode(removed) }, 502);
      }
      const { error } = await admin.from('ecommerce_stores').update({
        custom_domain: null,
        custom_domain_status: 'none',
        custom_domain_verification: {},
        custom_domain_claimed_at: null,
        custom_domain_checked_at: new Date().toISOString(),
        custom_domain_verified_at: null,
        custom_domain_error_code: null,
      }).eq('id', store.id);
      if (error) {
        console.error('store-domain disconnect persist:', error);
        return json(req, { error: 'El dominio se retiró del proveedor, pero falta limpiar la tienda. Contactá soporte.' }, 500);
      }
      return json(req, { ok: true, status: 'none' });
    }

    let domain = String(store.custom_domain ?? '');
    if (action === 'connect') {
      const checked = validateStoreDomainServer(body.domain);
      if (!checked.valid) return json(req, { error: checked.error }, 400);
      domain = checked.domain;
      if (store.custom_domain && String(store.custom_domain).toLowerCase() !== domain) {
        return json(req, { error: 'Desconectá el dominio actual antes de conectar otro.' }, 409);
      }
      const { error: claimError } = await admin.from('ecommerce_stores').update({
        custom_domain: domain,
        custom_domain_status: 'pending_verification',
        custom_domain_verification: {},
        custom_domain_claimed_at: store.custom_domain ? undefined : new Date().toISOString(),
        custom_domain_checked_at: null,
        custom_domain_verified_at: null,
        custom_domain_error_code: null,
      }).eq('id', store.id);
      if (claimError) {
        const conflict = String(claimError.code) === '23505';
        return json(req, {
          error: conflict ? 'Ese dominio ya está conectado a otra tienda.' : 'No se pudo reservar el dominio.',
          code: conflict ? 'domain_claimed' : 'claim_failed',
        }, conflict ? 409 : 500);
      }

      let added = await vercel<VercelProjectDomain>(
        token,
        `/v10/projects/${encodeURIComponent(PROJECT_ID)}/domains`,
        { method: 'POST', body: JSON.stringify({ name: domain }) },
      );
      // Reintento idempotente: el dominio puede haberse agregado en una llamada
      // anterior cuya respuesta no llegó al navegador.
      if (!added.ok && (added.status === 400 || added.status === 409)) {
        added = await vercel<VercelProjectDomain>(
          token,
          `/v9/projects/${encodeURIComponent(PROJECT_ID)}/domains/${encodeURIComponent(domain)}`,
        );
      }
      if (!added.ok || !added.data) {
        const code = safeProviderCode(added);
        await admin.from('ecommerce_stores').update({
          custom_domain_status: 'provider_error',
          custom_domain_checked_at: new Date().toISOString(),
          custom_domain_error_code: code,
        }).eq('id', store.id);
        return json(req, { error: 'Vercel no pudo agregar el dominio. Reintentá o contactá soporte.', code }, 502);
      }
    }

    if (!domain) return json(req, { error: 'No hay un dominio para verificar' }, 409);

    let projectDomain = await vercel<VercelProjectDomain>(
      token,
      `/v9/projects/${encodeURIComponent(PROJECT_ID)}/domains/${encodeURIComponent(domain)}`,
    );
    if (!projectDomain.ok || !projectDomain.data) {
      const code = safeProviderCode(projectDomain);
      await admin.from('ecommerce_stores').update({
        custom_domain_status: 'provider_error',
        custom_domain_verification: { provider: 'vercel', attached: true, records: [] },
        custom_domain_checked_at: new Date().toISOString(),
        custom_domain_error_code: code,
      }).eq('id', store.id);
      return json(req, { error: 'No se pudo consultar el dominio en Vercel.', code }, 502);
    }

    if (action === 'verify' && projectDomain.data.verified !== true) {
      const verified = await vercel<VercelProjectDomain>(
        token,
        `/v9/projects/${encodeURIComponent(PROJECT_ID)}/domains/${encodeURIComponent(domain)}/verify`,
        { method: 'POST' },
      );
      // Un TXT todavía no propagado devuelve 400: se conserva el challenge y
      // se muestra como pendiente, no como caída de la plataforma.
      if (verified.ok && verified.data) projectDomain = verified;
    }

    const config = await vercel<VercelDomainConfig>(
      token,
      `/v6/domains/${encodeURIComponent(domain)}/config`,
    );
    if (!config.ok || !config.data) {
      const code = safeProviderCode(config);
      await admin.from('ecommerce_stores').update({
        custom_domain_status: 'provider_error',
        custom_domain_verification: { provider: 'vercel', attached: true, records: [] },
        custom_domain_checked_at: new Date().toISOString(),
        custom_domain_error_code: code,
      }).eq('id', store.id);
      return json(req, { error: 'No se pudo comprobar la configuración DNS.', code }, 502);
    }

    const projectDomainData = projectDomain.data;
    const configData = config.data;
    if (!projectDomainData || !configData) {
      return json(req, { error: 'El proveedor devolvió un estado incompleto.' }, 502);
    }
    const state = sanitizedStoreDomainState(domain, projectDomainData, configData);
    const now = new Date().toISOString();
    const verifiedAt = state.status === 'active'
      ? (store.custom_domain_verified_at || now)
      : store.custom_domain_verified_at;
    const { error: persistError } = await admin.from('ecommerce_stores').update({
      custom_domain_status: state.status,
      custom_domain_verification: state.verification,
      custom_domain_checked_at: now,
      custom_domain_verified_at: verifiedAt,
      custom_domain_error_code: null,
    }).eq('id', store.id);
    if (persistError) {
      console.error('store-domain persist state:', persistError);
      return json(req, { error: 'El proveedor respondió, pero no se pudo guardar el estado.' }, 500);
    }

    return json(req, { ok: true, domain, status: state.status, verification: state.verification, checkedAt: now });
  } catch (error) {
    console.error('store-domain:', error);
    return json(req, { error: 'No se pudo administrar el dominio en este momento.' }, 500);
  }
});
