import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { requireUser } from '../_shared/requireUser.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RequestBody = {
  action?: 'save' | 'revoke';
  orgId?: string;
  apiUrl?: string;
  apiKey?: string;
  instance?: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Método no permitido' }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null) as RequestBody | null;
  const orgId = body?.orgId;
  const action = body?.action;
  if (!orgId || (action !== 'save' && action !== 'revoke')) {
    return response({ error: 'orgId y una acción válida son obligatorios' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return response({ error: 'Servicio no configurado' }, 503);
  const admin = createClient(url, serviceRole);

  const { data: membership, error: membershipError } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', auth.user.id)
    .in('role', ['owner', 'admin'])
    .maybeSingle();
  if (membershipError) return response({ error: 'No se pudo verificar el permiso' }, 500);
  if (!membership) return response({ error: 'Sólo dueños o administradores pueden gestionar esta conexión' }, 403);

  if (action === 'revoke') {
    const { error } = await admin.from('evolution_connections').delete().eq('org_id', orgId);
    if (error) return response({ error: 'No se pudo revocar la conexión' }, 500);
    await admin.from('integration_logs').insert({
      org_id: orgId,
      integration: 'evolution_api',
      event: 'credentials_revoked',
      status: 'warning',
      message: 'La conexión de WhatsApp fue revocada por un administrador.',
    });
    return response({ configured: false });
  }

  const apiUrl = typeof body?.apiUrl === 'string' ? parseUrl(body.apiUrl) : null;
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const instance = typeof body?.instance === 'string' ? body.instance.trim() : '';
  if (!apiUrl || apiKey.length < 8 || apiKey.length > 2048 || !instance || instance.length > 120 || /\s/.test(instance)) {
    return response({ error: 'Ingresá una URL HTTPS, una API key válida y una instancia sin espacios' }, 400);
  }

  const { error } = await admin.from('evolution_connections').upsert({
    org_id: orgId,
    api_url: apiUrl,
    api_key: apiKey,
    instance,
  }, { onConflict: 'org_id' });
  if (error) return response({ error: 'No se pudo guardar la conexión' }, 500);

  await admin.from('integration_logs').insert({
    org_id: orgId,
    integration: 'evolution_api',
    event: 'credentials_updated',
    status: 'ok',
    message: 'La conexión de WhatsApp fue actualizada por un administrador.',
  });

  // Nunca se devuelven la URL ni la API key: la UI sólo necesita saber que
  // puede continuar con el proxy seguro para estado y QR.
  return response({ configured: true, instance });
});
