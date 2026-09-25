/**
 * F5.4 — Panel de conciliación bancaria.
 *
 * Importar un extracto CSV del banco, dejar que la base proponga matches
 * contra los asientos que mueven banco (1.1.02) y confirmarlos o rechazarlos.
 * La autoridad vive en la base (RPCs de `financeBank.ts`); acá sólo se
 * orquesta y se muestra el estado real: propuesta = cálculo, confirmación =
 * decisión de la marca.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatARS } from "@/lib/supabaseStore";
import { useOrg } from "@/lib/orgContext";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import {
  Landmark, Loader2, RefreshCw, Upload, Check, X, Sparkles, FileWarning, CheckCircle2,
} from "lucide-react";
import {
  bankStatementUpload, bankLinesMatch, bankLineConfirm, parseBankCsv,
  type BankStatement, type BankLine,
} from "@/lib/financeBank";

const STATUS_STMT: Record<BankStatement["status"], { label: string; cls: string }> = {
  importado: { label: "Importado", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  parcial: { label: "Parcial", cls: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" },
  conciliado: { label: "Conciliado", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

const STATUS_LINE: Record<BankLine["match_status"], { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-muted text-muted-foreground" },
  propuesto: { label: "Propuesto", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  confirmado: { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  sin_match: { label: "Sin match", cls: "bg-destructive/15 text-destructive" },
};

export default function BankReconciliationPanel() {
  const { activeOrg } = useOrg();
  const { ask, dialog } = useConfirmDialog();
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [cargando, setCargando] = useState(true);
  const [selected, setSelected] = useState<BankStatement | null>(null);
  const [lines, setLines] = useState<BankLine[]>([]);
  const [cargandoLineas, setCargandoLineas] = useState(false);
  const [matcheando, setMatcheando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeOrg) return;
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from("finance_bank_statements")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      setStatements((data ?? []) as unknown as BankStatement[]);
      setSelected(prev => {
        if (prev && !(data ?? []).some((s: any) => s.id === prev.id)) return null;
        return prev;
      });
    } catch (e: any) {
      // La tabla puede no existir aún en un deploy viejo: aviso visible,
      // nunca una lista vacía que simule que no pasó nada.
      toast.error(e.message || "No pudimos cargar los extractos");
    } finally {
      setCargando(false);
    }
  }, [activeOrg]);

  const cargarLineas = useCallback(async (stmt: BankStatement) => {
    setCargandoLineas(true);
    try {
      const { data, error } = await supabase
        .from("finance_bank_lines")
        .select("*")
        .eq("statement_id", stmt.id)
        .order("fecha", { ascending: true });
      if (error) throw error;
      setLines((data ?? []) as unknown as BankLine[]);
    } catch (e: any) {
      toast.error(e.message || "No pudimos cargar los movimientos");
    } finally {
      setCargandoLineas(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (selected) cargarLineas(selected); }, [selected, cargarLineas]);

  const importar = async (file: File) => {
    if (!activeOrg) return;
    const banco = window.prompt("¿Con qué banco querés conciliar este extracto? (ej: Galicia, Santander)");
    if (!banco || !banco.trim()) return;
    setImportando(true);
    try {
      const raw = await file.text();
      const { lines } = parseBankCsv(raw);
      const fechas = lines.map(l => l.fecha).sort();
      const fechaDesde = fechas[0];
      const fechaHasta = fechas[fechas.length - 1];
      if (!(await ask({
        title: "¿Importar extracto?",
        description: `${lines.length} movimientos de ${banco.trim()} entre ${fechaDesde} y ${fechaHasta}. El mismo archivo no se duplica si lo volvés a subir.`,
        confirmText: "Importar",
      }))) { setImportando(false); return; }
      const id = await bankStatementUpload({
        orgId: activeOrg.id, banco: banco.trim(), fechaDesde, fechaHasta, lines,
      });
      toast.success("Extracto importado");
      await cargar();
      const stmt = statements.find(s => s.id === id);
      if (stmt) setSelected(stmt);
    } catch (e: any) {
      toast.error(e.message || "No se pudo importar el extracto");
    } finally {
      setImportando(false);
    }
  };

  const matchear = async () => {
    if (!selected) return;
    setMatcheando(true);
    try {
      const n = await bankLinesMatch(selected.id);
      toast.success(n > 0
        ? `${n} movimiento(s) con match propuesto. Revisá y confirmá.`
        : "Sin candidatos automáticos. Revisá los movimientos manualmente.");
      await cargar();
      await cargarLineas({ ...selected });
    } catch (e: any) {
      toast.error(e.message || "No se pudieron calcular matches");
    } finally {
      setMatcheando(false);
    }
  };

  const confirmar = async (line: BankLine, accept: boolean) => {
    setConfirmando(line.id);
    try {
      await bankLineConfirm(line.id, accept);
      await cargar();
      if (selected) await cargarLineas(selected);
    } catch (e: any) {
      toast.error(e.message || "No se pudo actualizar el match");
    } finally {
      setConfirmando(null);
    }
  };

  const conPropuestas = lines.filter(l => l.match_status === "propuesto").length;

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2 mb-1">
            <Landmark className="w-4 h-4 text-primary" /> Conciliación bancaria
          </h3>
          <p className="text-xs text-muted-foreground">
            Importá el extracto del banco, la base propone matches contra los asientos y vos confirmás.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">F5.4</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void importar(f);
              e.target.value = "";
            }}
          />
          <span className="inline-flex items-center justify-center gap-2 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground cursor-pointer hover:opacity-90">
            {importando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Importar CSV del banco
          </span>
        </label>
        <Button size="sm" variant="outline" onClick={cargar} disabled={cargando}>
          <RefreshCw className={`w-4 h-4 mr-1 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {/* Historial de extractos */}
      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : statements.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Todavía no importaste extractos. Descargá el CSV desde tu banco e importalo acá.
        </p>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
          {statements.map(stmt => (
            <button
              key={stmt.id}
              type="button"
              onClick={() => setSelected(selected?.id === stmt.id ? null : stmt)}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 ${selected?.id === stmt.id ? "bg-muted/50" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{stmt.banco} · {stmt.fecha_desde} → {stmt.fecha_hasta}</p>
                  <p className="text-xs text-muted-foreground">
                    {stmt.row_count} movimientos · {stmt.matched_count} conciliados · Ingresos {formatARS(Number(stmt.total_ingresos))} · Egresos {formatARS(Number(stmt.total_egresos))}
                  </p>
                </div>
                <Badge className={`text-[10px] ${STATUS_STMT[stmt.status].cls}`}>
                  {stmt.status === "conciliado" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {STATUS_STMT[stmt.status].label}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detalle del extracto seleccionado */}
      {selected && (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={matchear} disabled={matcheando}>
              {matcheando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              Buscar matches
            </Button>
            {conPropuestas > 0 && (
              <span className="text-xs text-muted-foreground">
                {conPropuestas} propuesta(s) esperando confirmación
              </span>
            )}
          </div>

          {cargandoLineas ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando movimientos…
            </div>
          ) : lines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">El extracto no tiene movimientos.</p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden max-h-96 overflow-y-auto">
              {lines.map(line => (
                <div key={line.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{line.concepto}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.fecha}{line.referencia ? ` · Ref ${line.referencia}` : ""}
                      {line.match_entry_id ? ` · Asiento ${line.match_entry_id.slice(0, 8)}…` : ""}
                    </p>
                  </div>
                  <span className={`font-mono text-xs ${line.monto > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {line.monto > 0 ? "+" : ""}{formatARS(Number(line.monto))}
                  </span>
                  <Badge className={`text-[10px] ${STATUS_LINE[line.match_status].cls}`}>
                    {STATUS_LINE[line.match_status].label}
                  </Badge>
                  {line.match_status === "propuesto" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={confirmando === line.id}
                        onClick={() => confirmar(line, true)}>
                        {confirmando === line.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={confirmando === line.id}
                        onClick={() => confirmar(line, false)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {lines.some(l => l.match_status === "sin_match") && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <FileWarning className="w-3.5 h-3.5" />
              Hay movimientos sin match: el banco y el libro no cuentan lo mismo. Revisalos antes de cerrar el período.
            </p>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
