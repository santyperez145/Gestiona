import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'hsl(228 28% 4.5%)' }}>
      {/* dot grid */}
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, hsl(38 82% 52% / 0.04) 0%, transparent 70%)' }} />

      <div className="relative z-10 text-center max-w-sm">
        <div className="font-mono text-[6rem] font-bold leading-none text-foreground/8 select-none mb-2">
          404
        </div>
        <div className="w-8 h-[2px] rounded-full bg-primary/50 mx-auto mb-5" />

        <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-2">
          Página no encontrada
        </p>
        <h1 className="font-display text-[1.4rem] font-bold tracking-tight mb-3">
          Ruta inexistente
        </h1>
        <p className="text-[12px] text-muted-foreground/55 mb-8 leading-relaxed font-mono">
          {location.pathname}
        </p>

        <Button asChild>
          <Link to="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al inicio
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
