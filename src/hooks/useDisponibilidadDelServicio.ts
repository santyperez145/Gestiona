import { useCallback, useEffect, useRef, useState } from "react";
import { getOptionalEnv } from "@/lib/env";
import { comprobarServicio, type Disponibilidad } from "@/lib/disponibilidadDelServicio";

const REINTENTO_MS = 30_000;

/**
 * Comprueba si Nerqia responde al montar y, mientras no responda, cada 30
 * segundos: el aviso se va solo cuando el servicio vuelve.
 */
export function useDisponibilidadDelServicio(): { estado: Disponibilidad | "comprobando"; reintentar: () => void } {
  const [estado, setEstado] = useState<Disponibilidad | "comprobando">("comprobando");
  const vivo = useRef(true);

  const comprobar = useCallback(async () => {
    const r = await comprobarServicio({
      urlServidor: getOptionalEnv("VITE_SUPABASE_URL") ?? "",
      clave: getOptionalEnv("VITE_SUPABASE_ANON_KEY") ?? getOptionalEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "",
      enLinea: typeof navigator === "undefined" ? true : navigator.onLine,
    });
    if (vivo.current) setEstado(r);
  }, []);

  useEffect(() => {
    vivo.current = true;
    void comprobar();
    const alVolver = () => void comprobar();
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alVolver);
    return () => {
      vivo.current = false;
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alVolver);
    };
  }, [comprobar]);

  useEffect(() => {
    if (estado === "disponible" || estado === "comprobando") return;
    const t = window.setInterval(() => void comprobar(), REINTENTO_MS);
    return () => window.clearInterval(t);
  }, [estado, comprobar]);

  return { estado, reintentar: () => { setEstado("comprobando"); void comprobar(); } };
}
