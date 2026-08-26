/**
 * H6 + I1 — el tablero del libro.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * El ledger, la billetera y la salud de la cola funcionan desde las sesiones
 * 112–114 y **el comercio no veía ninguno**. Sin pantalla, un motor correcto es
 * indistinguible de uno roto, y todo el trabajo de partida doble, outbox y
 * costo de ventas era invisible.
 *
 * ── Las tres decisiones de esta pantalla ─────────────────────────────────
 *
 * **El margen bruto va arriba de todo.** Es la pregunta que responde si el
 * negocio funciona. Poner primero las comisiones invita a optimizar lo que
 * menos mueve la aguja.
 *
 * **Si el margen no es confiable, se dice ahí mismo.** Cuando hay ventas
 * asentadas sin costo, el margen sale mejor de lo que la realidad es. Mostrarlo
 * como si nada sería mover a la pantalla el problema que H7 arregló en la base.
 *
 * **Los números no se recalculan acá.** El servidor es la autoridad: esta
 * pantalla lee `ledger_resultado` y sólo deriva razones y formato. Un total
 * calculado en el navegador es un segundo número que puede diferir del libro.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import PageHeader from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Loader2, TrendingUp, TrendingDown, AlertTriangle, Activity, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  RESULTADO_VACIO, margenPorcentual, resultadoPorcentual, confianzaDelMargen,
  filasDelResultado, rangoDelPreset, type Resultado,
} from "@/lib/estadoResultados";
import { formatARS } from "@/lib/supabaseStore";

type Preset = "mes" | "mes_anterior" | "30dias" | "anio";

const PRESETS: Array<[Preset, string]> = [
  ["mes", "Este mes"],
  ["mes_anterior", "Mes anterior"],
  ["30dias", "Últimos 30 días"],
  ["anio", "Este año"],
];

interface PuntoSerie { fecha: string; ventas: number; costo: number; margen: number; }

export default function LibroPage() {
  const { orgId } = useOrganization();
  const [preset, setPreset] = useState<Preset>("mes");
  const [resultado, setResultado] = useState<Resultado>(RESULTADO_VACIO);
  const [serie, setSerie] = useState<PuntoSerie[]>([]);
  const [saldoBilletera, setSaldoBilletera] = useState<number | null>(null);
  const [colaPendiente, setColaPendiente] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rango = useMemo(() => rangoDelPreset(preset), [preset]);

  const cargar = useCallback(async () => {
    if (!orgId) { setCargando(false); return; }
    setCargando(true);
    setError(null);

    const args = { p_org: orgId, p_desde: rango.desde, p_hasta: rango.hasta };
    const [res, dia, cola] = await Promise.all([
      supabase.rpc("ledger_resultado" as never, args as never),
      supabase.rpc("ledger_resultado_diario" as never, args as never),
      supabase.from("outbox_salud").select("*").maybeSingle(),
    ]);

    setCargando(false);

    // No se traga el error: un tablero de plata en blanco y un tablero de plata
    // en cero son cosas distintas, y confundirlas es peor que no mostrarlo.
    if (res.error) { setError(res.error.message); return; }

    setResultado({ ...RESULTADO_VACIO, ...(res.data as unknown as Resultado) });
    setSerie(((dia.data ?? []) as unknown as PuntoSerie[]).map(p => ({
      ...p,
      ventas: Number(p.ventas) || 0,
      costo: Number(p.costo) || 0,
      margen: Number(p.margen) || 0,
    })));

    const salud = cola.data as { pendientes?: number } | null;
    setColaPendiente(salud?.pendientes ?? null);
  }, [orgId, rango.desde, rango.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  // La billetera es del comercio y no del período: se lee aparte y una vez.
  //
  // ⚠️ Antes leía `wallet_movimientos.saldo`, y esa columna **no existe** — la
  // vista tiene `monto` y `delta`, no un saldo acumulado. PostgREST devolvía
  // 400 y el saldo salía siempre "Sin movimientos", en la misma pantalla que
  // se presenta como el libro mayor. El error no se veía porque no se miraba
  // `.error`.
  //
  // El saldo lo deriva la base con `wallet_saldo`, que es lo que ya usa
  // `WalletPage`: una sola autoridad para el mismo número.
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data, error } = await supabase.rpc("wallet_saldo", { p_org: orgId });
      if (error) {
        // No se traga: "no tengo permiso" y "no hay movimientos" son problemas
        // opuestos, y confundirlos fue exactamente lo que tapó este bug.
        console.error("LibroPage / wallet_saldo:", error);
        setSaldoBilletera(null);
        return;
      }
      const saldo = typeof data === "number"
        ? data
        : Number((data as { saldo_disponible?: number; saldo?: number } | null)?.saldo_disponible
                 ?? (data as { saldo?: number } | null)?.saldo);
      setSaldoBilletera(Number.isFinite(saldo) ? saldo : null);
    })();
  }, [orgId]);

  const margen = margenPorcentual(resultado);
  const rentabilidad = resultadoPorcentual(resultado);
  const confianza = confianzaDelMargen(resultado);
  const filas = filasDelResultado(resultado);
  const positivo = resultado.resultado >= 0;

  return (
    <div className="workspace-dashboard">
      <PageHeader
        icon={BookOpen}
        title="Libro y resultado"
        description="Derivado de los asientos contables, no de una suma aparte."
        actions={
          <div className="flex gap-1.5 overflow-x-auto">
            {PRESETS.map(([p, label]) => (
              <Button
                key={p} size="sm"
                variant={preset === p ? "default" : "outline"}
                onClick={() => setPreset(p)}
                className="whitespace-nowrap"
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <p className="text-sm text-destructive">No se pudo leer el libro: {error}</p>
        </Card>
      )}

      {cargando ? (
        <div className="py-16 grid place-items-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* ── El aviso va ARRIBA del margen, no debajo ─────────────────
              Si se lee el número primero y la advertencia después, el número
              ya se creyó. */}
          {!confianza.confiable && (
            <Card className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">El margen que ves está mejor que el real</p>
                <p className="text-xs text-muted-foreground mt-0.5">{confianza.aviso}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Se arregla cargando el costo de esos productos: el libro toma el
                  costo del momento de la venta, así que las ventas ya asentadas
                  no cambian.
                </p>
              </div>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              titulo="Margen bruto"
              valor={formatARS(resultado.margen_bruto)}
              pie={margen === null ? "Sin ventas en el período" : `${margen}% sobre ventas`}
              destacado
              tendencia={resultado.margen_bruto >= 0 ? "arriba" : "abajo"}
            />
            <Metrica
              titulo="Ventas netas de IVA"
              valor={formatARS(resultado.ventas)}
              pie={`${resultado.asientos} ${resultado.asientos === 1 ? "asiento" : "asientos"}`}
            />
            <Metrica
              titulo="Costo de lo vendido"
              valor={formatARS(resultado.costo_mercaderia)}
              pie="Al costo del momento de la venta"
            />
            <Metrica
              titulo="Resultado del período"
              valor={formatARS(resultado.resultado)}
              pie={rentabilidad === null ? "Sin ingresos" : `${rentabilidad}% sobre ingresos`}
              tendencia={positivo ? "arriba" : "abajo"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <Card className="p-4">
              <p className="text-sm font-medium mb-3">Ventas y margen, por día</p>
              {serie.length === 0 ? (
                <div className="h-56 grid place-items-center text-sm text-muted-foreground">
                  Todavía no hay asientos en este período.
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={serie}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70}
                             tickFormatter={v => formatARS(Number(v))} />
                      <Tooltip
                        formatter={(v: number, n: string) => [formatARS(Number(v)), n]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Area type="monotone" dataKey="ventas" name="Ventas"
                            stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" />
                      <Area type="monotone" dataKey="margen" name="Margen"
                            stroke="hsl(142 70% 40%)" fill="hsl(142 70% 40% / 0.15)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <p className="text-sm font-medium mb-3">Estado de resultados</p>
              <div className="space-y-1.5 text-sm">
                {filas.map(f => (
                  <div
                    key={f.clave}
                    className={`flex items-center justify-between gap-3 ${
                      f.tipo === "subtotal" || f.tipo === "total"
                        ? "border-t pt-1.5 mt-1.5 font-semibold" : ""
                    } ${f.sangria ? "pl-3" : ""}`}
                  >
                    <span className={f.tipo === "resta" ? "text-muted-foreground" : ""}>
                      {f.etiqueta}
                    </span>
                    <span className={`tabular-nums ${
                      f.tipo === "resta" ? "text-muted-foreground" : ""
                    } ${f.tipo === "total" && !positivo ? "text-destructive" : ""}`}>
                      {f.tipo === "resta" ? "−" : ""}{formatARS(Math.abs(f.monto))}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4 flex items-center gap-3">
              <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Billetera</p>
                <p className="text-sm font-semibold tabular-nums">
                  {saldoBilletera === null ? "Sin movimientos" : formatARS(saldoBilletera)}
                </p>
              </div>
            </Card>

            {/* La salud de la cola vive acá y no en una pantalla de sistema:
                si el outbox se atrasa, los asientos de arriba están
                incompletos, y eso es información financiera. */}
            <Card className="p-4 flex items-center gap-3">
              <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Cola de eventos</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold tabular-nums">
                    {colaPendiente === null ? "—" : `${colaPendiente} pendientes`}
                  </p>
                  {colaPendiente !== null && colaPendiente > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      el resultado puede estar incompleto
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Metrica({ titulo, valor, pie, destacado, tendencia }: {
  titulo: string; valor: string; pie: string;
  destacado?: boolean; tendencia?: "arriba" | "abajo";
}) {
  const Icono = tendencia === "abajo" ? TrendingDown : TrendingUp;
  return (
    <Card className={`p-4 ${destacado ? "border-primary/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        {tendencia && (
          <Icono className={`w-3.5 h-3.5 ${
            tendencia === "abajo" ? "text-destructive" : "text-emerald-500"
          }`} />
        )}
      </div>
      <p className={`mt-1 font-semibold tabular-nums ${destacado ? "text-2xl" : "text-lg"}`}>
        {valor}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{pie}</p>
    </Card>
  );
}
