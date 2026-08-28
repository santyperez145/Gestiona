/**
 * migrar-imagenes — trae al proyecto actual las imágenes que quedaron alojadas
 * en el proyecto Supabase anterior.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Medido el 2026-08-28: **37 filas** apuntan a
 * `wcfohngxrtopgggumjmw.supabase.co` — 36 en `products.image_url` y el logo del
 * comercio en `settings.logo_url`. Es el 60% del catálogo.
 *
 * Responden 200 hoy, pero ese proyecto **no está en ninguna configuración ni
 * en los backups**, y Supabase pausa los proyectos gratuitos por inactividad.
 * El día que se pause, la tienda pierde las fotos en silencio: el navegador
 * muestra un hueco, no un error.
 *
 * ── El orden importa, y es lo único que hace esto seguro ──────────────────
 *
 * Por cada imagen, y **de a una**:
 *
 *   1. Se descarga del proyecto viejo. Si falla → se deja como está.
 *   2. Se sube al bucket del proyecto actual. Si falla → se deja como está.
 *   3. Se pide la URL nueva y se comprueba que responda 200 **con el mismo
 *      peso**. Si no → se deja como está.
 *   4. Recién entonces se actualiza la fila.
 *
 * ⚠️ **Nunca se borra del proyecto viejo.** Borrar el origen antes de que el
 * destino esté probado es cómo una migración de archivos deja un catálogo sin
 * fotos. Vaciar ese proyecto es del dueño, cuando esta función haya terminado
 * y él haya mirado la tienda.
 *
 * 📌 Y si se corta a la mitad, las filas que no se movieron **conservan la URL
 * que funciona**. Se puede volver a correr: es idempotente por construcción,
 * porque sólo mira las que todavía apuntan al proyecto viejo.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { exigirCron } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const VIEJO = "wcfohngxrtopgggumjmw.supabase.co";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** La extensión del archivo, para no subir un .png como .bin. */
function extensionDe(url: string, tipo: string | null): string {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase();
  if (tipo?.includes("jpeg")) return "jpg";
  if (tipo?.includes("webp")) return "webp";
  return "png";
}

interface Pendiente {
  tabla: "products" | "settings";
  id: string;
  org_id: string;
  url: string;
  que_es: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: mueve archivos del catálogo de un comercio.
  const noEsCron = exigirCron(req, corsHeaders);
  if (noEsCron) return noEsCron;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return json({ error: "Configuración no disponible" }, 503);

  const admin = createClient(url, serviceRole);

  // Cuántas mover en esta corrida. Se puede volver a llamar hasta que dé 0.
  let tope = 40;
  try {
    const body = await req.json();
    if (Number(body?.tope) > 0) tope = Math.min(Number(body.tope), 100);
  } catch { /* se usa el default */ }

  const pendientes: Pendiente[] = [];

  const { data: prods, error: errProd } = await admin
    .from("products").select("id, org_id, name, image_url")
    .like("image_url", `%${VIEJO}%`).limit(tope);
  if (errProd) return json({ error: "No se pudieron leer los productos", detalle: errProd.message }, 500);
  for (const p of prods ?? []) {
    pendientes.push({ tabla: "products", id: p.id, org_id: p.org_id, url: p.image_url, que_es: p.name });
  }

  if (pendientes.length < tope) {
    const { data: sets } = await admin
      .from("settings").select("id, org_id, logo_url")
      .like("logo_url", `%${VIEJO}%`).limit(tope - pendientes.length);
    for (const s of sets ?? []) {
      pendientes.push({ tabla: "settings", id: s.id, org_id: s.org_id, url: s.logo_url, que_es: "logo del comercio" });
    }
  }

  const movidas: string[] = [];
  const saltadas: { que_es: string; motivo: string }[] = [];

  for (const p of pendientes) {
    try {
      // ── 1. Descargar del proyecto viejo ─────────────────────────────────
      const orig = await fetch(p.url);
      if (!orig.ok) { saltadas.push({ que_es: p.que_es, motivo: `origen HTTP ${orig.status}` }); continue; }
      const bytes = new Uint8Array(await orig.arrayBuffer());
      const tipo = orig.headers.get("content-type");
      if (bytes.byteLength === 0) { saltadas.push({ que_es: p.que_es, motivo: "el origen vino vacío" }); continue; }

      // ── 2. Subir al proyecto actual ─────────────────────────────────────
      const bucket = p.tabla === "products" ? "product-images" : "marketing-images";
      const ruta = `${p.org_id}/migradas/${crypto.randomUUID()}.${extensionDe(p.url, tipo)}`;

      const { error: errSubida } = await admin.storage.from(bucket).upload(ruta, bytes, {
        contentType: tipo ?? "image/png",
        upsert: false,
      });
      if (errSubida) { saltadas.push({ que_es: p.que_es, motivo: `subida: ${errSubida.message}` }); continue; }

      const nueva = admin.storage.from(bucket).getPublicUrl(ruta).data.publicUrl;

      // ── 3. ⚠️ Comprobar que la URL nueva sirve, y con el mismo peso ─────
      // Sin esto, un upload que "salió bien" pero deja un objeto inaccesible
      // dejaría el producto sin foto — y la fila ya apuntaría ahí.
      const verif = await fetch(nueva);
      const bytesNuevos = verif.ok ? (await verif.arrayBuffer()).byteLength : 0;
      if (!verif.ok || bytesNuevos !== bytes.byteLength) {
        saltadas.push({
          que_es: p.que_es,
          motivo: `la copia no verifica (HTTP ${verif.status}, ${bytesNuevos} vs ${bytes.byteLength} bytes)`,
        });
        continue;
      }

      // ── 4. Recién ahora se cambia la fila ───────────────────────────────
      const campo = p.tabla === "products" ? "image_url" : "logo_url";
      const { error: errUpd } = await admin
        .from(p.tabla).update({ [campo]: nueva }).eq("id", p.id);
      if (errUpd) { saltadas.push({ que_es: p.que_es, motivo: `update: ${errUpd.message}` }); continue; }

      movidas.push(p.que_es);
    } catch (e) {
      saltadas.push({ que_es: p.que_es, motivo: e instanceof Error ? e.message : "error desconocido" });
    }
  }

  // Cuántas quedan, para saber si hay que volver a llamar.
  const { count } = await admin
    .from("products").select("id", { count: "exact", head: true })
    .like("image_url", `%${VIEJO}%`);

  return json({
    ok: true,
    movidas: movidas.length,
    saltadas,
    quedan_productos: count ?? 0,
    // ⚠️ No se borró nada del proyecto viejo, a propósito.
    nota: "El proyecto anterior conserva sus archivos: vaciarlo es del dueño.",
  });
});
