/**
 * DailyBriefingModal — AI-powered daily business morning briefing.
 *
 * On open, asks `ai-analysis` for a server-owned daily briefing. The browser
 * only sends the organization id; business data is rebuilt under RLS.
 *
 * Cached in sessionStorage so re-opening the same day is instant.
 */
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/supabaseStore";
import { Sparkles, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";
import { llamarIA } from "@/lib/ia";
interface BriefingSummary {
  salesCount: number;
  totalSalesARS: number;
  topProduct: string | null;
  lowStockCount: number;
  pendingDebtsARS: number;
  pendingDebtsCount: number;
  businessName: string;
  date: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  orgId: string;
}

const CACHE_PREFIX = "gestiona.daily_briefing.v2.";
const fechaDeBriefing = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

export default function DailyBriefingModal({ open, onClose, orgId }: Props) {
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<BriefingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const cacheKey = CACHE_PREFIX + fechaDeBriefing() + "." + orgId;

  useEffect(() => {
    if (!open) return;
    // Check cache
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { content?: string; summary?: BriefingSummary };
        if (parsed.content && parsed.summary) {
          setText(parsed.content);
          setSummary(parsed.summary);
          return;
        }
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }
    generate();
    return () => { generationRef.current += 1; };
  }, [open]);

  const generate = async () => {
    setText("");
    setSummary(null);
    setError(null);
    setLoading(true);
    const generation = ++generationRef.current;
    try {
      const data = await llamarIA<{ content?: string; summary?: BriefingSummary }>("ai-analysis", {
        body: { type: "daily_briefing", orgId },
      }, "No pudimos generar el briefing del día");
      if (generation !== generationRef.current) return;
      const content = data?.content?.trim();
      if (!content) throw new Error("El asistente respondió sin contenido. Probá de nuevo.");
      if (!data.summary) throw new Error("El briefing llegó sin sus datos de respaldo. Probá de nuevo.");
      setText(content);
      setSummary(data.summary);
      sessionStorage.setItem(cacheKey, JSON.stringify({ content, summary: data.summary }));
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(cause instanceof Error ? cause.message : "Error al generar el briefing");
      }
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(text).then(() => toast.success("Copiado al portapapeles"));
  };

  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { generationRef.current += 1; onClose(); } }}>
      <DialogContent className="bg-card border-border/60 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="w-5 h-5 text-primary" />
            Briefing del día
            <span className="text-xs font-normal text-muted-foreground capitalize ml-1">{today}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-[120px] relative">
          {loading && !text && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Analizando tu negocio...</span>
            </div>
          )}

          {error && (
            <div className="py-4 text-center">
              <p className="text-sm text-destructive mb-3">{error}</p>
              <Button size="sm" variant="outline" onClick={generate}>Reintentar</Button>
            </div>
          )}

          {text && (
            <div className="space-y-3">
              <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {text}
                {loading && <span className="inline-block w-1 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />}
              </div>
            </div>
          )}
        </div>

        {/* Stats summary */}
        {summary && <div className="grid grid-cols-2 gap-2 border-t border-border/40 py-2 sm:grid-cols-4">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Ventas ayer</p>
            <p className="text-sm font-bold font-mono">{formatARS(summary.totalSalesARS)}</p>
            <p className="text-[10px] text-muted-foreground">{summary.salesCount} operaciones</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Bajo stock</p>
            <p className={`text-sm font-bold font-mono ${summary.lowStockCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {summary.lowStockCount}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Deudas</p>
            <p className={`text-sm font-bold font-mono ${summary.pendingDebtsCount > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
              {formatARS(summary.pendingDebtsARS)}
            </p>
            <p className="text-[10px] text-muted-foreground">{summary.pendingDebtsCount} pendientes</p>
          </div>
          <div className="min-w-0 text-center">
            <p className="text-[10px] text-muted-foreground">Producto destacado</p>
            <p className="truncate text-sm font-bold" title={summary.topProduct ?? undefined}>
              {summary.topProduct ?? "Sin ventas"}
            </p>
          </div>
        </div>}

        {text && !loading && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
              <Copy className="w-3.5 h-3.5" />Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { sessionStorage.removeItem(cacheKey); generate(); }} className="gap-1.5 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" />Regenerar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
