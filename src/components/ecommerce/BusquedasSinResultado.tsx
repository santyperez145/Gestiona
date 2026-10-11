/**
 * «Lo que buscan y no encuentran»: los términos más buscados en la tienda sin
 * resultados en los últimos 30 días. Si el producto existe con otro nombre,
 * «Agregar a un producto» vincula el término (sinónimo de búsqueda) y la
 * tienda lo encuentra desde la próxima búsqueda. Arriba, el resumen de la
 * analítica: cuánto buscan, cuánto no encuentran, cuánto abren un producto y
 * lo que más buscan. Abajo, los clientes que dejaron su email para que les
 * avisen («Copiar emails» y «Ya les avisé»; sólo quien edita la tienda). Ver
 * `src/lib/busquedasSinResultado.ts` y las migraciones 20261011000500 a 0800.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useHasPermission } from "@/lib/usePermissions";
import { isMissingRelation } from "@/lib/publicDataSource";
import { getProductsDB } from "@/lib/supabaseStore";
import { avisosPorTermino, resumenDeBusquedas, topBusquedas, type AvisoDeBusqueda, type FilaBusqueda, type FilaBusquedaConResultado, type ResumenDeBusquedas, type SinonimoDeBusqueda } from "@/lib/busquedasSinResultado";
import ProductCombobox, { type ProductoOpcion } from "@/components/shared/ProductCombobox";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function BusquedasSinResultado({ orgId }: { orgId: string | null | undefined }) {
  const { user } = useAuth();
  const puedeEditar = useHasPermission("ecommerce", "edit");
  const [top, setTop] = useState<FilaBusqueda[] | null>(null);
  const [resumen, setResumen] = useState<ResumenDeBusquedas | null>(null);
  const [avisos, setAvisos] = useState<AvisoDeBusqueda[]>([]);
  const [vinculos, setVinculos] = useState<SinonimoDeBusqueda[]>([]);
  const [productos, setProductos] = useState<ProductoOpcion[] | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string>("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let activo = true;
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    void Promise.all([
      supabase.from("store_busquedas_sin_resultado" as never).select("termino, veces").eq("org_id", orgId).gte("dia", desde).limit(2000),
      supabase.from("store_search_synonyms" as never).select("termino, product_id").eq("org_id", orgId).limit(2000),
      supabase.from("store_busquedas" as never).select("termino, veces, con_clic, con_pedido").eq("org_id", orgId).gte("dia", desde).limit(5000),
    ]).then(([busquedas, sinonimos, conResultado]) => {
      if (!activo) return;
      if (busquedas.error && !isMissingRelation(busquedas.error)) console.error("store_busquedas_sin_resultado", busquedas.error);
      if (sinonimos.error && !isMissingRelation(sinonimos.error)) console.error("store_search_synonyms", sinonimos.error);
      if (conResultado.error && !isMissingRelation(conResultado.error)) console.error("store_busquedas", conResultado.error);
      const sin = (busquedas.data ?? []) as FilaBusqueda[];
      setTop(topBusquedas(sin));
      setResumen(resumenDeBusquedas((conResultado.data ?? []) as FilaBusquedaConResultado[], sin, 5));
      setVinculos((sinonimos.data ?? []) as SinonimoDeBusqueda[]);
    });
    return () => { activo = false; };
  }, [orgId]);

  // Los emails son datos personales: sólo los ve quien edita la tienda.
  useEffect(() => {
    if (!orgId || !puedeEditar) return;
    let activo = true;
    void supabase.from("store_avisos_de_busqueda" as never).select("id, termino, email, created_at")
      .eq("org_id", orgId).order("created_at", { ascending: false }).limit(1000)
      .then(({ data, error }) => {
        if (!activo) return;
        if (error && !isMissingRelation(error)) console.error("store_avisos_de_busqueda", error);
        setAvisos((data ?? []) as AvisoDeBusqueda[]);
      });
    return () => { activo = false; };
  }, [orgId, puedeEditar]);

  const copiarEmails = async (emails: string[]) => {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast.success(emails.length === 1 ? "Email copiado" : `${emails.length} emails copiados`);
    } catch {
      toast.error("No se pudieron copiar los emails");
    }
  };

  const yaLesAvise = async (termino: string, ids: string[]) => {
    const { error } = await supabase.from("store_avisos_de_busqueda" as never).delete().in("id", ids);
    if (error) {
      console.error("store_avisos_de_busqueda delete", error);
      toast.error("No se pudo marcar como avisado");
      return;
    }
    setAvisos(a => a.filter(x => !ids.includes(x.id)));
    toast.success(`Listo: «${termino}» sale de la lista`);
  };

  const abrir = async (termino: string) => {
    setAbierto(termino);
    setElegido("");
    if (productos || !user?.id || !orgId) return;
    try {
      const lista = await getProductsDB(user.id, orgId);
      setProductos((lista ?? []) as ProductoOpcion[]);
    } catch (error) {
      console.error("BusquedasSinResultado / productos", error);
      toast.error("No se pudieron cargar los productos");
    }
  };

  const vincular = async (termino: string) => {
    if (!orgId || !elegido) return;
    setGuardando(true);
    const { error } = await supabase.from("store_search_synonyms" as never)
      .insert({ org_id: orgId, termino, product_id: elegido } as never);
    setGuardando(false);
    if (error) {
      console.error("store_search_synonyms insert", error);
      toast.error(error.code === "23505" ? "Ese término ya lleva a ese producto" : "No se pudo vincular");
      return;
    }
    setVinculos(v => [...v, { termino, product_id: elegido }]);
    setAbierto(null);
    // La base pasa los pedidos de aviso de ese término a esperar el producto
    // (migración 20261011000900): les llega un email cuando haya stock.
    const esperaban = new Set(avisos.filter(a => a.termino === termino).map(a => a.email)).size;
    setAvisos(a => a.filter(x => x.termino !== termino));
    toast.success(esperaban > 0
      ? `Listo: la tienda lo va a encontrar con esa palabra y ${esperaban === 1 ? "el cliente que pidió aviso recibe" : `los ${esperaban} clientes que pidieron aviso reciben`} un email cuando haya stock`
      : "Listo: la tienda lo va a encontrar con esa palabra");
  };

  if (!top) return null;
  const nombreDe = (id: string) => productos?.find(p => p.id === id)?.name;

  return (
    <section className="rounded-xl border border-border p-4 text-sm" aria-labelledby="busquedas-sin-resultado">
      <h3 id="busquedas-sin-resultado" className="font-semibold">Lo que buscan y no encuentran</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Búsquedas en tu tienda que no dieron resultados en los últimos 30 días. Si lo tenés con otro nombre, agregá la palabra a ese producto.
      </p>
      {resumen && resumen.total > 0 && (
        <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs" aria-label="Resumen de búsquedas">
          <p>
            <span className="font-medium tabular-nums">{resumen.total}</span> {resumen.total === 1 ? "búsqueda" : "búsquedas"} en 30 días
            {resumen.pctSinResultado !== null && <> · <span className="tabular-nums">{resumen.pctSinResultado}%</span> sin resultados</>}
            {resumen.pctConClic !== null && <> · <span className="tabular-nums">{resumen.pctConClic}%</span> de las que encontraron algo terminaron en abrir un producto</>}
            {resumen.pctConPedido !== null && <> y <span className="tabular-nums">{resumen.pctConPedido}%</span> en un pedido</>}
          </p>
          {resumen.top.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              Lo que más buscan: {resumen.top.map(f => `«${f.termino}» (${f.veces})`).join(", ")}
            </p>
          )}
        </div>
      )}
      {avisos.length > 0 && (
        <div className="mt-3 space-y-2" aria-label="Pidieron aviso">
          <p className="text-xs font-medium">Pidieron que les avises</p>
          <p className="text-xs text-muted-foreground">Si lo tenés con otro nombre, agregá la palabra a ese producto: les llega un email solo cuando haya stock.</p>
          <ul className="space-y-1.5">
            {avisosPorTermino(avisos).map(g => (
              <li key={g.termino} className="flex flex-wrap items-center justify-between gap-2">
                <span>«{g.termino}» <span className="tabular-nums text-muted-foreground">· {g.emails.length} {g.emails.length === 1 ? "cliente" : "clientes"}</span></span>
                <span className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" onClick={() => void copiarEmails(g.emails)}>Copiar emails</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void yaLesAvise(g.termino, g.ids)}>Ya les avisé</Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {top.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Todavía no hay búsquedas sin resultados.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {top.map(b => {
            const ya = vinculos.filter(v => v.termino === b.termino);
            return (
              <li key={b.termino} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>«{b.termino}» <span className="tabular-nums text-muted-foreground">· {b.veces} {b.veces === 1 ? "vez" : "veces"}</span></span>
                  {ya.length > 0 ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">
                      Ya lleva a {ya.length === 1 ? (nombreDe(ya[0].product_id) ?? "un producto") : `${ya.length} productos`}
                    </span>
                  ) : puedeEditar && abierto !== b.termino ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void abrir(b.termino)}>Agregar a un producto</Button>
                  ) : null}
                </div>
                {abierto === b.termino && (
                  <div className="flex flex-wrap items-center gap-2">
                    {productos ? (
                      <ProductCombobox className="min-w-[16rem] flex-1" ariaLabel={`Producto al que lleva «${b.termino}»`}
                        products={productos} value={elegido} onChange={id => setElegido(id)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Cargando productos…</span>
                    )}
                    <Button type="button" size="sm" disabled={!elegido || guardando} onClick={() => void vincular(b.termino)}>Vincular</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(null)}>Cancelar</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
