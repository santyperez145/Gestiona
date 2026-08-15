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
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scale, Loader2, Eye, Check } from "lucide-react";
import {
  datosFaltantes, etiquetaDeCampo, paginasLegalesPendientes, estadoPublicacionLegal,
  type DatosDelComercio, type PaginaLegal,
} from "@/lib/legalPages";

interface Props {
  storeId: string | null;
  /** Las páginas que ya existen, para no proponer lo que ya está escrito. */
  existentes: { slug: string; content: string | null; status?: string | null }[];
  /** Para que el editor recargue después de aplicar. */
  onAplicado: () => void;
}

export default function LegalPagesPanel({ storeId, existentes, onAplicado }: Props) {
  const { orgId } = useOrganization();
  const [datos, setDatos] = useState<DatosDelComercio>({
    nombreTienda: "", razonSocial: "", cuit: "", domicilio: "", emailContacto: "",
  });
  const [cargando, setCargando] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const [verPrevia, setVerPrevia] = useState<PaginaLegal | null>(null);

  // Se prellena con lo que ya está cargado para AFIP: si el comercio lo puso
  // una vez, no tiene por qué escribirlo de nuevo.
  useEffect(() => {
    if (!orgId || !storeId) { setCargando(false); return; }
    (async () => {
      const [{ data: cfg }, { data: tienda }] = await Promise.all([
        supabase.from("settings")
          .select("afip_razon_social, afip_cuit, business_name, smtp_from_email")
          .eq("org_id", orgId).maybeSingle(),
        // El nombre y los píxeles salen de la tienda, no del slug: escribir
        // "la tienda online de exentryimports" en un texto legal es feo y,
        // peor, no identifica al comercio.
        supabase.from("ecommerce_stores")
          .select("name, meta_pixel_id, ga_measurement_id")
          .eq("id", storeId).maybeSingle(),
      ]);
      const s = cfg as {
        afip_razon_social?: string | null; afip_cuit?: string | null;
        business_name?: string | null; smtp_from_email?: string | null;
      } | null;
      const t = tienda as {
        name?: string | null; meta_pixel_id?: string | null; ga_measurement_id?: string | null;
      } | null;
      setDatos(d => ({
        ...d,
        nombreTienda: t?.name || "nuestra tienda",
        usaPixeles: Boolean(t?.meta_pixel_id || t?.ga_measurement_id),
        razonSocial: s?.afip_razon_social || s?.business_name || "",
        cuit: s?.afip_cuit || "",
        emailContacto: s?.smtp_from_email || "",
      }));
      setCargando(false);
    })();
  }, [orgId, storeId]);

  const faltan = useMemo(() => datosFaltantes(datos), [datos]);
  const pendientes = useMemo(
    () => (faltan.length ? [] : paginasLegalesPendientes(datos, existentes)),
    [faltan, datos, existentes],
  );
  const estadoPublicacion = useMemo(
    () => estadoPublicacionLegal(existentes),
    [existentes],
  );
  // Si ya existen borradores legales, no volvemos a pedir los datos sólo
  // porque no quedaron duplicados en Ajustes: en ese punto la tarea real es
  // revisarlos y publicarlos. Los datos sólo se necesitan para generar o
  // reemplazar una página que falta o es plantilla.
  const necesitaGenerar = estadoPublicacion.faltantesOPlantilla > 0;
  const faltanDatosParaGenerar = necesitaGenerar && faltan.length > 0;

  const aplicar = async () => {
    if (!orgId || !storeId || pendientes.length === 0) return;
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

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Scale className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-sm">Completar las páginas legales</p>
          <p className="text-xs text-muted-foreground">
            La política de privacidad es obligatoria por la Ley 25.326 apenas
            recolectás un email, y los términos tienen que decir quién vende,
            con CUIT y domicilio (Ley 24.240 art. 4). Se generan a partir de tus
            datos y de lo que el sistema realmente hace con la información de
            tus clientes — incluido que se aloja en Estados Unidos, que hay que
            declararlo.
          </p>
        </div>
      </div>

      {faltanDatosParaGenerar ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Falta {faltan.map(etiquetaDeCampo).join(", ")}. Sin eso el texto
            saldría con huecos, que es lo que estamos arreglando.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["razonSocial", "Razón social", "Ejemplo S.R.L."],
              ["cuit", "CUIT", "30-71234567-8"],
              ["domicilio", "Domicilio comercial", "Av. Siempreviva 742, CABA"],
              ["emailContacto", "Email de contacto", "hola@tutienda.com"],
            ] as const).map(([campo, label, ph]) => (
              <div key={campo} className="space-y-1.5">
                <Label htmlFor={`legal-${campo}`} className="text-xs">{label}</Label>
                <Input
                  id={`legal-${campo}`} value={datos[campo]} placeholder={ph}
                  onChange={e => setDatos(d => ({ ...d, [campo]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      ) : pendientes.length > 0 ? (
        <div className="space-y-2">
          {pendientes.map(p => (
            <div key={p.slug} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <p className="text-xs text-muted-foreground">
                  {p.motivo === "falta"
                    ? "No existe todavía"
                    : "Sigue siendo la plantilla sin completar"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-[10px]">
                  {p.motivo === "falta" ? "nueva" : "reemplaza"}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => setVerPrevia(p)}>
                  <Eye className="w-3.5 h-3.5" />
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

          <Button onClick={aplicar} disabled={aplicando} size="sm">
            {aplicando ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
            Generar {pendientes.length === 1 ? "la página" : `las ${pendientes.length} páginas`}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Se crean como <strong>borrador</strong>: leelas antes de publicar.
            Es un punto de partida sobre lo que el sistema hace, no
            asesoramiento legal — conviene que lo revise un profesional.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Las páginas ya están escritas. Elegí cada borrador de la lista,
          revisalo y marcá <strong>Publicada</strong> para que se vea en la
          tienda.
        </p>
      )}

      {estadoPublicacion.borradores > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {estadoPublicacion.borradores === 1
            ? "Hay una página legal escrita pero en borrador. Abrila, revisala y marcala como publicada antes de activar la tienda."
            : "Las páginas legales están escritas pero en borrador. Abrilas, revisalas y marcalas como publicadas antes de activar la tienda."}
        </p>
      )}
    </div>
  );
}
