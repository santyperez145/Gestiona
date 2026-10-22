import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { useDisponibilidadDelServicio } from "@/hooks/useDisponibilidadDelServicio";
import { MENSAJE_SERVICIO_CAIDO, MENSAJE_SIN_CONEXION } from "@/lib/disponibilidadDelServicio";

/**
 * Aviso cuando Nerqia no responde (o no hay internet). `soloCaida` lo limita al
 * caso en que el problema es nuestro, para pantallas que ya avisan la falta de
 * conexión por su cuenta.
 */
export default function AvisoServicioNoDisponible({ soloCaida = false, className = "" }: { soloCaida?: boolean; className?: string }) {
  const { estado, reintentar } = useDisponibilidadDelServicio();
  if (estado === "disponible" || estado === "comprobando") return null;
  if (estado === "sin_conexion" && soloCaida) return null;
  const caido = estado === "caido";
  const Icono = caido ? CloudOff : WifiOff;
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm ${className}`}>
      <Icono className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <p className="flex-1">{caido ? MENSAJE_SERVICIO_CAIDO : MENSAJE_SIN_CONEXION}</p>
      <button type="button" onClick={reintentar} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">
        <RefreshCw className="w-3 h-3" />Reintentar
      </button>
    </div>
  );
}
