/**
 * KnowledgeBasePage — Internal Knowledge Base / Help Center
 *
 * Salesforce Knowledge equivalent.
 * Organize help articles by category. Agents can link articles to tickets.
 * Articles support markdown-style content with rich text preview.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  BookOpen, Plus, X, Loader2, Trash2, Edit2, Search, Eye, EyeOff,
  Tag, Clock, ChevronDown, ChevronUp, Star, Globe, Lock,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface KBArticle {
  id: string;
  org_id: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  tags: string[] | null;
  visibility: "internal" | "public";
  published: boolean;
  view_count: number;
  helpful_count: number;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const KB_CATEGORIES = [
  "General", "Primeros pasos", "Facturación", "Pagos", "Devoluciones",
  "Cuenta y configuración", "Técnico", "Integraciones", "FAQ",
];

function slugify(str: string): string {
  return str.toLowerCase().trim()
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const EMPTY_FORM = {
  title: "", category: "General", content: "", tags_raw: "",
  visibility: "internal" as "internal" | "public", published: false,
};

// Simple markdown-ish renderer
function renderContent(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code class="bg-muted px-1 rounded text-[11px] font-mono">$1</code>')
    .replace(/^#{3}\s(.+)$/gm, '<h3 class="font-bold text-sm mt-3 mb-1">$1</h3>')
    .replace(/^#{2}\s(.+)$/gm, '<h2 class="font-bold text-base mt-4 mb-2">$1</h2>')
    .replace(/^#{1}\s(.+)$/gm, '<h1 class="font-bold text-lg mt-4 mb-2">$1</h1>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/\n/g, "<br>");
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function KnowledgeBasePage() {
  usePageTitle("Base de Conocimiento");

  const { activeOrg, activeRole } = useOrg();
  const [articles, setArticles]   = useState<KBArticle[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<KBArticle | null>(null);
  const [saving, setSaving]       = useState(false);
  const [search, setSearch]       = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [preview, setPreview]     = useState(false);
  const [form, setForm]           = useState({ ...EMPTY_FORM });

  const canManage = activeRole === "owner" || activeRole === "admin";

  const loadArticles = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("kb_articles")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("category")
        .order("title");
      if (error) throw error;
      setArticles((data || []) as KBArticle[]);
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim() || !activeOrg?.id) return;
    setSaving(true);
    try {
      const slug = slugify(form.title);
      const tags = form.tags_raw.split(",").map(s => s.trim()).filter(Boolean);
      const payload = {
        title: form.title.trim(),
        slug,
        category: form.category,
        content: form.content.trim(),
        tags: tags.length ? tags : null,
        visibility: form.visibility,
        published: form.published,
      };
      if (editing) {
        await supabase.from("kb_articles").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editing.id);
        toast.success("Artículo actualizado");
      } else {
        await supabase.from("kb_articles").insert({ ...payload, org_id: activeOrg.id, view_count: 0, helpful_count: 0 });
        toast.success("Artículo creado");
      }
      setShowForm(false); setEditing(null); setForm({ ...EMPTY_FORM }); setPreview(false);
      loadArticles();
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este artículo?")) return;
    try {
      await supabase.from("kb_articles").delete().eq("id", id);
      setArticles(prev => prev.filter(a => a.id !== id));
      toast.success("Artículo eliminado");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  const togglePublish = async (article: KBArticle) => {
    try {
      await supabase.from("kb_articles").update({ published: !article.published }).eq("id", article.id);
      setArticles(prev => prev.map(a => a.id === article.id ? { ...a, published: !a.published } : a));
      toast.success(article.published ? "Despublicado" : "Publicado");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  const markHelpful = async (id: string) => {
    await supabase.rpc("increment_kb_helpful", { article_id: id }).catch(() => {});
    setArticles(prev => prev.map(a => a.id === id ? { ...a, helpful_count: a.helpful_count + 1 } : a));
  };

  // Stats
  const stats = {
    total: articles.length,
    published: articles.filter(a => a.published).length,
    public: articles.filter(a => a.visibility === "public" && a.published).length,
    helpful: articles.reduce((s, a) => s + a.helpful_count, 0),
  };

  // Filtered & grouped
  const q = search.toLowerCase();
  const filtered = useMemo(() => articles.filter(a => {
    if (filterCat !== "all" && a.category !== filterCat) return false;
    if (q && !a.title.toLowerCase().includes(q) && !a.content.toLowerCase().includes(q)) return false;
    return true;
  }), [articles, filterCat, q]);

  const categories = useMemo(() => [...new Set(articles.map(a => a.category))].sort(), [articles]);

  const grouped: Record<string, KBArticle[]> = useMemo(() => {
    const g: Record<string, KBArticle[]> = {};
    filtered.forEach(a => {
      if (!g[a.category]) g[a.category] = [];
      g[a.category].push(a);
    });
    return g;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Base de Conocimiento"
        description="Artículos de ayuda para el equipo y los clientes"
        badge={stats.published > 0 ? { label: `${stats.published} publicado${stats.published !== 1 ? "s" : ""}`, variant: "success" } : undefined}
        actions={
          canManage ? (
            <Button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ ...EMPTY_FORM }); setPreview(false); }} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nuevo artículo
            </Button>
          ) : undefined
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Artículos" value={stats.total} icon={BookOpen} />
        <KPICard label="Publicados" value={stats.published} icon={Eye} color="success" />
        <KPICard label="Públicos" value={stats.public} icon={Globe} color="blue" />
        <KPICard label="Útiles (👍)" value={stats.helpful} icon={Star} color="warning" />
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              {editing ? "Editar artículo" : "Nuevo artículo"}
            </h3>
            <div className="flex items-center gap-2">
              <button
                className={`text-xs px-2 py-1 rounded transition-colors ${preview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setPreview(!preview)}
              >
                {preview ? <><EyeOff className="w-3 h-3 inline mr-1" />Editar</> : <><Eye className="w-3 h-3 inline mr-1" />Vista previa</>}
              </button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setShowForm(false); setEditing(null); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {preview ? (
            <div className="prose prose-sm max-w-none rounded-lg border border-border p-4 bg-background min-h-[200px]">
              <h1 className="text-lg font-bold mb-1">{form.title || "Sin título"}</h1>
              <div className="text-xs text-muted-foreground mb-4">{form.category}</div>
              <div
                className="text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: `<p class="mb-2">${renderContent(form.content)}</p>` }}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label className="text-xs text-muted-foreground mb-1 block">Título *</Label>
                <Input placeholder="Ej: ¿Cómo solicitar una devolución?" value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Categoría</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KB_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Visibilidad</Label>
                <Select value={form.visibility} onValueChange={v => setForm(p => ({ ...p, visibility: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">🔒 Solo equipo interno</SelectItem>
                    <SelectItem value="public">🌐 Público (help center)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Contenido * <span className="font-normal opacity-60">(soporta **negrita**, *itálica*, `código`, ## títulos, - listas)</span>
                </Label>
                <textarea
                  className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Escribí el contenido del artículo..."
                  value={form.content}
                  onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Tags (separados por coma)</Label>
                <Input placeholder="facturación, pago, reembolso" value={form.tags_raw}
                  onChange={e => setForm(p => ({ ...p, tags_raw: e.target.value }))} />
              </div>
              <div className="flex items-center gap-3 pt-4">
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                  <input type="checkbox" checked={form.published}
                    onChange={e => setForm(p => ({ ...p, published: e.target.checked }))} />
                  Publicar ahora
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim() || !form.content.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {editing ? "Guardar cambios" : "Crear artículo"}
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input className="pl-9 h-8 text-sm" placeholder="Buscar artículos..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterCat("all")}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${filterCat === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            Todos ({articles.length})
          </button>
          {categories.map(cat => (
            <button key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${filterCat === cat ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {cat} ({articles.filter(a => a.category === cat).length})
            </button>
          ))}
        </div>
      </div>

      {/* Article list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{articles.length === 0 ? "Sin artículos. Creá el primero." : "Sin resultados."}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([cat, catArticles]) => (
            <div key={cat}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{cat} ({catArticles.length})</p>
              <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {catArticles.map(article => {
                  const isOpen = expanded === article.id;
                  return (
                    <div key={article.id}>
                      <div className="flex items-start gap-3 px-4 py-3">
                        <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${article.published ? "bg-green-400" : "bg-muted-foreground/40"}`} />
                        <button className="flex-1 text-left min-w-0" onClick={() => setExpanded(isOpen ? null : article.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{article.title}</span>
                            {!article.published && <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5">Borrador</span>}
                            {article.visibility === "public"
                              ? <Globe className="w-3 h-3 text-blue-400" title="Público" />
                              : <Lock className="w-3 h-3 text-muted-foreground/60" title="Solo equipo" />
                            }
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                            <span><Eye className="w-2.5 h-2.5 inline mr-0.5" />{article.view_count} vistas</span>
                            <span><Star className="w-2.5 h-2.5 inline mr-0.5 text-yellow-400" />{article.helpful_count} útil</span>
                            {article.tags?.slice(0, 3).map(t => (
                              <span key={t} className="bg-muted rounded px-1.5 py-0.5">{t}</span>
                            ))}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {canManage && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 text-xs"
                                onClick={() => togglePublish(article)}>
                                {article.published ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7"
                                onClick={() => { setEditing(article); setForm({ title: article.title, category: article.category, content: article.content, tags_raw: (article.tags || []).join(", "), visibility: article.visibility, published: article.published }); setShowForm(true); setPreview(false); }}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                                onClick={() => handleDelete(article.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setExpanded(isOpen ? null : article.id)}>
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t border-border bg-muted/10 px-5 py-4">
                          <div
                            className="text-sm leading-relaxed text-foreground"
                            dangerouslySetInnerHTML={{ __html: `<p class="mb-2">${renderContent(article.content)}</p>` }}
                          />
                          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
                            <button
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-green-400 transition-colors"
                              onClick={() => markHelpful(article.id)}
                            >
                              <Star className="w-3.5 h-3.5" />¿Te resultó útil? ({article.helpful_count})
                            </button>
                            <span className="text-[10px] text-muted-foreground/60 ml-auto">
                              Actualizado: {new Date(article.updated_at).toLocaleDateString("es-AR")}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
