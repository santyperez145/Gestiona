/**
 * Lo que reemplaza Nerqia — experimento E5 de docs/TESIS.md.
 *
 * Mi plan mostraba límites (productos, ventas, usuarios) pero no la cuenta que
 * decide si un comercio paga: qué herramientas sueltas deja de usar y cuánto
 * le cuestan hoy. Acá se ve, por producto, el uso medido en la base y lo que
 * el propio comercio carga que paga. El ahorro sale sólo de esos montos: no
 * hay precios de otras herramientas inventados.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { plural } from "@/lib/plural";
import {
  PRODUCTOS_NERQIA, describirUso, normalizarUso, parsearMontoMensual, productoEnUso, resumirAhorro,
  type HerramientaReemplazada, type ProductoNerqia, type UsoDeNerqia,
} from "@/lib/loQueReemplaza";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  orgId: string;
  canEdit: boolean;
  /** Plan con el que se compara (el más barato con precio). */
  plan: { name: string; precioMensual: number | null } | null;
}

type Borrador = Record<ProductoNerqia, { herramienta: string; monto: string }>;

function borradorDesde(herramientas: HerramientaReemplazada[]): Borrador {
  const out = {} as Borrador;
  for (const p of PRODUCTOS_NERQIA) {
    const h = herramientas.find(x => x.producto === p.id);
    out[p.id] = {
      herramienta: h?.herramienta ?? "",
      monto: h ? h.monto_mensual_ars.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "",
    };
  }
  return out;
}

export default function LoQueReemplazaNerqia({ orgId, canEdit, plan }: Props) {
  const [uso, setUso] = useState<UsoDeNerqia | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<ProductoNerqia | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("uso_de_nerqia" as never, { p_org: orgId } as never);
    if (rpcError) {
      console.error("uso_de_nerqia", rpcError);
      setError("No pudimos medir qué usás de Nerqia.");
      return;
    }
    const normalizado = normalizarUso(data);
    setError(null);
    setUso(normalizado);
    setBorrador(borradorDesde(normalizado.herramientas));
  }, [orgId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // La oferta de E5 en el Inicio enlaza a `#lo-que-reemplaza`: el panel carga
  // después, así que el navegador no baja solo.
  const cargado = Boolean(uso);
  useEffect(() => {
    if (!cargado || window.location.hash !== "#lo-que-reemplaza") return;
    document.getElementById("lo-que-reemplaza")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [cargado]);

  const guardar = async (producto: ProductoNerqia) => {
    if (!borrador) return;
    const monto = parsearMontoMensual(borrador[producto].monto);
    if (monto !== null && Number.isNaN(monto)) {
      toast.error("Escribí el monto en pesos, por ejemplo 25.000");
      return;
    }
    setGuardando(producto);
    const { error: rpcError } = await supabase.rpc("guardar_herramienta_reemplazada" as never, {
      p_org: orgId,
      p_producto: producto,
      p_herramienta: borrador[producto].herramienta.trim() || null,
      p_monto_mensual_ars: monto,
    } as never);
    setGuardando(null);
    if (rpcError) {
      console.error("guardar_herramienta_reemplazada", rpcError);
      toast.error(rpcError.message || "No se pudo guardar");
      return;
    }
    toast.success(monto === null ? "Monto borrado" : "Guardado");
    await cargar();
  };

  if (error) {
    return (
      <section className="rounded-[8px] border border-border/80 bg-card p-5 text-sm text-muted-foreground">
        {error}
      </section>
    );
  }
  if (!uso || !borrador) {
    return (
      <section className="rounded-[8px] border border-border/80 bg-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Midiendo qué usás de Nerqia
      </section>
    );
  }

  const enUso = PRODUCTOS_NERQIA.filter(p => productoEnUso(uso.productos.find(u => u.producto === p.id)));
  const resumen = resumirAhorro(uso.herramientas, plan?.precioMensual ?? null);

  return (
    <section className="rounded-[8px] border border-border/80 bg-card" aria-labelledby="lo-que-reemplaza">
      <div className="px-4 py-3 border-b border-border/60">
        <h2 id="lo-que-reemplaza" className="text-sm font-semibold">Lo que Nerqia reemplaza</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Usás {plural(enUso.length, "producto")} de 6. Anotá cuánto pagás hoy por la herramienta que hace
          cada trabajo y te mostramos la diferencia.
        </p>
      </div>

      <div className="px-4 py-3 border-b border-border/60 text-sm" aria-live="polite">
        {resumen.productosCargados === 0 ? (
          <p className="text-muted-foreground">Todavía no cargaste montos: sin eso no calculamos ahorro.</p>
        ) : (
          <p>
            Hoy pagás <span className="font-semibold tabular-nums">{formatARS(resumen.pagaHoy)}</span> por mes
            en {plural(resumen.productosCargados, "herramienta")}.
            {plan && resumen.ahorroMensual !== null && plan.precioMensual != null && (
              resumen.ahorroMensual > 0 ? (
                <> {plan.name} cuesta {formatARS(plan.precioMensual)}: <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">ahorrás {formatARS(resumen.ahorroMensual)} por mes</span>.</>
              ) : (
                <> {plan.name} cuesta {formatARS(plan.precioMensual)}, {formatARS(-resumen.ahorroMensual)} más por mes, con todo en un solo lugar.</>
              )
            )}
          </p>
        )}
      </div>

      <ul className="divide-y divide-border/50">
        {PRODUCTOS_NERQIA.map(p => {
          const u = uso.productos.find(x => x.producto === p.id);
          const activo = productoEnUso(u);
          const fila = borrador[p.id];
          return (
            <li key={p.id} className="px-4 py-3 grid gap-2 md:grid-cols-[1.3fr_1fr_0.7fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {p.nombre}
                  <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded border ${activo
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border"}`}>
                    {activo ? "En uso" : "Sin usar todavía"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{p.trabajo} · {describirUso(u)}</p>
              </div>
              <Input
                aria-label={`Herramienta que usás para ${p.nombre.toLowerCase()}`}
                placeholder={p.ejemplos}
                value={fila.herramienta}
                maxLength={80}
                disabled={!canEdit}
                onChange={e => setBorrador({ ...borrador, [p.id]: { ...fila, herramienta: e.target.value } })}
              />
              <Input
                aria-label={`Cuánto pagás por mes para ${p.nombre.toLowerCase()}`}
                placeholder="$ por mes"
                inputMode="decimal"
                value={fila.monto}
                disabled={!canEdit}
                onChange={e => setBorrador({ ...borrador, [p.id]: { ...fila, monto: e.target.value } })}
              />
              {canEdit && (
                <Button size="sm" variant="outline" disabled={guardando !== null} onClick={() => void guardar(p.id)}>
                  {guardando === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Guardar"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!canEdit && (
        <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border/60">
          Sólo el dueño o un administrador pueden cargar los montos.
        </p>
      )}
    </section>
  );
}
