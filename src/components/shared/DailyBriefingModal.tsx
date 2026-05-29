/**
 * DailyBriefingModal — AI-powered daily business morning briefing.
 *
 * On open, sends today's stats (sales, stock alerts, debts, top product)
 * to the ai-chat edge function and streams back a narrative business summary.
 *
 * Uses SSE streaming so text appears word-by-word like a ChatGPT response.
 * Cached in sessionStorage so re-opening the same day is instant.
 */
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Sparkles, RefreshCw, Copy, X } from "lucide-react";
import { toast } from "sonner";

interface BriefingData {
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
  briefingData: BriefingData;
  userId: string;
}

function buildPrompt(d: BriefingData): string {
  return `Sos el asistente de negocio de ${d.businessName}. Es ${d.date}.
Generá un briefing matutino breve y motivador (máx 5 oraciones) basado en estos datos de ayer:
- Ventas: ${d.salesCount} transacciones por ${formatARS(d.totalSalesARS)}
- Producto más vendido: ${d.topProduct ?? "sin datos"}
- Productos con bajo stock: ${d.lowStockCount}
- Deudas pendientes: ${d.pendingDebtsCount} clientes, ${formatARS(d.pendingDebtsARS)} total

Incluí: saludo, análisis rápido del día anterior, alerta si hay bajo stock o deudas importantes, y un consejo accionable para el día de hoy. Respondé en español, tono profesional pero cercano.`;
}

const CACHE_PREFIX = "gestiona.daily_briefing.";

export default function DailyBriefingModal({ open, onClose, briefingData, userId }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheKey = CACHE_PREFIX + briefingData.date + "." + userId;

  useEffect(() => {
    if (!open) return;
    // Check cache
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { setText(cached); return; }
    generate();
    return () => { abortRef.current?.abort(); };
  }, [open]);

  const generate = async () => {
    setText("");
    setError(null);
    setLoading(true);
    abortRef.current = new AbortController();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const prompt = buildPrompt(briefingData);
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], stream: true }),
          signal: abortRef.current.signal,
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            accumulated += delta;
            setText(accumulated);
          } catch {}
        }
      }
      if (accumulated) sessionStorage.setItem(cacheKey, accumulated);
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? "Error al generar el briefing");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(text).then(() => toast.success("Copiado al portapapeles"));
  };

  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { abortRef.current?.abort(); onClose(); } }}>
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
        <div className="grid grid-cols-3 gap-2 py-2 border-t border-border/40">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Ventas ayer</p>
            <p className="text-sm font-bold font-mono">{briefingData.salesCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Bajo stock</p>
            <p className={`text-sm font-bold font-mono ${briefingData.lowStockCount > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
              {briefingData.lowStockCount}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Deudas</p>
            <p className={`text-sm font-bold font-mono ${briefingData.pendingDebtsCount > 0 ? "text-destructive" : "text-emerald-400"}`}>
              {briefingData.pendingDebtsCount}
            </p>
          </div>
        </div>

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
