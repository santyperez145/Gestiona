import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Plus, Copy, Heart, Download, Globe, Lock, Search, Tag, ArrowUpRight } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { addMarketingPostDB } from "@/lib/supabaseStore";
import { usePageTitle } from "@/hooks/usePageTitle";

type Template = {
  id: string;
  org_id: string | null;
  title: string;
  content: string;
  post_type: string;
  industry: string | null;
  tags: string[];
  is_public: boolean;
  likes: number;
  uses_count: number;
  created_at: string;
};

const POST_TYPES = [
  { value: "post", label: "📸 Post" },
  { value: "story", label: "📱 Story" },
  { value: "reel", label: "🎬 Reel" },
  { value: "promo", label: "🏷️ Promoción" },
  { value: "anuncio", label: "📢 Anuncio" },
];

const INDUSTRIES = [
  { value: "all", label: "Todas las industrias" },
  { value: "perfumeria", label: "Perfumería" },
  { value: "vaper", label: "Vaper / E-cigarette" },
  { value: "electronico", label: "Electrónica" },
  { value: "moda", label: "Moda / Ropa" },
  { value: "general", label: "General" },
];

const EMPTY_FORM = { title: "", content: "", post_type: "post", industry: "", tags: "", is_public: false };

function TemplateForm({
  onSave,
  onClose,
  initial,
}: {
  onSave: (data: Omit<typeof EMPTY_FORM, "tags"> & { tags: string[] }) => Promise<void>;
  onClose: () => void;
  initial?: Partial<Template>;
}) {
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...initial,
    tags: (initial?.tags || []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) { toast.error("Completá título y contenido"); return; }
    setSaving(true);
    try {
      await onSave({
        ...form,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
        <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Ej: Post de oferta de fin de semana" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
          <Select value={form.post_type} onValueChange={v => set("post_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{POST_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Industria</label>
          <Select value={form.industry} onValueChange={v => set("industry", v)}>
            <SelectTrigger><SelectValue placeholder="General" /></SelectTrigger>
            <SelectContent>{INDUSTRIES.slice(1).map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Contenido *</label>
        <Textarea value={form.content} onChange={e => set("content", e.target.value)} rows={6} placeholder="Escribí el template. Podés usar {nombre_producto}, {precio}, {descuento}…" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Tags (separados por coma)</label>
        <Input value={form.tags} onChange={e => set("tags", e.target.value)} placeholder="oferta, verano, perfume" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.is_public} onChange={e => set("is_public", e.target.checked)} className="rounded" />
        <span className="text-sm">Compartir con la comunidad (público)</span>
        {form.is_public && <Globe className="w-4 h-4 text-success" />}
      </label>
      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
          {saving ? "Guardando…" : "Guardar template"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

export default function MarketingTemplatesPage() {
  usePageTitle("Plantillas de Marketing");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [myTemplates, setMyTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [tab, setTab] = useState<"marketplace" | "mine">("marketplace");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: pub }, { data: mine }] = await Promise.all([
      supabase.from("marketing_templates").select("*").eq("is_public", true).order("likes", { ascending: false }).limit(100),
      supabase.from("marketing_templates").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
    ]);
    setTemplates((pub || []) as Template[]);
    setMyTemplates((mine || []) as Template[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const handleSave = async (data: any) => {
    if (!activeOrg || !user) return;
    await supabase.from("marketing_templates").insert({ ...data, org_id: activeOrg.id, created_by: user.id });
    toast.success("Template guardado");
    await load();
  };

  const handleUse = async (tpl: Template) => {
    if (!user) return;
    await addMarketingPostDB({ user_id: user.id, title: tpl.title, content: tpl.content, post_type: tpl.post_type, status: "draft", ai_generated: false });
    await supabase.from("marketing_templates").update({ uses_count: tpl.uses_count + 1 }).eq("id", tpl.id);
    toast.success("Template copiado a tus publicaciones como borrador");
    await load();
  };

  const handleLike = async (tpl: Template) => {
    await supabase.from("marketing_templates").update({ likes: tpl.likes + 1 }).eq("id", tpl.id);
    await load();
  };

  const copyContent = (content: string) => { navigator.clipboard.writeText(content); toast.success("Contenido copiado"); };

  const displayTemplates = tab === "marketplace" ? templates : myTemplates;
  const filtered = displayTemplates.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q) || (t.tags || []).some(tag => tag.toLowerCase().includes(q));
    const matchIndustry = industryFilter === "all" || t.industry === industryFilter;
    return matchSearch && matchIndustry;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Sparkles}
        title="Marketplace de Templates"
        description="Descubrí y compartí templates de marketing con la comunidad"
        actions={
          <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />Crear template
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        <Button variant={tab === "marketplace" ? "default" : "outline"} size="sm" onClick={() => setTab("marketplace")}>
          <Globe className="w-3.5 h-3.5 mr-1.5" />Comunidad ({templates.length})
        </Button>
        <Button variant={tab === "mine" ? "default" : "outline"} size="sm" onClick={() => setTab("mine")}>
          <Lock className="w-3.5 h-3.5 mr-1.5" />Mis templates ({myTemplates.length})
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar templates…" className="pl-9 h-8 text-sm" />
        </div>
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="Industria" /></SelectTrigger>
          <SelectContent>{INDUSTRIES.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando templates…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-lg text-muted-foreground font-medium">
            {tab === "mine" ? "Todavía no tenés templates propios" : "No hay templates públicos todavía"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">¡Sé el primero en crear y compartir uno!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tpl) => (
            <div key={tpl.id} className="bg-card border border-border/60 rounded-xl p-5 shadow-card hover:border-primary/30 transition-colors flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-sm font-semibold truncate">{tpl.title}</span>
                    {tpl.is_public ? <Globe className="w-3 h-3 text-success shrink-0" /> : <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">
                      {POST_TYPES.find(t => t.value === tpl.post_type)?.label || tpl.post_type}
                    </span>
                    {tpl.industry && (
                      <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                        {INDUSTRIES.find(i => i.value === tpl.industry)?.label || tpl.industry}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-4 flex-1 mb-3 bg-muted/30 rounded-lg p-2.5">
                {tpl.content}
              </p>

              {(tpl.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {tpl.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Tag className="w-2.5 h-2.5" />{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{tpl.likes}</span>
                  <span className="flex items-center gap-1"><Download className="w-3 h-3" />{tpl.uses_count}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleLike(tpl)} title="Me gusta">
                    <Heart className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copyContent(tpl.content)} title="Copiar">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => handleUse(tpl)}>
                    <ArrowUpRight className="w-3.5 h-3.5 mr-1" />Usar
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border/60 max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Crear template</DialogTitle>
          </DialogHeader>
          <TemplateForm onSave={handleSave} onClose={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
