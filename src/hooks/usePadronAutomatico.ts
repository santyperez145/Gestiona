/**
 * Al terminar de escribir un CUIT válido, consulta el padrón de ARCA solo
 * (2026-10-22): sin botón, con una pausa corta para no consultar mientras se
 * tipea. El valor con el que se abre el formulario no se consulta (editar un
 * cliente no tiene que pisar lo que ya tiene); sí cualquier CUIT nuevo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { consultarPadron, type PersonaPadron } from "@/lib/arcaPadron";
import { cuitValido } from "../../supabase/functions/_shared/padronA5";

export type EstadoPadron =
  | { estado: "inactivo" }
  | { estado: "buscando" }
  | { estado: "listo"; persona: PersonaPadron; desdeCache: boolean }
  | { estado: "error"; mensaje: string; code?: string; pasos?: string };

const PAUSA_MS = 450;

export function usePadronAutomatico(
  orgId: string | null | undefined,
  cuitTexto: string,
  onPersona: (persona: PersonaPadron) => void,
): { estado: EstadoPadron; reintentar: () => void; conocido: (cuitTexto: string) => void } {
  const digitos = String(cuitTexto ?? "").replace(/\D/g, "");
  const [estado, setEstado] = useState<EstadoPadron>({ estado: "inactivo" });
  const inicial = useRef(digitos);
  const consultado = useRef<string | null>(null);
  const callback = useRef(onPersona);
  callback.current = onPersona;
  const pedido = useRef(0);

  const consultar = useCallback(async (cuit: string) => {
    if (!orgId) return;
    const id = ++pedido.current;
    consultado.current = cuit;
    setEstado({ estado: "buscando" });
    const r = await consultarPadron(orgId, cuit);
    if (id !== pedido.current) return; // ya escribieron otro CUIT
    if ("error" in r) {
      setEstado({ estado: "error", mensaje: r.error, code: r.code, pasos: r.pasos });
    } else {
      setEstado({ estado: "listo", persona: r.persona, desdeCache: r.desdeCache });
      callback.current(r.persona);
    }
  }, [orgId]);

  useEffect(() => {
    if (digitos.length !== 11 || !cuitValido(digitos)) {
      pedido.current++;
      setEstado({ estado: "inactivo" });
      return;
    }
    if (digitos === inicial.current && consultado.current === null) return;
    if (digitos === consultado.current) return;
    const t = window.setTimeout(() => void consultar(digitos), PAUSA_MS);
    return () => window.clearTimeout(t);
  }, [digitos, consultar]);

  const reintentar = useCallback(() => {
    if (digitos.length === 11 && cuitValido(digitos)) void consultar(digitos);
  }, [digitos, consultar]);

  // Un CUIT que llegó de una ficha ya cargada (elegir un cliente) no se consulta solo.
  const conocido = useCallback((texto: string) => {
    pedido.current++;
    consultado.current = String(texto ?? "").replace(/\D/g, "");
    setEstado({ estado: "inactivo" });
  }, []);

  return { estado, reintentar, conocido };
}
