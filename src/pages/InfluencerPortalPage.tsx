import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Gift,
  Package,
  CheckCircle2,
  Instagram,
  Target,
  ExternalLink,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

type PortalExchange = {
  id: string;
  influencer_name: string;
  product_name: string;
  quantity: number;
  status: string;
  exchange_type: string | null;
  expected_posts: number | null;
  actual_posts: number | null;
  content_url: string | null;
  content_submitted_at: string | null;
  delivery_date: string | null;
  goal_notes: string | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  canje: "Canje",
  regalo: "Regalo",
  colaboracion: "Colaboración",
};

function looksLikeUrl(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function normalizeUrl(v: string): string {
  const s = v.trim();
  return s.startsWith("http") ? s : `https://${s}`;
}

function fmtDate(v?: string | null): string {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// ─── Card ───────────────────────────────────────────────────────────────────

function ExchangeCard({
  ex,
  token,
  onSubmitted,
}: {
  ex: PortalExchange;
  token: string;
  onSubmitted: () => void;
}) {
  const expected = Number(ex.expected_posts || 1);
  const fulfilled = !!ex.content_url || ex.status === "cumplido";
  const [url, setUrl] = useState("");
  const [posts, setPosts] = useState(String(expected));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!looksLikeUrl(url)) {
      toast.error("Ingresá una URL válida (link de tu story o reel)");
      return;
    }
    const nPosts = parseInt(posts) || expected;
    setSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("submit_influencer_content", {
        p_token: token,
        p_exchange_id: ex.id,
        p_content_url: normalizeUrl(url),
        p_actual_posts: nPosts,
      });
      if (error) throw error;
      if (data === true) {
        toast.success("¡Contenido enviado! Gracias 🎉");
        onSubmitted();
      } else {
        toast.error("No se pudo enviar. Revisá el link e intentá de nuevo.");
      }
    } catch (err: any) {
      toast.error("Error al enviar: " + (err?.message || "intentá de nuevo"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-card border border-border/60 p-5 sm:p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground leading-tight truncate">{ex.product_name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {TYPE_LABELS[ex.exchange_type || ""] || ex.exchange_type || "Canje"} · x{ex.quantity}
              {ex.delivery_date && ` · entregado ${fmtDate(ex.delivery_date)}`}
            </p>
          </div>
        </div>
        {fulfilled ? (
          <Badge variant="success" className="shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Cumplido
          </Badge>
        ) : (
          <Badge variant="warning" className="shrink-0">Pendiente</Badge>
        )}
      </div>

      {/* Goal */}
      {ex.goal_notes && (
        <div className="flex items-start gap-2 rounded-xl bg-muted/40 border border-border/40 p-3 mb-4">
          <Target className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/80 leading-relaxed">{ex.goal_notes}</p>
        </div>
      )}

      {/* Posts progress */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <span className="font-medium text-foreground/70">Publicaciones:</span>
        <span className={`font-semibold ${Number(ex.actual_posts || 0) >= expected ? "text-emerald-400" : "text-foreground"}`}>
          {Number(ex.actual_posts || 0)}
        </span>
        <span>de</span>
        <span className="font-semibold">{expected}</span>
        <span>esperadas</span>
      </div>

      {/* Submitted content OR form */}
      {fulfilled ? (
        ex.content_url ? (
          <a
            href={ex.content_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-sm font-medium hover:bg-emerald-500/15 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Ver contenido enviado
            {ex.content_submitted_at && (
              <span className="text-emerald-400/60 text-xs ml-1">· {fmtDate(ex.content_submitted_at)}</span>
            )}
          </a>
        ) : (
          <p className="text-sm text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Canje cumplido
          </p>
        )
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Link de tu contenido (story / reel / post)
            </label>
            <Input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://instagram.com/p/..."
              className="bg-muted border-border"
            />
          </div>
          <div className="flex gap-3">
            <div className="w-28">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Posts publicados</label>
              <Input
                type="number"
                min="1"
                value={posts}
                onChange={(e) => setPosts(e.target.value)}
                className="bg-muted border-border"
              />
            </div>
            <div className="flex-1 flex items-end">
              <Button
                type="submit"
                disabled={submitting}
                className="w-full gradient-gold text-primary-foreground font-semibold"
              >
                <Send className="w-4 h-4 mr-2" />
                {submitting ? "Enviando..." : "Enviar contenido"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InfluencerPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [exchanges, setExchanges] = useState<PortalExchange[]>([]);
  const [state, setState] = useState<"loading" | "empty" | "ready">("loading");

  const fetchData = useCallback(async () => {
    if (!token) {
      setState("empty");
      return;
    }
    const { data, error } = await (supabase.rpc as any)("get_influencer_portal", { p_token: token });
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      setState("empty");
      setExchanges([]);
      return;
    }
    setExchanges(data as PortalExchange[]);
    setState("ready");
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    document.title = "Portal del Influencer — Nerqia";
  }, []);

  // ── Loading ──
  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground text-xs tracking-widest uppercase">Cargando tus canjes…</p>
        </div>
      </div>
    );
  }

  // ── Empty / invalid ──
  if (state === "empty") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-5 border border-border">
            <Gift className="w-9 h-9 text-muted-foreground/50" />
          </div>
          <h1 className="text-xl font-bold mb-2">Link inválido o expirado</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Este enlace no es válido o ya no está disponible. Pedile al negocio que te comparta un nuevo link.
          </p>
        </div>
      </div>
    );
  }

  const influencerName = exchanges[0]?.influencer_name || "Influencer";
  const pending = exchanges.filter((e) => !e.content_url && e.status !== "cumplido").length;
  const done = exchanges.length - pending;

  // ── Ready ──
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-primary/12 text-primary border border-primary/25 mb-4">
            <Sparkles className="w-3 h-3" />
            Portal del influencer
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold flex items-center gap-2.5">
            <Instagram className="w-6 h-6 text-primary" />
            Hola, {influencerName}
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            Acá están tus canjes. Subí el link de tu contenido para cerrar cada colaboración.
          </p>
          <div className="flex items-center gap-4 mt-5">
            <div>
              <p className="text-2xl font-bold text-primary font-mono">{pending}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">pendientes</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400 font-mono">{done}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">cumplidos</p>
            </div>
          </div>
        </div>
      </header>

      {/* Cards */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4 pb-20">
        {exchanges.map((ex) => (
          <ExchangeCard key={ex.id} ex={ex} token={token!} onSubmitted={fetchData} />
        ))}

        <p className="text-center text-[11px] text-muted-foreground/60 pt-4">
          Nerqia · Portal seguro del influencer
        </p>
      </main>
    </div>
  );
}
