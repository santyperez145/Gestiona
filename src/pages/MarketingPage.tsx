import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { llamarIA } from "@/lib/ia";
import { getMarketingPostsDB, addMarketingPostDB, deleteMarketingPostDB, getProductsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit, TrendingUp, DollarSign, Users, Calendar, Target, BarChart3, Sparkles, Megaphone, RefreshCw, Loader2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PlannerView } from "@/components/marketing";
import { listPostTypes, listMarketingThemes } from "@/lib/marketingExtraDB";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import EmptyState from "@/components/shared/EmptyState";
import { toast } from "sonner";

export default function MarketingPage() {
  usePageTitle("Marketing");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = usePersistedState(orgViewKey("marketing.status-filter", activeOrg?.id), "all");
  const [marketingParams] = useSearchParams();
  const [postTypes, setPostTypes] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [activeTab, setActiveTab] = usePersistedState<"posts" | "planner" | "images" | "calendar" | "templates" | "combos" | "automations" | "brand" | "ofertas">(orgViewKey("marketing.tab", activeOrg?.id), "posts");

  const switchTab = (tab: typeof activeTab) => { if (tab === activeTab) return; setActiveTab(tab); };

  useEffect(() => {
    const vista = marketingParams.get("vista");
    if (vista === "posts" || vista === "planner" || vista === "images" || vista === "calendar" || vista === "templates" || vista === "combos" || vista === "automations" || vista === "brand" || vista === "ofertas") { setActiveTab(vista as any); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketingParams]);

  const reload = async () => {
    if (!user) return;
    const [p, pr] = await Promise.all([getMarketingPostsDB(user.id), getProductsDB(user.id)]);
    setPosts(p);
    setProducts(pr);
  };
  useEffect(() => { reload(); }, [user]);

  useEffect(() => {
    if (!user) return;
    listPostTypes().then(setPostTypes).catch(() => {});
    supabase.from("settings").select("industry_code").limit(1).maybeSingle().then(({ data }) => { listMarketingThemes(data?.industry_code || null).then(setThemes, () => {}); }, () => {});
  }, [user]);

  const filtered = posts.filter((p: any) => filter === "all" || p.status === filter);

  const campaigns = posts.filter((p: any) => p.type === "campaign");
  const totalCampaignBudget = posts.reduce((s: number, p: any) => s + (p.budget_ars || 0), 0);
  const activeCampaignCount = campaigns.filter((c: any) => c.status === "active").length;
  const publishedCount = posts.filter((p: any) => p.status === "published").length;
  const draftCount = posts.filter((p: any) => p.status === "draft").length;
  const totalEngagement = posts.reduce((s: number, p: any) => s + (p.engagement_rate || 0), 0);

  const handleGenerateAI = async (postType: string, theme: string) => {
    if (!user) return;
    setGenerating(true);
    try {
      const topProducts = products.filter((p: any) => p.stock > 0).slice(0, 5).map((p: any) => ({ name: p.name, brand: p.brand, category: p.category, price: p.sale_price_ars, stock: p.stock }));
      if (topProducts.length === 0) { toast.error("No hay productos con stock para generar contenido"); return; }
      const data = await llamarIA("ai-analysis", { body: { type: "marketing_copy", orgId: activeOrg?.id, data: { products: topProducts, postType, theme } } });
      const content = data?.content || "";
      if (content) {
        await addMarketingPostDB({ user_id: user.id, org_id: activeOrg?.id, title: `${theme} · ${postType}`, content, status: "draft", type: postType, theme, published_at: null, scheduled_for: null, created_at: new Date().toISOString() });
        toast.success("Contenido generado");
        reload();
      } else { toast.error("No se pudo generar el contenido"); }
    } catch (err: any) { toast.error(err.message || "Error generando contenido"); }
    finally { setGenerating(false); }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      <PageHeader icon={Megaphone} title="Marketing" description="Gestión de campañas, contenido, brief con IA y automatizaciones" actions={<div className="flex gap-2">
        <Button variant="outline" onClick={() => setOpen(true)} disabled={generating}><Sparkles className="w-4 h-4 mr-2" />{generating ? "Generando..." : "Generar IA"}</Button>
        <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />Nuevo Post</Button>
      </div>} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <KPICard label="Campañas activas" value={String(activeCampaignCount)} icon={Target} sub={`$${totalCampaignBudget.toLocaleString('es-AR')} ARS`} />
          <KPICard label="Publicados" value={String(publishedCount)} icon={TrendingUp} sub="Publicaciones activas" />
          <KPICard label="Borradores" value={String(draftCount)} icon={Calendar} sub="Pendientes" />
          <KPICard label="Engagement" value={`${totalEngagement}%`} icon={BarChart3} sub="Tasa promedio" />
        </div>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit mb-6 overflow-x-auto">
          {["posts", "planner", "images", "calendar", "templates", "combos", "automations", "brand", "ofertas"].map((t) => (
            <button key={t} onClick={() => switchTab(t as any)} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        {activeTab === "posts" && <PostsTab posts={filtered} filter={filter} setFilter={setFilter} onDelete={async (id: string) => { await deleteMarketingPostDB(id); reload(); }} />}
        {activeTab === "planner" && <PlannerView orgId={activeOrg?.id || ""} products={products} />}
        {activeTab === "images" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><Sparkles className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Generador de imágenes</h3></div>}
        {activeTab === "calendar" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><Calendar className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Calendario editorial</h3></div>}
        {activeTab === "templates" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><Sparkles className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Plantillas</h3></div>}
        {activeTab === "combos" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><RefreshCw className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Combinaciones</h3></div>}
        {activeTab === "automations" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><RefreshCw className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Automatizaciones</h3></div>}
        {activeTab === "brand" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><Sparkles className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Identidad de marca</h3></div>}
        {activeTab === "ofertas" && <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"><Sparkles className="w-12 h-12 mx-auto mb-4" /><h3 className="text-lg font-medium">Ofertas</h3></div>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="bg-card border-border/60 max-w-2xl"><DialogHeader><DialogTitle className="font-display">Nuevo Post</DialogTitle></DialogHeader><NewPostForm onSave={() => { setOpen(false); reload(); }} /></DialogContent></Dialog>
    </div>
  );
}

function PostsTab({ posts, filter, setFilter, onDelete }: { posts: any[]; filter: string; setFilter: (f: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 flex-wrap">
        <Input className="max-w-xs" placeholder="Buscar post..." />
        <Select value={filter} onValueChange={setFilter}><SelectTrigger className="max-w-[180px]"><SelectValue placeholder="Estado" /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="draft">Borrador</SelectItem><SelectItem value="published">Publicado</SelectItem></SelectContent></Select>
      </div>
      {posts.length === 0 ? <EmptyState icon={Megaphone} title="No hay posts" description="Crea tu primera publicación o genera contenido con IA" /> : (
        <div className="divide-y divide-border/60">
          {posts.map((post) => (
            <div key={post.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-medium truncate">{post.title || post.name}</span><Badge variant={post.status === "published" ? "default" : "secondary"}>{post.status}</Badge></div><div className="text-xs text-muted-foreground truncate">{post.description || post.content}</div></div>
              <div className="flex items-center gap-1"><Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button><Button variant="ghost" size="sm"><Edit className="w-4 h-4" /></Button><Button variant="ghost" size="sm" onClick={() => onDelete(post.id)}><Trash2 className="w-4 h-4" /></Button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewPostForm({ onSave }: { onSave: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', content: '', type: 'post' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-4">
      <div><Label>Nombre del post</Label><Input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} placeholder="Título del post" /></div>
      <div><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="Describe el post" /></div>
      <div><Label>Contenido</Label><Textarea value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} placeholder="Contenido del post..." className="min-h-[120px]" /></div>
      <Button type="submit" className="w-full">Guardar Post</Button>
    </form>
  );
}
