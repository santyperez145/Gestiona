import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { GraduationCap, Headphones, HelpCircle, Lightbulb, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TUTORIALES, tutorialDeRuta, type RutaParaTutorial } from "@/lib/tutorials";
import PageGuide, { guiaDeRuta } from "@/components/shared/PageGuide";
import { useTutorials } from "./TutorialProvider";

/**
 * Botón de ayuda presente en toda la plataforma, la oferta del recorrido en la
 * primera visita a cada pantalla y el arranque por `?tutorial=<id>` (lo usa la
 * Academia para llevar a la pantalla y empezar).
 */
export default function TutorialHelp({ ruta, inmersiva }: { ruta: RutaParaTutorial | null; inmersiva: boolean }) {
  const { progreso, activo, iniciar, marcar } = useTutorials();
  const [params, setParams] = useSearchParams();
  const [ofertaCerrada, setOfertaCerrada] = useState<string | null>(null);
  const [consejosAbiertos, setConsejosAbiertos] = useState(false);
  const { pathname } = useLocation();
  const guia = useMemo(() => guiaDeRuta(pathname), [pathname]);

  // En el inicio, la primera vez se ofrece la bienvenida a la plataforma.
  const tutorial = useMemo(() => {
    if (!ruta) return null;
    if (ruta.path === "/" && progreso && !progreso.has("bienvenida")) return TUTORIALES.bienvenida;
    return tutorialDeRuta(ruta, guia?.tips ?? []);
  }, [ruta, progreso, guia]);

  useEffect(() => {
    const pedido = params.get("tutorial");
    if (!pedido) return;
    const elegido = TUTORIALES[pedido] ?? (tutorial?.id === pedido ? tutorial : null);
    const siguientes = new URLSearchParams(params);
    siguientes.delete("tutorial");
    setParams(siguientes, { replace: true });
    // La pantalla tarda un instante en dibujar lo que el recorrido señala.
    if (elegido) window.setTimeout(() => iniciar(elegido), 400);
  }, [params, setParams, tutorial, iniciar]);

  const ofrecer = !!tutorial && !!progreso && !activo && !progreso.has(tutorial.id)
    && ofertaCerrada !== tutorial.id && !params.get("tutorial");

  return <>
    {ofrecer && tutorial && <div role="status"
      className={`fixed z-40 w-[min(20rem,calc(100vw-2rem))] rounded-[12px] border border-border bg-card p-3 shadow-lg ${inmersiva ? "right-4 top-14" : "bottom-20 right-4"}`}>
      <p className="text-sm font-semibold">¿Primera vez en {tutorial.titulo}?</p>
      <p className="mt-1 text-xs text-muted-foreground">{tutorial.resumen} Te lo muestro en {tutorial.minutos} min.</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOfertaCerrada(tutorial.id); marcar(tutorial.id, "omitido"); }}>Ahora no</Button>
        <Button type="button" size="sm" onClick={() => { setOfertaCerrada(tutorial.id); iniciar(tutorial); }}>
          <PlayCircle className="mr-1 h-4 w-4" />Ver recorrido
        </Button>
      </div>
    </div>}

    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-tour="ayuda" aria-label="Ayuda y tutoriales"
          className={`fixed z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-primary shadow-md transition-colors hover:bg-muted ${inmersiva ? "right-4 top-3 h-9 w-9" : "bottom-4 right-4"}`}>
          <HelpCircle className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-semibold text-muted-foreground">Ayuda</p>
        {tutorial && <button type="button" onClick={() => iniciar(tutorial)}
          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted">
          <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span><span className="block font-medium">Recorrido de esta pantalla</span><span className="block text-xs text-muted-foreground">{tutorial.titulo} · {tutorial.minutos} min</span></span>
        </button>}
        {guia && <button type="button" onClick={() => setConsejosAbiertos(true)}
          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span><span className="block font-medium">Consejos de esta pantalla</span><span className="block text-xs text-muted-foreground">{guia.tips.length} consejos rápidos</span></span>
        </button>}
        <Link to="/aprender" className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span><span className="block font-medium">Academia</span><span className="block text-xs text-muted-foreground">Lecciones paso a paso y tu avance</span></span>
        </Link>
        <Link to="/soporte" className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
          <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span><span className="block font-medium">Hablar con soporte</span><span className="block text-xs text-muted-foreground">Te responde el equipo de Nerqia</span></span>
        </Link>
      </PopoverContent>
    </Popover>
    <PageGuide open={consejosAbiertos} onOpenChange={setConsejosAbiertos} />
  </>;
}
