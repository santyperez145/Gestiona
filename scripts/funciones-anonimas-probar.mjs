// Auditoría: llama como `anon` (sin sesión) a cada función SECURITY DEFINER
// que anon puede ejecutar y que no es de la tienda pública ni un trigger, con
// el id de una organización real e ids al azar, dentro de una transacción que
// se revierte. Reporta cuáles NO rechazan: ésas hay que leerlas a mano.
//   node scripts/funciones-anonimas-probar.mjs
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Falta SUPABASE_DB_URL'); process.exit(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();

// Públicas a propósito: tienda, portal de creadores por token, bajas de mail.
const PUBLICA = /^(get_store_|get_my_|store_|save_store_cart|start_store_checkout|create_store_order|convert_store_cart|check_store_coupon|quote_store_shipping|record_store_visit|register_store_|request_st|upsert_store_customer|upsert_product_review|ask_product_question|can_review_product|toggle_wishlist|get_order_tracking|get_cart_by_recovery_token|get_public_|get_published_store_slug|list_published_store_slugs|get_store_slug_by_host|resolve_store_url_redirect|marca_nerqia_de_tienda|registrar_|pedir_aviso_de_busqueda|get_influencer_|accept_influencer_contract_by_token|respond_influencer_invitation|process_.*unsubscribe|dias_para_arrepentirse|cuotas_publicas|transferencia_tienda_lista|stock_en_vitrina)/;

const { rows: funcs } = await c.query(`
  select p.oid::regprocedure::text firma, p.proname, p.pronargs,
         array(select format_type(t, null) from unnest(p.proargtypes) t) tipos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE')
  order by p.proname`);
const { rows: [{ org }] } = await c.query('select id org from organizations order by created_at limit 1');

const valor = (tipo) => ({
  uuid: `'${org}'::uuid`, text: `'x'`, integer: '1', numeric: '1', boolean: 'true',
  date: 'current_date', 'timestamp with time zone': 'now()', jsonb: `'{}'::jsonb`,
  'text[]': `array['x']`, inet: `'127.0.0.1'::inet`, 'uuid[]': `array['${org}'::uuid]`,
}[tipo] ?? 'null');

const sinRechazo = [];
await c.query('begin');
for (const f of funcs) {
  if (PUBLICA.test(f.proname)) continue;
  const args = f.tipos.map(valor).join(', ');
  await c.query('savepoint s');
  try {
    await c.query(`set local role anon; set local request.jwt.claims = '{"role":"anon"}'`);
    const r = await c.query(`select ${f.firma.split('(')[0]}(${args}) as r`);
    sinRechazo.push(`${f.firma} → ${JSON.stringify(r.rows[0]?.r)?.slice(0, 80)}`);
  } catch (e) {
    if (!/permis|autoriz|no autentic|not authorized|denied|acceso|sesión|unauthor|forbidden|sin permiso/i.test(e.message)) {
      sinRechazo.push(`${f.firma} → error no de permisos: ${e.message.slice(0, 80)}`);
    }
  }
  await c.query('rollback to savepoint s');
}
await c.query('rollback');
await c.end();
console.log(sinRechazo.join('\n'));
console.log('sin rechazo de permisos:', sinRechazo.length);
