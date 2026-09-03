import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandLogo from "@/components/shared/BrandLogo";
import {
  fetchPublicServiceStatus,
  overallServiceState,
  serviceStateLabel,
  type PublicServiceState,
  type PublicServiceStatus,
} from "@/lib/serviceStatus";

function StateIcon({ state }: { state: PublicServiceState }) {
  if (state === "operational") return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (state === "degraded") return <AlertTriangle className="h-5 w-5 text-amber-400" />;
  return <CircleHelp className="h-5 w-5 text-muted-foreground" />;
}

function StateClass({ state }: { state: PublicServiceState }) {
  if (state === "operational") return "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300";
  if (state === "degraded") return "border-amber-500/30 bg-amber-500/[0.07] text-amber-200";
  return "border-border/60 bg-muted/30 text-muted-foreground";
}

export default function ServiceStatusPage() {
  const [rows, setRows] = useState<PublicServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchPublicServiceStatus());
    } catch {
      setRows([]);
      setError("No podemos consultar el estado ahora. Volvé a intentar en unos minutos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const overall = overallServiceState(rows);
  const latestCheck = rows.reduce<string | null>((latest, row) => !latest || row.checked_at > latest ? row.checked_at : latest, null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /><BrandLogo markClassName="h-5 w-5" nameClassName="text-sm" />
          </Link>
          <div className="flex items-center gap-2 font-display text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />Estado del servicio</div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <section className="rounded-[12px] border border-border/60 bg-card p-6 md:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Transparencia operativa</p>
              <h1 className="font-display text-3xl font-bold tracking-tight">Estado de Nerqia</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Mostramos señales agregadas de la aplicación, las tareas automáticas y la integridad de respaldos. No publicamos datos de comercios, proveedores ni detalles internos.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Actualizar
            </Button>
          </div>

          <div className={`mt-7 flex items-center gap-3 rounded-lg border p-4 ${StateClass({ state: overall })}`}>
            <StateIcon state={overall} />
            <div><p className="font-semibold">{serviceStateLabel(overall)}</p><p className="mt-0.5 text-xs opacity-85">{overall === "operational" ? "Las señales disponibles responden correctamente." : overall === "degraded" ? "Hay una incidencia conocida; el equipo la está revisando." : "No hay evidencia suficiente para afirmar el estado general."}</p></div>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-[12px] border border-border/60 bg-card">
          <div className="border-b border-border/50 px-5 py-4"><h2 className="font-semibold">Componentes</h2><p className="mt-1 text-xs text-muted-foreground">Una señal sin historial se informa como tal; no se la muestra como disponible por defecto.</p></div>
          {loading ? <p className="p-8 text-center text-sm text-muted-foreground">Consultando señales…</p> : error ? <p className="p-8 text-center text-sm text-muted-foreground">{error}</p> : (
            <div className="divide-y divide-border/50">
              {rows.map(row => (
                <div key={row.component} className="flex items-start gap-3 px-5 py-4">
                  <StateIcon state={row.status} />
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-sm">{row.component}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${StateClass({ state: row.status })}`}>{serviceStateLabel(row.status)}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.detail}</p></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="mt-5 text-center text-xs text-muted-foreground">{latestCheck ? `Última consulta: ${new Date(latestCheck).toLocaleString("es-AR")}` : "La hora se mostrará cuando la consulta esté disponible."}</p>
      </main>
    </div>
  );
}
