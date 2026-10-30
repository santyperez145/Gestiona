/**
 * Arqueo de caja (2026-10-23): contar el efectivo —por billete, si se quiere—
 * y declarar lo de tarjetas, QR y transferencias contra lo que dice el
 * sistema. Parcial en medio del turno, o de cierre (cierra el turno). Queda
 * registrado, con quién contó y el motivo de cada diferencia
 * (`registrar_arqueo`, 20261023000700).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ClipboardCheck, Lock, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { isMissingFunction, isMissingRelation } from "@/lib/publicDataSource";
import { denominacionesParaBase, NOMBRE_MEDIO, sistemaPorMedio, totalDenominaciones, type MovimientoDeCaja } from "@/lib/arqueo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CashDenominationCountDialog from "@/components/shared/CashDenominationCountDialog";

type ArqueoRegistrado = {
  id: string;
  tipo: "parcial" | "cierre";
  efectivo_contado: number;
  efectivo_esperado: number;
  diferencia: number;
  otros_medios: { medio: string; sistema: number; declarado: number | null; diferencia: number | null }[];
  motivo: string | null;
  realizado_at: string;
};

const nombreMedio = (m: string) => NOMBRE_MEDIO[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

export default function ArqueoDeCaja({
  sessionId, expectedCash, movimientos, onDone,
}: {
  sessionId: string;
  expectedCash: number;
  movimientos: MovimientoDeCaja[];
  onDone: () => void | Promise<void>;
}) {
  const [efectivo, setEfectivo] = useState("");
  const [conteo, setConteo] = useState<Record<string, number> | null>(null);
  const [contadorAbierto, setContadorAbierto] = useState(false);
  const [declarado, setDeclarado] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState<"parcial" | "cierre" | null>(null);
  const [arqueos, setArqueos] = useState<ArqueoRegistrado[] | null>(null);

  const sistema = useMemo(() => sistemaPorMedio(movimientos), [movimientos]);
  const medios = useMemo(() => Object.keys(sistema).sort(), [sistema]);
  const difEfectivo = efectivo.trim() === "" ? null : Math.round((Number(efectivo) - expectedCash) * 100) / 100;
  const difMedios = medios
    .filter(m => (declarado[m] ?? "").trim() !== "")
    .map(m => ({ medio: m, dif: Math.round((Number(declarado[m]) - sistema[m]) * 100) / 100 }));
  const hayDiferencia = Math.abs(difEfectivo ?? 0) >= 1 || difMedios.some(d => Math.abs(d.dif) >= 1);

  const leerArqueos = useCallback(async () => {
    const { data, error } = await supabase.from("arqueos_caja" as never)
      .select("id, tipo, efectivo_contado, efectivo_esperado, diferencia, otros_medios, motivo, realizado_at")
      .eq("session_id", sessionId).order("realizado_at", { ascending: false });
    if (error) {
      if (!isMissingRelation(error)) console.error("[Caja] no se pudieron leer los arqueos", error);
      setArqueos(null);
      return;
    }
    setArqueos((data ?? []) as unknown as ArqueoRegistrado[]);
  }, [sessionId]);
  useEffect(() => { void leerArqueos(); }, [leerArqueos]);

  const registrar = async (tipo: "parcial" | "cierre") => {
    if (efectivo.trim() === "" || Number(efectivo) < 0) { toast.error("Escribí el efectivo contado"); return; }
    if (hayDiferencia && !motivo.trim()) {
      toast.error("El arqueo tiene diferencias: escribí el motivo");
      return;
    }
    setEnviando(tipo);
    try {
      const otros: Record<string, number> = {};
      for (const m of medios) if ((declarado[m] ?? "").trim() !== "") otros[m] = Number(declarado[m]);
      const { data, error } = await supabase.rpc("registrar_arqueo" as never, {
        p_session_id: sessionId,
        p_tipo: tipo,
        p_efectivo: Number(efectivo),
        p_denominaciones: conteo ?? {},
        p_otros_medios: otros,
        p_motivo: motivo.trim() || null,
      } as never);
      if (error && isMissingFunction(error) && tipo === "cierre") {
        // Sin la migración: el cierre de siempre, sin arqueo registrado.
        const cierre = await supabase.rpc("pos_cash_session_close" as never, {
          p_session_id: sessionId, p_closing_amount: Number(efectivo), p_notes: motivo.trim() || null,
        } as never);
        if (cierre.error) throw cierre.error;
      } else if (error && isMissingFunction(error)) {
        toast.error("El arqueo parcial todavía no está disponible en tu cuenta. Podés cerrar la caja igual.");
        return;
      } else if (error) {
        throw error;
      }
      const r = data as { diferencia?: number } | null;
      toast.success(tipo === "cierre"
        ? "Caja cerrada con su arqueo"
        : `Arqueo registrado${r && Math.abs(Number(r.diferencia ?? 0)) >= 1 ? ` con diferencia de ${formatARS(Number(r.diferencia))}` : ": cuadra"}`);
      setEfectivo(""); setConteo(null); setDeclarado({}); setMotivo("");
      await leerArqueos();
      await onDone();
    } catch (e) {
      console.error("[Caja] no se pudo registrar el arqueo", e);
      toast.error(e instanceof Error ? e.message : "No se pudo registrar el arqueo");
    } finally {
      setEnviando(null);
    }
  };

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-primary" />Arqueo y cierre de caja</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs" htmlFor="arqueo-efectivo">Efectivo contado ($)</Label>
            <button type="button" onClick={() => setContadorAbierto(true)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
              <Banknote className="w-3 h-3" />Contar billetes
            </button>
          </div>
          <Input
            id="arqueo-efectivo" type="number" min="0" step="100" value={efectivo}
            onChange={e => {
              setEfectivo(e.target.value);
              // Si el monto ya no es el del conteo, el conteo deja de valer.
              if (conteo && Number(e.target.value) !== totalDenominaciones(conteo)) setConteo(null);
            }}
            placeholder={formatARS(expectedCash)} className="bg-muted font-mono"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Esperado: {formatARS(expectedCash)}{conteo ? " · contado por billete" : ""}</p>
          {difEfectivo !== null && (
            <p className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${Math.abs(difEfectivo) < 1 ? "text-green-600 dark:text-green-400" : difEfectivo > 0 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}`}>
              {difEfectivo >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(difEfectivo) < 1 ? "Cuadra" : difEfectivo > 0 ? `Sobran ${formatARS(difEfectivo)}` : `Faltan ${formatARS(Math.abs(difEfectivo))}`}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">Otros medios <span className="font-normal text-muted-foreground">(lote del posnet, resumen del QR)</span></p>
          {medios.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">En este turno no hubo cobros que no sean en efectivo.</p>
          ) : medios.map(m => {
            const d = difMedios.find(x => x.medio === m)?.dif;
            return (
              <div key={m} className="flex items-center gap-2">
                <Label htmlFor={`arqueo-medio-${m}`} className="w-28 text-xs">{nombreMedio(m)}</Label>
                <span className="w-24 text-right font-mono text-xs text-muted-foreground">{formatARS(sistema[m])}</span>
                <Input
                  id={`arqueo-medio-${m}`} type="number" min="0" step="1" value={declarado[m] ?? ""}
                  onChange={e => setDeclarado(prev => ({ ...prev, [m]: e.target.value }))}
                  placeholder="Declarado" className="h-8 w-28 bg-muted font-mono text-xs"
                />
                {d !== undefined && Math.abs(d) >= 1 && (
                  <span className="text-[11px] font-semibold text-red-700 dark:text-red-400">{d > 0 ? "+" : "−"}{formatARS(Math.abs(d))}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="text-xs" htmlFor="arqueo-motivo">{hayDiferencia ? "Motivo de la diferencia (obligatorio)" : "Observaciones"}</Label>
        <Input id="arqueo-motivo" value={motivo} onChange={e => setMotivo(e.target.value)}
          placeholder="Ej: falta un cupón del posnet, vuelto mal dado…" className="bg-muted" aria-required={hayDiferencia} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void registrar("parcial")} disabled={enviando !== null || efectivo.trim() === ""} className="gap-2">
          <ClipboardCheck className="w-4 h-4" />{enviando === "parcial" ? "Registrando…" : "Arqueo parcial"}
        </Button>
        <Button variant="destructive" onClick={() => void registrar("cierre")} disabled={enviando !== null || efectivo.trim() === ""} className="gap-2">
          <Lock className="w-4 h-4" />{enviando === "cierre" ? "Cerrando…" : "Cerrar caja con este arqueo"}
        </Button>
        <Button variant="ghost" onClick={() => void onDone()} className="gap-2"><RotateCcw className="w-4 h-4" />Actualizar</Button>
      </div>

      {arqueos && arqueos.length > 0 && (
        <div className="border-t border-border/40 pt-3">
          <p className="text-xs font-medium mb-2">Arqueos de este turno</p>
          <ul className="space-y-1 text-xs">
            {arqueos.map(a => (
              <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-mono text-muted-foreground">{new Date(a.realizado_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span>{a.tipo === "cierre" ? "Cierre" : "Parcial"}</span>
                <span>Efectivo {formatARS(Number(a.efectivo_contado))}</span>
                <span className={Math.abs(Number(a.diferencia)) >= 1 ? "font-semibold text-red-700 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {Math.abs(Number(a.diferencia)) < 1 ? "cuadra" : `${Number(a.diferencia) > 0 ? "sobran" : "faltan"} ${formatARS(Math.abs(Number(a.diferencia)))}`}
                </span>
                {a.motivo && <span className="text-muted-foreground">· {a.motivo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CashDenominationCountDialog
        open={contadorAbierto}
        onClose={() => setContadorAbierto(false)}
        expectedBalance={expectedCash}
        onConfirm={(total, desglose) => {
          setEfectivo(String(total));
          setConteo(denominacionesParaBase(desglose));
          setContadorAbierto(false);
        }}
        title="Contar el efectivo"
      />
    </div>
  );
}
