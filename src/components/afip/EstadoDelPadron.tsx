/**
 * Debajo de un campo de CUIT: qué pasó con la consulta automática al padrón
 * de ARCA. Ver `usePadronAutomatico`.
 */
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { EstadoPadron } from "@/hooks/usePadronAutomatico";
import { CONDICIONES_IVA } from "@/lib/fiscalIdentity";

export default function EstadoDelPadron({ estado, onReintentar, cuitCompleto, onConsultar }: {
  estado: EstadoPadron;
  onReintentar: () => void;
  /** Si el CUIT ya tiene 11 dígitos válidos (para ofrecer «Consultar» cuando se abrió con datos). */
  cuitCompleto?: boolean;
  onConsultar?: () => void;
}) {
  if (estado.estado === "buscando") {
    return <p role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Buscando en el padrón de ARCA…</p>;
  }
  if (estado.estado === "listo") {
    const p = estado.persona;
    const inactiva = p.estadoClave && p.estadoClave.toUpperCase() !== "ACTIVO";
    const condicion = CONDICIONES_IVA[p.condicionIva as keyof typeof CONDICIONES_IVA]?.label ?? p.condicionIva;
    return (
      <p role="status" className={`flex items-start gap-1.5 text-[11px] ${inactiva ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
        {inactiva ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
        <span>
          ARCA: <strong>{p.nombre}</strong> · {condicion}{p.categoriaMonotributo ? ` (categoría ${p.categoriaMonotributo})` : ""}
          {inactiva ? ` · clave fiscal ${p.estadoClave!.toLowerCase()}` : ""}
        </span>
      </p>
    );
  }
  if (estado.estado === "error") {
    const configurar = estado.code === "sin_credencial" || estado.code === "servicio_no_asociado";
    return (
      <div role="status" className="space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
        <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{configurar ? "La consulta automática a ARCA no está habilitada todavía: completá los datos a mano." : estado.mensaje}</span>
        </p>
        <p className="flex flex-wrap gap-3 pl-[18px]">
          {configurar
            ? <Link to="/afip#consulta-cuit" className="underline underline-offset-2">Cómo habilitarla</Link>
            : estado.code !== "no_encontrado" && <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={onReintentar}><RefreshCw className="h-3 w-3" aria-hidden />Reintentar</button>}
        </p>
      </div>
    );
  }
  if (cuitCompleto && onConsultar) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline" onClick={onConsultar}>
        <Search className="h-3 w-3" aria-hidden />Actualizar con los datos de ARCA
      </button>
    );
  }
  return null;
}
