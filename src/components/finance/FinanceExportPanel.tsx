/**
 * F5.3 — Panel de exportación contable.
 *
 * Genera lotes exportables desde el libro (partida doble), los descarga como
 * CSV para el contador y deja la traza de exportación. La autoridad es la
 * base: `finance_export_create` valida balance cuadrado y permiso antes de
 * armar el lote; acá sólo orquesta y muestra estados.
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
  FileSpreadsheet, Loader2, Download, RefreshCw, History, CheckCircle2, AlertTriangle,
} from "lucide-react";
import {
  descargarCsvContable, nombreArchivoExport, type FinanceExportBatch,
} from "@/lib/financeExport";

const STATUS_LABEL: Record<FinanceExportBatch["status"], string> = {
  preparado: "Preparando",
  listo: "Listo para descargar",
  exportado: "Exportado",
  error: "Con error",
};

const STATUS_CLS: Record<FinanceExportBatch["status"], string> = {
  preparado: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  listo: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  exportado: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
};

const hoy = () => new Date().toISOString().slice(0, 10);
const primerDiaMes = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
};

export default function FinanceExportPanel() {
  const { activeOrg } = useOrg();
  const { ask, dialog } = useConfirmDialog();
  const [desde, setDesde] = useState(primerDiaMes);
  const [hasta, setHasta] = useState(hoy);
  const [batches, setBatches] = useState<FinanceExportBatch[]>([]);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeOrg) return;
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from("finance_export_batches")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      setBatches((data ?? []) as unknown as FinanceExportBatch[]);
    } catch (e: any) {
      // La tabla puede no existir aún en un deploy viejo: aviso visible,
      // nunca una lista vacía que simule que no pasó nada.
      toast.error(e.message || "No pudimos cargar los lotes de exportación");
    } finally {
      setCargando(false);
    }
  }, [activeOrg]);

  useEffect(() => { cargar(); }, [cargar]);

  const generar = async () => {
    if (!activeOrg) return;
    if (!desde || !hasta || hasta < desde) {
      toast.error("El rango de fechas no es válido");
      return;
    }
    if (!(await ask({
      title: "¿Generar lote de exportación?",
      description: `Se armará el libro diario del ${desde} al ${hasta} desde el ledger. El balance debe cuadrar.`,
      confirmText: "Generar",
    }))) return;
    setGenerando(true);
    try {
      const { error } = await supabase.rpc("finance_export_create" as never, {
        p_org: activeOrg.id, p_fecha_desde: desde, p_fecha_hasta: hasta,
      } as never);
      if (error) throw error;
      toast.success("Lote generado. Ya podés descargar el CSV.");
      await cargar();
    } catch (e: any) {
      toast.error(e.message || "No se pudo generar el lote");
    } finally {
      setGenerando(false);
    }
  };

  const descargar = async (batch: FinanceExportBatch) => {
    if (batch.status !== "listo") return;
    setDescargando(batch.id);
    try {
      const { data, error } = await supabase.rpc("finance_export_batch_csv" as never, {
        p_batch_id: batch.id,
      } as never);
      if (error) throw error;
      const csv = String(data ?? "");
      if (!csv) { toast.error("El lote está vacío"); return; }
      descargarCsvContable(nombreArchivoExport(batch.fecha_desde, batch.fecha_hasta), csv);
      await supabase.rpc("finance_export_mark_exported" as never, { p_batch_id: batch.id } as never);
      toast.success("CSV descargado y exportación registrada");
      await cargar();
    } catch (e: any) {
      toast.error(e.message || "No se pudo descargar el CSV");
    } finally {
      setDescargando(null);
    }
  };

  const puedeGenerar = Boolean(activeOrg) && !generando;

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2 mb-1">
            <FileSpreadsheet className="w-4 h-4 text-primary" /> Exportación contable
          </h3>
          <p className="text-xs text-muted-foreground">
            Generá el libro diario del rango elegido desde los asientos reales y descargalo para tu contador.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">F5.3</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Desde</Label>
          <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-8 w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Hasta</Label>
          <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-8 w-36" />
        </div>
        <Button size="sm" onClick={generar} disabled={!puedeGenerar}>
          {generando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Generar lote
        </Button>
      </div>

      {/* Historial de lotes */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <History className="w-3 h-3" /> Últimos lotes
        </p>
        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Todavía no generaste lotes. Elegí un rango y presioná "Generar lote".
          </p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
            {batches.map(batch => (
              <div key={batch.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {batch.fecha_desde} → {batch.fecha_hasta}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {batch.row_count} partidas · Debe {formatARS(Number(batch.total_debe))} · Haber {formatARS(Number(batch.total_haber))}
                  </p>
                </div>
                <Badge className={`text-[10px] ${STATUS_CLS[batch.status]}`}>
                  {batch.status === "listo" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {batch.status === "error" && <AlertTriangle className="w-3 h-3 mr-1" />}
                  {STATUS_LABEL[batch.status]}
                </Badge>
                {batch.status === "listo" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={descargando === batch.id}
                    onClick={() => descargar(batch)}
                  >
                    {descargando === batch.id
                      ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      : <Download className="w-3 h-3 mr-1" />}
                    CSV
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}