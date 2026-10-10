import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, GraduationCap, PlayCircle } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTutorials } from "@/components/tutorial/TutorialProvider";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CAMINOS, TUTORIALES, avanceCamino } from "@/lib/tutorials";

/** Academia: caminos de aprendizaje con el avance de cada usuario. */
export default function AcademyPage() {
  usePageTitle("Academia");
  const navigate = useNavigate();
  const { progreso } = useTutorials();
  const vistos = useMemo(
    () => new Set([...(progreso ?? new Map()).entries()].filter(([, estado]) => estado === "completado").map(([id]) => id)),
    [progreso],
  );
  const total = Object.keys(TUTORIALES).length;
  const hechos = Object.keys(TUTORIALES).filter(id => vistos.has(id)).length;

  const abrir = (id: string) => {
    const tutorial = TUTORIALES[id];
    if (tutorial) navigate(`${tutorial.ruta}?tutorial=${encodeURIComponent(id)}`);
  };

  return <div className="workspace-page space-y-5">
    <PageHeader icon={GraduationCap} eyebrow="Nerqia · Ayuda" title="Academia"
      description="Aprendé a usar cada parte de Nerqia con recorridos guiados sobre tus pantallas reales."
      badge={{ label: `${hechos} de ${total} lecciones`, variant: hechos === total ? "success" : "default" }} />

    <div className="grid gap-4 md:grid-cols-2">
      {CAMINOS.map(camino => {
        const avance = avanceCamino(camino, vistos);
        const siguiente = camino.lecciones.find(id => !vistos.has(id));
        return <section key={camino.id} className="rounded-[12px] border border-border/60 bg-card p-4" aria-labelledby={`camino-${camino.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={`camino-${camino.id}`} className="font-semibold">{camino.titulo}</h2>
              <p className="text-xs text-muted-foreground">{camino.descripcion}</p>
            </div>
            {siguiente && <Button size="sm" onClick={() => abrir(siguiente)}><PlayCircle className="mr-1 h-4 w-4" />{avance ? "Seguir" : "Empezar"}</Button>}
          </div>
          <Progress value={avance} className="mt-3 h-1.5" aria-label={`Avance de ${camino.titulo}`} />
          <ol className="mt-3 space-y-1">
            {camino.lecciones.map(id => {
              const t = TUTORIALES[id];
              if (!t) return null;
              const hecho = vistos.has(id);
              return <li key={id}>
                <button type="button" onClick={() => abrir(id)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                  {hecho ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="Completada" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Pendiente" />}
                  <span className="min-w-0">
                    <span className="block text-sm">{t.titulo} <span className="text-xs text-muted-foreground">· {t.minutos} min</span></span>
                    <span className="block text-xs text-muted-foreground">{t.resumen}</span>
                  </span>
                </button>
              </li>;
            })}
          </ol>
        </section>;
      })}
    </div>

    <p className="text-xs text-muted-foreground">Además, cada pantalla tiene su recorrido en el botón de ayuda (abajo a la derecha).</p>
  </div>;
}
