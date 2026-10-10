import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Tutorial } from "@/lib/tutorials";
import TutorialOverlay from "./TutorialOverlay";

type Estado = "completado" | "omitido";

type TutorialContextValue = {
  /** null mientras carga: no se ofrece nada hasta saber qué vio el usuario. */
  progreso: Map<string, Estado> | null;
  activo: Tutorial | null;
  iniciar: (tutorial: Tutorial) => void;
  marcar: (id: string, estado: Estado) => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorials(): TutorialContextValue {
  const value = useContext(TutorialContext);
  if (!value) throw new Error("useTutorials fuera de TutorialProvider");
  return value;
}

/** Progreso por usuario en `tutorial_progress`; el recorrido activo vive acá. */
export function TutorialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [progreso, setProgreso] = useState<Map<string, Estado> | null>(null);
  const [activo, setActivo] = useState<Tutorial | null>(null);

  useEffect(() => {
    if (!user?.id) { setProgreso(null); return; }
    let vigente = true;
    supabase.from("tutorial_progress").select("tutorial_id, estado").eq("user_id", user.id)
      .then(({ data, error }) => {
        if (!vigente) return;
        // Si no se puede leer, se asume vacío: ofrecer de más es mejor que nunca ofrecer.
        if (error) console.error("[tutoriales] progreso", error);
        setProgreso(new Map((data ?? []).map(fila => [fila.tutorial_id, fila.estado as Estado])));
      });
    return () => { vigente = false; };
  }, [user?.id]);

  const marcar = useCallback((id: string, estado: Estado) => {
    setProgreso(prev => {
      const next = new Map(prev ?? []);
      // Lo completado no vuelve a «omitido».
      if (next.get(id) !== "completado") next.set(id, estado);
      return next;
    });
    if (!user?.id) return;
    const fila = { user_id: user.id, tutorial_id: id, estado, updated_at: new Date().toISOString() };
    const consulta = estado === "completado"
      ? supabase.from("tutorial_progress").upsert(fila, { onConflict: "user_id,tutorial_id" })
      : supabase.from("tutorial_progress").upsert(fila, { onConflict: "user_id,tutorial_id", ignoreDuplicates: true });
    consulta.then(({ error }) => { if (error) console.error("[tutoriales] guardar", error); });
  }, [user?.id]);

  const iniciar = useCallback((tutorial: Tutorial) => setActivo(tutorial), []);

  const value = useMemo(() => ({ progreso, activo, iniciar, marcar }), [progreso, activo, iniciar, marcar]);

  return <TutorialContext.Provider value={value}>
    {children}
    {activo && <TutorialOverlay
      tutorial={activo}
      onTerminar={() => { marcar(activo.id, "completado"); setActivo(null); }}
      onCerrar={() => { marcar(activo.id, "omitido"); setActivo(null); }}
    />}
  </TutorialContext.Provider>;
}
