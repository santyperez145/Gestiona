/**
 * "Completar las páginas legales" — el mismo patrón que Completar pesos y
 * Completar el tarifario: el panel señala el problema, un botón lo arregla, con
 * vista previa, y nunca pisa lo que se escribió a mano.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────
 *
 * Se verificó contra la base que los términos publicados son la plantilla
 * semilla intacta: dicen "Mi Tienda Online" y cierran con "Completá acá tu
 * razón social, CUIT, domicilio y un medio de contacto". Y no hay política de
 * privacidad, que la Ley 25.326 exige apenas se recolecta un email.
 *
 * ── La vuelta de tuerca sobre "no pisar lo cargado a mano" ───────────────
 *
 * Acá esa regla, sola, dejaría el marcador publicado para siempre: el marcador
 * *es* contenido. Por eso `esPlantillaSinCompletar` distingue el texto semilla
 * del texto de alguien, y sólo se ofrece reemplazar el primero.
 *
 * ── Por qué pide los datos antes y no genera con huecos ──────────────────
 *
 * Generar una política con "[completar]" adentro sería reemplazar un marcador
 * por otro. Si falta la razón social, el CUIT, el domicilio o el email, se
 * piden primero y el botón no se habilita.
 *
 * ── Identidad fiscal ─────────────────────────────────────────────────────
 *
 * La autoridad del emisor es AFIP (`save_afip_config`). Si Facturas ya tiene
 * CUIT y punto de venta, al generar se sincroniza razón/domicilio que faltaban:
 * un domicilio tipado sólo en legales dejaba Facturas incompleto. No se
 * publica el texto por el comercio: sigue siendo borrador.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scale, Loader2, Eye, Check, ArrowRight } from "lucide-react";
import { validarCuit } from "@/lib/fiscalIdentity";
import {
  datosFaltantes, etiquetaDeCampo, paginasLegalesPendientes, estadoPublicacionLegal,
  puedeSincronizarIdentidadFiscal, semillaLegalDelComercio, SLUGS_LEGALES_OBLIGATORIOS,
  type DatosDelComercio, type EmisorFiscal, type PaginaLegal,
} from "@/lib/legalPages";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  storeId: string | null;
  /** Las páginas que ya existen, para no proponer lo que ya está escrito. */
  existentes: { slug: string; title?: string | null; content: string | null; status?: string | null }[];
  /** Para que el editor recargue después de aplicar. */
  onAplicado: () => void;
  /** Abrir un borrador en el editor de al lado para revisarlo. */
  onAbrirPagina?: (slug: string) => void;
}

export default function LegalPagesPanel({ storeId, existentes, onAplicado, onAbrirPagina }: Props) {
  const { orgId } = useOrganization();
  const [datos, setDatos] = useState<DatosDelComercio>(() => semillaLegalDelComercio({}));
  const [emisor, setEmisor] = useState<EmisorFiscal | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [verPrevia, setVerPrevia] = useState<PaginaLegal | null>(null);

  // Se prellena con lo que el comercio ya declaró: el emisor de AFIP (la
  // misma vista que Facturas) y el email de avisos de la tienda. El nombre
  // de fantasía no es razón social; el login del SaaS no es domicilio
  // electrónico. Si falta, se pide acá — no se adivina.
  useEffect(() => {
    if (!orgId || !storeId) { setCargando(false); return; }
    (async () => {
      const [emisorRes, tiendaRes, cfgRes] = await Promise.all([
        supabase.from("afip_connection_status")
          .select("cuit, razon_social, domicilio, punto_venta, environment, tipo_emisor")
          .eq("org_id", orgId).maybeSingle(),
        supabase.from("ecommerce_stores")
          .select("name, notification_email, meta_pixel_id, ga_measurement_id, tiktok_pixel_id")
          .eq("id", storeId).maybeSingle(),
        supabase.from("settings")
          .select("business_name")
          .eq("org_id", orgId).maybeSingle(),
      ]);
      if (emisorRes.error) console.error("No se pudo leer el emisor fiscal", emisorRes.error);
      if (tiendaRes.error) console.error("No se pudo leer la tienda para las páginas legales", tiendaRes.error);
      if (cfgRes.error) console.error("No se pudo leer el nombre de fantasía", cfgRes.error);
      const filaEmisor = (emisorRes.data as EmisorFiscal | null) ?? null;
      setEmisor(filaEmisor);
      setDatos(semillaLegalDelComercio({
        emisor: filaEmisor,
        tienda: tiendaRes.data,
        nombreFantasia: cfgRes.data?.business_name,
      }));
      setCargando(false);
    })();
  }, [orgId, storeId]);

  const faltan = useMemo(() => datosFaltantes(datos), [datos]);
  // Un CUIT mal tipeado o un email incompleto quedaban publicados en los
  // términos (2026-11-03): ahora se validan antes de generar.
  const cuitInvalido = !!datos.cuit.trim() && !validarCuit(datos.cuit);
  const emailInvalido = !!datos.emailContacto.trim() && !EMAIL.test(datos.emailContacto.trim());
  const listoParaGenerar = faltan.length === 0 && !cuitInvalido && !emailInvalido;
  const pendientes = useMemo(
    () => (listoParaGenerar ? paginasLegalesPendientes(datos, existentes) : []),
    [listoParaGenerar, datos, existentes],
  );
  const estadoPublicacion = useMemo(
    () => estadoPublicacionLegal(existentes),
    [existentes],
  );
  // Si ya existen borradores legales, no volvemos a pedir los datos sólo
  // porque no quedaron duplicados en Ajustes: en ese punto la tarea real es
  // revisarlos y publicarlos. Los datos sólo se necesitan para generar o
  // reemplazar una página que falta o es plantilla.
  //
  // ⚠️ El formulario se muestra por `necesitaGenerar`, no por lo que falta:
  // hasta el 2026-11-03 desaparecía al tipear la primera letra del último
  // campo vacío y el comercio quedaba con «h» como email (Playwright llena de
  // una vez y no lo veía).
  const necesitaGenerar = estadoPublicacion.faltantesOPlantilla > 0;
  const syncAfipAlGenerar = puedeSincronizarIdentidadFiscal(emisor, datos);
  const borradoresLegales = SLUGS_LEGALES_OBLIGATORIOS
    .map(slug => existentes.find(p => p.slug === slug))
    .filter((p): p is NonNullable<typeof p> => !!p && p.status !== "published");
  const [leido, setLeido] = useState(false);
  const [publicando, setPublicando] = useState(false);

  /**
   * Publicar los dos textos de una vez (2026-11-03): eran unos ocho clics
   * (abrir cada borrador en el editor, bajar, encontrar «Publicar»). Sigue
   * siendo un acto del comercio: primero confirma que los leyó.
   */
  const publicarLegales = async () => {
    if (!storeId || !leido || borradoresLegales.length === 0) return;
    setPublicando(true);
    const { error } = await supabase.from("store_pages")
      .update({ status: "published" })
      .eq("store_id", storeId)
      .in("slug", borradoresLegales.map(p => p.slug));
    setPublicando(false);
    if (error) {
      console.error("No se pudieron publicar las páginas legales", error);
      toast.error("No se pudieron publicar las páginas. Reintentá.");
      return;
    }
    toast.success(borradoresLegales.length === 1 ? "Página publicada" : "Términos y privacidad publicados");
    onAplicado();
  };

  const aplicar = async () => {
    if (!orgId || !storeId || !listoParaGenerar || pendientes.length === 0) return;
    setAplicando(true);

    // Se guardan como borrador, no publicadas. Es un texto legal generado: el
    // comercio tiene que leerlo antes de que lo vea un comprador, y si algo no
    // corresponde a cómo trabaja, corregirlo. Publicarlo solo sería firmar
    // por él.
    for (const p of pendientes) {
      const existente = existentes.find(e => e.slug === p.slug);
      const fila = {
        org_id: orgId, store_id: storeId, slug: p.slug, title: p.title,
        content: p.content, status: "draft", show_in_footer: true,
      };
      const { error } = existente
        ? await supabase.from("store_pages").update(fila as never)
            .eq("store_id", storeId).eq("slug", p.slug)
        : await supabase.from("store_pages").insert(fila as never);
      if (error) { toast.error(error.message); setAplicando(false); return; }
    }

    // El email que acaba de declarar para el texto legal es el de avisos de
    // la tienda, si todavía no tenía uno. No se escribe el emisor fiscal
    // salvo cuando AFIP ya estaba iniciado y faltaba razón/domicilio: ahí
    // la misma declaración alimenta Facturas.
    if (datos.emailContacto.trim()) {
      const { error } = await supabase.from("ecommerce_stores")
        .update({ notification_email: datos.emailContacto.trim() })
        .eq("id", storeId)
        .is("notification_email", null);
      if (error) console.error("No se pudo guardar el email de avisos", error);
    }

    if (syncAfipAlGenerar && emisor?.punto_venta && emisor.environment) {
      const { error: afipErr } = await supabase.rpc("save_afip_config", {
        p_org_id: orgId,
        p_cuit: datos.cuit.trim(),
        p_punto_venta: emisor.punto_venta,
        p_environment: emisor.environment,
        p_tipo_emisor: emisor.tipo_emisor ?? null,
        p_razon_social: datos.razonSocial.trim(),
        p_domicilio: datos.domicilio.trim(),
      });
      if (afipErr) {
        console.error("No se pudo sincronizar la identidad fiscal", afipErr);
        toast.error(
          afipErr.message
          || "Las páginas se generaron, pero no se pudo actualizar AFIP.",
        );
      } else {
        setEmisor(prev => prev ? {
          ...prev,
          razon_social: datos.razonSocial.trim(),
          domicilio: datos.domicilio.trim(),
          cuit: datos.cuit.trim(),
        } : prev);
      }
    }

    setAplicando(false);
    toast.success(
      `${pendientes.length} ${pendientes.length === 1 ? "página generada" : "páginas generadas"} como borrador. Revisalas y publicalas.`,
    );
    onAplicado();
  };

  if (cargando || !storeId) return null;
  if (pendientes.length === 0 && estadoPublicacion.listaParaPublicar) {
    return (
      <div className="rounded-lg border p-4 flex items-start gap-3 text-sm">
        <Check className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
        <p className="text-muted-foreground">
          Las páginas legales están escritas. Si cambiaste de domicilio o de
          razón social, acordate de actualizarlas.
        </p>
      </div>
    );
  }

  const campos = [
    ["razonSocial", "Razón social o tu nombre", "Ejemplo S.R.L. o Ana Pérez", null],
    ["cuit", "CUIT", "30-71234567-1", cuitInvalido ? "El CUIT no es válido: revisá los 11 dígitos (el último es verificador)." : null],
    ["domicilio", "Domicilio comercial", "Av. Corrientes 1234, CABA", null],
    ["emailContacto", "Email de contacto", "hola@tutienda.com", emailInvalido ? "Revisá el email: falta la @ o el dominio." : null],
  ] as const;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Scale className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-sm">Términos y privacidad de tu tienda</p>
          <p className="text-xs text-muted-foreground">
            La ley pide que el comprador sepa quién le vende y qué se hace con sus
            datos. Con estos cuatro datos armamos los dos textos; los leés y los
            publicás.
          </p>
        </div>
      </div>

      {necesitaGenerar ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map(([campo, label, ph, error]) => (
              <div key={campo} className="space-y-1.5">
                <Label htmlFor={`legal-${campo}`} className="text-xs">{label}</Label>
                <Input
                  id={`legal-${campo}`} value={datos[campo]} placeholder={ph}
                  type={campo === "emailContacto" ? "email" : "text"}
                  inputMode={campo === "cuit" ? "numeric" : undefined}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `legal-${campo}-error` : undefined}
                  onChange={e => setDatos(d => ({ ...d, [campo]: e.target.value }))}
                />
                {error && <p id={`legal-${campo}-error`} className="text-[11px] text-destructive">{error}</p>}
              </div>
            ))}
          </div>
          {syncAfipAlGenerar && (
            <p className="text-[11px] text-muted-foreground">
              Al generar, el domicilio y la razón social también quedan en ARCA
              (mismo CUIT y punto de venta).
            </p>
          )}

          {pendientes.length > 0 && (
            <div className="space-y-2">
              {pendientes.map(p => (
                <div key={p.slug} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.motivo === "falta" ? "Se crea nueva" : "Reemplaza la plantilla sin completar"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {p.motivo === "falta" ? "nueva" : "reemplaza"}
                    </Badge>
                    <Button aria-label={`Ver el texto de ${p.title}`} title="Ver el texto" size="sm" variant="ghost" onClick={() => setVerPrevia(p)}>
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
              {verPrevia && (
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium">{verPrevia.title}</p>
                    <Button size="sm" variant="ghost" onClick={() => setVerPrevia(null)}>Cerrar</Button>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap max-h-72 overflow-y-auto text-muted-foreground">
                    {verPrevia.content}
                  </pre>
                </div>
              )}
            </div>
          )}

          <Button onClick={() => { void aplicar(); }} disabled={aplicando || !listoParaGenerar} size="sm" className="min-h-11">
            {aplicando ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
            Generar los textos legales
          </Button>
          {faltan.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Falta {faltan.map(etiquetaDeCampo).join(", ")}.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Los textos están listos. Leelos y publicalos para que se vean en la tienda.
          </p>
          {onAbrirPagina && borradoresLegales.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {borradoresLegales.map(pagina => (
                <Button
                  key={pagina.slug}
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-1.5"
                  onClick={() => onAbrirPagina(pagina.slug)}
                >
                  Leer {pagina.title || pagina.slug}
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              ))}
            </div>
          )}
          {borradoresLegales.length > 0 && (
            <>
              <label className="flex items-start gap-2 text-xs text-foreground">
                <input type="checkbox" className="mt-0.5" checked={leido} onChange={e => setLeido(e.target.checked)} />
                <span>Leí los textos y corresponden a cómo trabaja mi negocio.</span>
              </label>
              <Button onClick={() => { void publicarLegales(); }} disabled={!leido || publicando} size="sm" className="min-h-11">
                {publicando ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
                Publicar términos y privacidad
              </Button>
            </>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Es un punto de partida armado con lo que el sistema hace con los datos, no
        asesoramiento legal: conviene que lo revise un profesional.
      </p>
    </div>
  );
}
