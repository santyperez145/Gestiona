/**
 * Semilla para el E2E contra un Supabase local (2026-10-23).
 *
 * Con la base reconstruida por `reproducir-migraciones.mjs`, crea lo mínimo
 * para que el panel funcione con datos: un usuario (por la API de Auth, como
 * uno real), su negocio con el alta terminada, productos, un cliente y la
 * identidad fiscal en homologación. Escribe en $GITHUB_ENV las variables que
 * usa Playwright (E2E_USER, E2E_PASSWORD, E2E_STORE_SLUG); la contraseña es
 * aleatoria y nunca se imprime.
 *
 * Uso: SIMULACRO_DB_URL=… SUPABASE_LOCAL_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_KEY=… node scripts/semilla-e2e-local.mjs
 * Nunca contra producción: se niega si las URL no son locales.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { esLocal } from "./simulacro-local.mjs";

export const EMAIL = "e2e@nerqia.test";
export const SLUG = "zz-e2e";
/** Comprador de la tienda con cuenta (2026-10-30): saldo a favor, cotización y cambio. */
export const EMAIL_COMPRADOR = "comprador-e2e@nerqia.test";
export const SALDO_COMPRADOR = 50000;
export const PRODUCTO_COMPRADOR = { name: "ZZ Cotizable mayorista", price: 10000, cost: 6000, stock: 1000 };
/** Más caro que el saldo que le queda: paga una parte con saldo y el resto por transferencia. */
export const PRODUCTO_COMPRADOR_CARO = { name: "ZZ Pedido grande", price: 60000, cost: 30000, stock: 100 };
/**
 * Sin stock y en preventa (20261030001900): se vende hasta el cupo y llega en
 * 20 días. El nombre se ordena después de las «ZZ Vitrina»: la preventa cuenta
 * como «a la venta» y, si se ordenara antes, correría a la segunda página la
 * única con variantes de la primera (tienda.spec.ts se salteaba 4 pruebas).
 */
export const PRODUCTO_PREVENTA = { name: "ZZ Zócalo en preventa", price: 25000, cost: 15000, stock: 0, cupo: 5 };

/**
 * Compra importada en dólares (cotización 1.000): $200.000 de lámparas y
 * $300.000 de pantallas. El circuito de gestión le carga el flete y mira el
 * costo puesto.
 */
export const COMPRA_IMPORTADA = {
  comprobante: "ZZ-IMPO-0001",
  cotizacion: 1000,
  productos: [
    { name: "ZZ Lámpara importada", price: 45000, cantidad: 10, usd: 20 },
    { name: "ZZ Pantalla importada", price: 22000, cantidad: 30, usd: 10 },
  ],
};

/** Catálogo de prueba: nombres, precios y stock fijos para que los specs los busquen. */
export const PRODUCTOS = [
  { name: "ZZ Tornillo 8x40", price: 120, cost: 60, stock: 500, sku: "ZZ-TOR-840" },
  { name: "ZZ Martillo carpintero", price: 18500, cost: 9200, stock: 12, sku: "ZZ-MAR-001" },
  { name: "ZZ Cable 2,5 mm", price: 950, cost: 480, stock: 300, sku: "ZZ-CAB-25" },
  { name: "ZZ Pintura látex 4 L", price: 32000, cost: 19000, stock: 0, sku: "ZZ-PIN-4L" },
];

async function main() {
  const db = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const api = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!esLocal(db) || !esLocal(api)) { console.error("::error::La semilla corre sólo contra una base local."); process.exitCode = 1; return; }
  if (!service) { console.error("::error::Falta SUPABASE_SERVICE_KEY (la de `supabase status`)."); process.exitCode = 1; return; }

  const password = randomBytes(18).toString("base64url") + "Aa1";
  const res = await fetch(`${api}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
  });
  const usuario = await res.json();
  if (!res.ok || !usuario.id) { console.error(`::error::No se creó el usuario de prueba: HTTP ${res.status} ${JSON.stringify(usuario).slice(0, 200)}`); process.exitCode = 1; return; }

  // El comprador se registra como comprador (account_type), igual que en la
  // tienda: así el trigger de alta no le crea un negocio.
  const passwordComprador = randomBytes(18).toString("base64url") + "Aa1";
  const resComprador = await fetch(`${api}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL_COMPRADOR, password: passwordComprador, email_confirm: true,
      user_metadata: { full_name: "ZZ Comprador E2E", account_type: "store_customer", store_slug: SLUG } }),
  });
  const comprador = await resComprador.json();
  if (!resComprador.ok || !comprador.id) { console.error(`::error::No se creó el comprador de prueba: HTTP ${resComprador.status} ${JSON.stringify(comprador).slice(0, 200)}`); process.exitCode = 1; return; }

  const c = new pg.Client({ connectionString: db });
  await c.connect();
  try {
    await c.query("BEGIN");
    // Al registrarse, un trigger ya le crea su negocio (como a un usuario real):
    // se completa ése, que es el que abre la app.
    const { rows: propios } = await c.query(`SELECT id FROM public.organizations WHERE owner_user_id = $1 ORDER BY created_at LIMIT 1`, [usuario.id]);
    const { rows: [org] } = propios.length
      ? await c.query(
          `UPDATE public.organizations SET name = 'ZZ Ferretería E2E', slug = $1, onboarding_completed = true, onboarding_goal = 'pos'
            WHERE id = $2 RETURNING id`, [SLUG, propios[0].id])
      : await c.query(
          `INSERT INTO public.organizations (name, slug, owner_user_id, onboarding_completed, onboarding_goal)
           VALUES ('ZZ Ferretería E2E', $1, $2, true, 'pos') RETURNING id`, [SLUG, usuario.id]);
    await c.query(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [org.id, usuario.id]);
    for (const p of PRODUCTOS) {
      await c.query(
        `INSERT INTO public.products (org_id, user_id, name, sale_price_ars, cost_ars, stock, sku)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [org.id, usuario.id, p.name, p.price, p.cost, p.stock, p.sku]);
    }
    await c.query(
      `INSERT INTO public.customers (org_id, user_id, name, email, tax_id, tax_id_type, vat_condition, legal_name)
       VALUES ($1, $2, 'ZZ Obra Norte', 'obra@nerqia.test', '30712345671', 'CUIT', 'responsable_inscripto', 'ZZ OBRA NORTE SA')`, [org.id, usuario.id]);
    await c.query(
      `INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
       VALUES ($1, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ FERRETERIA SRL', 'Av. ZZ 123, CABA')
       ON CONFLICT (org_id) DO NOTHING`, [org.id]);
    // La sucursal principal: la caja y su turno la necesitan.
    await c.query(`INSERT INTO public.locations (org_id, name, is_main, active) VALUES ($1, 'ZZ Casa central', true, true)`, [org.id]);
    // La tienda online del negocio, activa, con envío fijo y transferencia: la
    // vitrina pública la recorren los specs de la tienda.
    // Envío por zonas (lo que usa una tienda real: el cotizador por provincia
    // de la ficha) y retiro en el local, que no pide domicilio.
    const { rows: [tienda] } = await c.query(
      `INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_mode, shipping_cost, pickup_enabled, pickup_address)
       VALUES ($1, $2, 'ZZ Ferretería E2E', true, ARRAY['transferencia'], 'zones', 3500, true, 'Av. ZZ 123, CABA') RETURNING id`, [org.id, SLUG]);
    // Venta minorista y mayorista: la tienda recibe pedidos de cotización.
    await c.query(`UPDATE public.ecommerce_stores SET mayorista_modo = 'mixto' WHERE id = $1`, [tienda.id]);
    // El comprador con cuenta: su ficha de cliente (la tienda lo reconoce por
    // el email) con saldo a favor, y un producto sólo para su recorrido, así
    // no le cambia el stock a lo que miran los otros specs.
    await c.query(
      `INSERT INTO public.products (org_id, user_id, name, brand, category, description, sale_price_ars, cost_ars, stock)
       VALUES ($1, $2, $3, 'ZZ Marca', 'Herramientas', 'Producto del recorrido del comprador con cuenta.', $4, $5, $6)`,
      [org.id, usuario.id, PRODUCTO_COMPRADOR.name, PRODUCTO_COMPRADOR.price, PRODUCTO_COMPRADOR.cost, PRODUCTO_COMPRADOR.stock]);
    await c.query(
      `INSERT INTO public.products (org_id, user_id, name, brand, category, description, sale_price_ars, cost_ars, stock)
       VALUES ($1, $2, $3, 'ZZ Marca', 'Herramientas', 'Producto del recorrido del comprador con cuenta (saldo parcial).', $4, $5, $6)`,
      [org.id, usuario.id, PRODUCTO_COMPRADOR_CARO.name, PRODUCTO_COMPRADOR_CARO.price, PRODUCTO_COMPRADOR_CARO.cost, PRODUCTO_COMPRADOR_CARO.stock]);
    await c.query(
      `INSERT INTO public.products (org_id, user_id, name, brand, category, description, sale_price_ars, cost_ars, stock, preventa_cupo, expected_restock_at)
       VALUES ($1, $2, $3, 'ZZ Marca', 'Herramientas', 'Producto en preventa del recorrido del comprador.', $4, $5, $6, $7, public.hoy_ar() + 20)`,
      [org.id, usuario.id, PRODUCTO_PREVENTA.name, PRODUCTO_PREVENTA.price, PRODUCTO_PREVENTA.cost, PRODUCTO_PREVENTA.stock, PRODUCTO_PREVENTA.cupo]);
    const { rows: [clienteComprador] } = await c.query(
      `INSERT INTO public.customers (org_id, user_id, name, email) VALUES ($1, $2, 'ZZ Comprador E2E', $3) RETURNING id`,
      [org.id, usuario.id, EMAIL_COMPRADOR]);
    await c.query(
      `INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
       VALUES ($1, $2, 'ZZ Comprador E2E', $3, 'Semilla del E2E: crédito por una devolución', $4)`,
      [org.id, clienteComprador.id, SALDO_COMPRADOR, usuario.id]);
    const provincias = ["AR-C", "AR-B", "AR-K", "AR-H", "AR-U", "AR-X", "AR-W", "AR-E", "AR-P", "AR-Y", "AR-L", "AR-F",
      "AR-M", "AR-N", "AR-Q", "AR-R", "AR-A", "AR-J", "AR-D", "AR-Z", "AR-S", "AR-G", "AR-V", "AR-T"];
    const { rows: [zona] } = await c.query(
      `INSERT INTO public.shipping_zones (org_id, name, provinces) VALUES ($1, 'ZZ Todo el país', $2) RETURNING id`, [org.id, provincias]);
    await c.query(
      `INSERT INTO public.shipping_rates (org_id, zone_id, carrier, service, price, delivery_days_min, delivery_days_max)
       VALUES ($1, $2, 'propio', 'domicilio', 3500, 2, 5)`, [org.id, zona.id]);
    await c.query(
      `INSERT INTO public.settings (org_id, user_id, business_name, bank_cbu, bank_alias, bank_holder)
       VALUES ($1, $2, 'ZZ Ferretería E2E', '0000003100000000000012', 'ZZ.FERRETERIA.E2E', 'ZZ FERRETERIA SRL')
       ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder`,
      [org.id, usuario.id]);
    // Catálogo de vitrina: 60 publicados (paginación de 20 y más que la primera
    // tanda de 48, así hace falta el catálogo completo), precios en
    // todo el rango de los filtros, dos sin stock y tres con variantes (una
    // agotada y una «última unidad»).
    const categorias = ["Herramientas", "Electricidad", "Pinturas", "Jardín"];
    const precios = [1500, 12000, 55000, 72000, 88000, 105000];
    for (let i = 1; i <= 56; i++) {
      const { rows: [p] } = await c.query(
        `INSERT INTO public.products (org_id, user_id, name, brand, category, description, sale_price_ars, cost_ars, stock, featured)
         VALUES ($1, $2, $3, 'ZZ Marca', $4, 'Producto de prueba del E2E local.', $5, $6, $7, $8) RETURNING id`,
        [org.id, usuario.id, `ZZ Vitrina ${String(i).padStart(2, "0")}`, categorias[i % categorias.length],
          precios[i % precios.length], Math.round(precios[i % precios.length] / 2), i % 20 === 0 ? 0 : 10 + i, i <= 4]);
      if (i % 15 === 0) {
        for (const [nombre, stock] of [["Rojo", 5], ["Azul", 0], ["Verde", 1]]) {
          await c.query(
            `INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, variant_type, stock, active)
             VALUES ($1, $2, $3, $4, 'color', $5, true)`, [org.id, usuario.id, p.id, nombre, stock]);
        }
      }
    }
    // Una compra importada para cargarle gastos (20261031000100): dos
    // productos fuera de la tienda (inactivos), así no cambian la vitrina. Se
    // registra con la función de verdad, como el dueño.
    const importados = [];
    for (const p of COMPRA_IMPORTADA.productos) {
      const { rows: [prod] } = await c.query(
        `INSERT INTO public.products (org_id, user_id, name, brand, category, sale_price_ars, stock, is_active)
         VALUES ($1, $2, $3, 'ZZ Marca', 'Electricidad', $4, 0, false) RETURNING id`, [org.id, usuario.id, p.name, p.price]);
      importados.push({ producto_id: prod.id, cantidad: p.cantidad, costo_unitario: p.usd });
    }
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: usuario.id, role: "authenticated" })]);
    await c.query(`SELECT public.registrar_compra($1, $2::jsonb)`, [org.id, JSON.stringify({
      comprobante: COMPRA_IMPORTADA.comprobante, proveedor: "ZZ Fábrica de Shenzhen", moneda: "USD",
      cotizacion: COMPRA_IMPORTADA.cotizacion, medio: "transferencia", items: importados,
    })]);
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
    // Finance se habilita por negocio y lo decide un superadmin. Es un usuario
    // técnico aparte: el del E2E no tiene que ver Plataforma.
    const { rows: [admin] } = await c.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'plataforma-e2e@nerqia.test', '', now(), now(), now(), '{}', '{}')
       RETURNING id`);
    await c.query(`INSERT INTO public.platform_admins (user_id, role) VALUES ($1, 'superadmin') ON CONFLICT DO NOTHING`, [admin.id]);
    await c.query(`SELECT public.platform_organization_capability_set($1, 'finance.documents', true, $2, 'Semilla del E2E contra la base local')`, [org.id, admin.id]);
    // El producto Finance arranca «disponible» para cada negocio; el piloto lo deja habilitado.
    await c.query(`UPDATE public.organization_product_access SET status = 'enabled' WHERE org_id = $1 AND product_key = 'finance'`, [org.id]);
    await c.query("COMMIT");
    // PostgREST tiene que ver el esquema completo, no el de antes de las migraciones.
    await c.query("NOTIFY pgrst, 'reload schema'");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`::error::La semilla falló: ${e.message}${e.detail ? ` (${e.detail})` : ""}`);
    process.exitCode = 1;
    return;
  } finally {
    await c.end();
  }

  const salida = process.env.GITHUB_ENV;
  if (salida) {
    appendFileSync(salida, `E2E_USER=${EMAIL}\nE2E_PASSWORD=${password}\nE2E_STORE_SLUG=${SLUG}\n`
      + `E2E_BUYER_EMAIL=${EMAIL_COMPRADOR}\nE2E_BUYER_PASSWORD=${passwordComprador}\n`);
    console.log(`::add-mask::${password}`);
    console.log(`::add-mask::${passwordComprador}`);
  }
  console.log(`Semilla lista: ${EMAIL}, negocio ${SLUG}, ${PRODUCTOS.length + 56} productos.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
