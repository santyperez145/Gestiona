import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { EstadoControlFiscal, SaludFiscal } from "@/lib/fiscalHealth";

const ICONO: Record<EstadoControlFiscal, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", label: "Correcto" },
  atencion: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400", label: "Atención" },
  falla: { icon: XCircle, className: "text-red-600 dark:text-red-400", label: "Falla" },
};

function colorPuntaje(puntaje: number) {
  if (puntaje >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (puntaje >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Controles fiscales calculados en `saludFiscal`; la pantalla sólo los presenta. */
export default function FiscalHealthPanel({ salud }: { salud: SaludFiscal }) {
  return (
    <section aria-labelledby="fiscal-health-title" className="bg-card border border-border/40 rounded-xl">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border/40">
        <div className="flex-1 min-w-[12rem]">
          <h2 id="fiscal-health-title" className="font-semibold">Salud fiscal</h2>
          <p className="text-xs text-muted-foreground mt-1">Calculada con la conexión y los últimos comprobantes; no consulta ARCA.</p>
        </div>
        <p className={`text-2xl font-semibold tabular-nums ${colorPuntaje(salud.puntaje)}`} aria-label={`Puntaje ${salud.puntaje} de 100`}>
          {salud.puntaje}<span className="text-sm text-muted-foreground font-normal"> / 100</span>
        </p>
      </div>
      <ul className="divide-y divide-border/30">
        {salud.controles.map((control) => {
          const { icon: Icon, className, label } = ICONO[control.estado];
          return (
            <li key={control.id} className="flex items-start gap-3 px-5 py-3">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${className}`} aria-label={label} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{control.titulo}</p>
                <p className="text-xs text-muted-foreground">{control.detalle}</p>
              </div>
              {control.id === "rechazos" && control.estado !== "ok" && (
                <Link to="/facturas" className="text-xs font-medium text-primary hover:underline shrink-0">Ver pendientes</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
