/**
 * Productos Nerqia por comercio — métrica del motor pegajoso (docs/TESIS.md
 * §6) e insumo de E2/E5: qué usa cada comercio y cuánto dice pagar hoy por
 * las herramientas sueltas que Nerqia reemplaza (lo carga en Mi plan).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { formatARS } from "@/lib/supabaseStore";
import {
  PRODUCTOS_NERQIA, normalizarUso, productoEnUso, resumirProductosPorComercio,
  type ProductosDeComercio,
} from "@/lib/loQueReemplaza";
import { describirOrigen, type OrigenFila } from "@/lib/origenDeAlta";
import { AlertTriangle, Loader2 } from "lucide-react";

const NOMBRE = Object.fromEntries(PRODUCTOS_NERQIA.map(p => [p.id, p.nombre]));

export default function ProductosPorComercio() {
  const [filas, setFilas] = useState<ProductosDeComercio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinVista, setSinVista] = useState(false);
  const [origenes, setOrigenes] = useState<Map<string, OrigenFila>>(new Map());

  const cargar = useCallback(async () => {
    const origen = await supabase.from("origen_de_alta" as never)
      .select("org_id, canal, codigo, utm_campaign, utm_source, sitio_origen, referido_por_org");
    if (origen.error && !isMissingRelation(origen.error)) console.error("origen_de_alta", origen.error);
    setOrigenes(new Map(((origen.data ?? []) as OrigenFila[]).map(o => [o.org_id, o])));
    const { data, error: queryError } = await supabase
      .from("platform_org_productos_nerqia" as never)
      .select("*")
      .order("productos_en_uso", { ascending: false });
    if (queryError) {
      if (isMissingRelation(queryError)) {
        setSinVista(true);
      } else {
        console.error("platform_org_productos_nerqia", queryError);
        setError(queryError.message);
      }
      setFilas([]);
      return;
    }
    setFilas(((data ?? []) as unknown[]).map(raw => {
      const fila = raw as ProductosDeComercio;
      const uso = normalizarUso({ productos: fila.productos, herramientas: fila.herramientas });
      return { ...fila, productos: uso.productos, herramientas: uso.herramientas };
    }));
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (sinVista) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no expone <code>platform_org_productos_nerqia</code> (migración 20261010001900).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudo leer el uso por comercio: {error}</p>;
  if (!filas) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Midiendo</p>;
  }

  const resumen = resumirProductosPorComercio(filas);
  const nombres = new Map(filas.map(f => [f.org_id, f.org_name]));
  const referidas = [...origenes.values()].filter(o => o.canal === "comercio" || o.canal === "influencer" || o.canal === "creador").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 text-sm">
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Productos por comercio activo</p>
          <p className="text-xl font-semibold tabular-nums">{resumen.promedioProductosActivos ?? "—"}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Comercios con 2 o más productos</p>
          <p className="text-xl font-semibold tabular-nums">{resumen.comerciosConDosOMas} de {resumen.comercios}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Comercios que cargaron lo que pagan</p>
          <p className="text-xl font-semibold tabular-nums">{resumen.comerciosConMontos}</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Altas referidas (comercio, influencer o creador)</p>
          <p className="text-xl font-semibold tabular-nums">{referidas} de {origenes.size} medidas</p>
        </div>
        <div className="border border-border p-3">
          <p className="text-xs text-muted-foreground">Pagan hoy en herramientas sueltas</p>
          <p className="text-xl font-semibold tabular-nums">{formatARS(resumen.pagaHoyTotal)}<span className="text-xs font-normal text-muted-foreground"> / mes</span></p>
        </div>
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              <th className="px-3 py-2 text-left font-medium">Cómo llegó</th>
              <th className="px-3 py-2 text-left font-medium">Productos en uso</th>
              <th className="px-3 py-2 text-left font-medium">Lo que paga hoy</th>
              <th className="px-3 py-2 text-right font-medium">Total / mes</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Sin comercios.</td></tr>
            )}
            {filas.map(f => {
              const usados = f.productos.filter(productoEnUso).map(p => NOMBRE[p.producto]);
              const cargadas = f.herramientas.filter(h => h.monto_mensual_ars > 0);
              return (
                <tr key={f.org_id} className="border-b border-border/50 last:border-0 align-top">
                  <td className="px-3 py-2 font-medium">{f.org_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{describirOrigen(origenes.get(f.org_id), nombres)}</td>
                  <td className="px-3 py-2">
                    <span className="tabular-nums">{f.productos_en_uso} de 6</span>
                    {usados.length > 0 && <span className="text-xs text-muted-foreground"> · {usados.join(", ")}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {cargadas.length === 0 ? "Sin cargar" : cargadas
                      .map(h => `${NOMBRE[h.producto]}: ${h.herramienta ?? "sin nombre"} ${formatARS(h.monto_mensual_ars)}`)
                      .join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(f.paga_hoy_ars) > 0 ? formatARS(Number(f.paga_hoy_ars)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Uso medido en 30 días (Influencers en 90). Los montos los carga cada comercio en Mi plan; no se estiman.
      </p>
    </div>
  );
}
