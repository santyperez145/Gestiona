import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMarketingPostsDB, addMarketingPostDB, updateMarketingPostDB, deleteMarketingPostDB, getProductsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles, Instagram, Copy, Send, Megaphone, Link2, ChevronDown, ChevronUp, FileSpreadsheet } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { InstagramStoryGenerator } from "@/components/marketing/InstagramStoryGenerator";
import OfferRecommenderPanel from "@/components/marketing/OfferRecommenderPanel";
import { listPostTypes, listMarketingThemes } from "@/lib/marketingExtraDB";

export default function MarketingPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [postTypes, setPostTypes] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [industryCode, setIndustryCode] = useState<string | null>(null);

  const reload = async () => {
    if (!user) return;
    const [p, pr] = await Promise.all([getMarketingPostsDB(user.id), getProductsDB(user.id)]);
    setPosts(p);
    setProducts(pr);
  };
  useEffect(() => {
    reload();
    if (!user) return;
    listPostTypes().then(setPostTypes).catch(() => {});
    supabase.from('settings').select('industry_code').limit(1).maybeSingle().then(({ data }) => {
      const code = data?.industry_code || null;
      setIndustryCode(code);
      listMarketingThemes(code).then(setThemes).catch(() => {});
    }).catch(() => {});
  }, [user]);

  const filtered = posts.filter(p => filter === 'all' || p.status === filter);

  const handleGenerateAI = async (postType: string, theme: string) => {
    if (!user) return;
    setGenerating(true);
    try {
      const topProducts = products.filter(p => p.stock > 0).slice(0, 5).map(p => ({
        name: p.name, brand: p.brand, category: p.category, price: p.sale_price_ars, stock: p.stock
      }));
      if (topProducts.length === 0) {
        toast.error("No hay productos con stock para generar contenido");
        setGenerating(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: { type: 'marketing_copy', data: { products: topProducts, postType, theme, industry: industryCode } }
      });
      if (error) throw error;
      const content = data?.content || '';
      if (!content) {
        toast.error("La IA no devolvió contenido. Probá de nuevo.");
        setGenerating(false);
        return;
      }
      const hashtagMatch = content.match(/#[\w\u00C0-\u024F]+/g);
      const hashtags = hashtagMatch ? hashtagMatch.slice(0, 30) : [];

      const ptLabel = postTypes.find(t => t.code === postType)?.label || postType;
      await addMarketingPostDB({
        user_id: user.id,
        title: `${ptLabel} — ${theme}`,
        content,
        post_type: postType,
        hashtags,
        status: 'draft',
        ai_generated: true,
      });
      toast.success("¡Contenido generado con IA!");
      reload();
    } catch (err: any) {
      toast.error(err.message || "Error generando contenido");
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    scheduled: 'bg-warning/20 text-warning',
    published: 'bg-success/20 text-success',
  };
  const statusLabels: Record<string, string> = { draft: 'Borrador', scheduled: 'Programado', published: 'Publicado' };
  const typeIcons: Record<string, string> = postTypes.reduce((acc: any, t: any) => ({ ...acc, [t.code]: t.emoji || '📸' }), { post: '📸', story: '📱', reel: '🎬', carousel: '🖼️' });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Instagram}
        title="Marketing"
        description={`${posts.length} publicaciones · Contenido para Instagram`}
        badge={
          posts.filter(p => p.status === "scheduled").length > 0
            ? { label: `${posts.filter(p => p.status === "scheduled").length} programados`, variant: "success" }
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <InstagramStoryGenerator />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                  <Sparkles className="w-4 h-4 mr-2" />Generar con IA
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-display">Generar Contenido con IA</DialogTitle></DialogHeader>
                <AIContentForm onGenerate={(type, theme) => { handleGenerateAI(type, theme); setOpen(false); }} generating={generating} postTypes={postTypes} themes={themes} />
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline"><Plus className="w-4 h-4 mr-2" />Manual</Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-display">Crear Publicación</DialogTitle></DialogHeader>
                <ManualPostForm userId={user?.id || ''} onSave={reload} postTypes={postTypes} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 bg-muted/40 rounded-lg p-1 w-fit">
          {['all', 'draft', 'scheduled', 'published'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                filter === s
                  ? "bg-card border border-border shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === 'all' ? 'Todos' : statusLabels[s]}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} publicaciones</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => {
          const header = "Título,Tipo,Estado,Generado con IA,Hashtags,Fecha\n";
          const rows = filtered.map(p => [
            p.title, p.post_type || '', statusLabels[p.status] || p.status,
            p.ai_generated ? 'Sí' : 'No',
            (p.hashtags || []).join(' '),
            p.created_at ? p.created_at.slice(0, 10) : '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = "publicaciones_marketing.csv"; a.click();
          URL.revokeObjectURL(url);
        }}>
          <FileSpreadsheet className="w-4 h-4 mr-2" />CSV
        </Button>
      </div>

      <div className="mb-8 p-4 rounded-xl border border-border bg-card/50">
        <OfferRecommenderPanel />
      </div>

      <UTMLinkBuilder />

      {!filtered.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg">No hay publicaciones</p>
          <p className="text-sm">Generá contenido con IA para tu Instagram</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(post => (
            <div key={post.id} className="bg-card border border-border rounded-lg p-5 shadow-card hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{typeIcons[post.post_type] || '📸'}</span>
                  <div>
                    <h3 className="font-medium text-sm">{post.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[post.status]}`}>
                        {statusLabels[post.status] || post.status}
                      </span>
                      {post.ai_generated && <span className="text-xs text-primary">✨ IA</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(post.content || '')}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    await updateMarketingPostDB(post.id, { status: 'published' });
                    reload();
                    toast.success("Marcado como publicado");
                  }}>
                    <Send className="w-3.5 h-3.5 text-success" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    await deleteMarketingPostDB(post.id);
                    reload();
                    toast.success("Eliminado");
                  }}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto mb-3 bg-muted/50 rounded p-3">
                {post.content || 'Sin contenido'}
              </div>
              {post.hashtags && post.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {post.hashtags.slice(0, 10).map((h: string, i: number) => (
                    <span key={i} className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{h}</span>
                  ))}
                  {post.hashtags.length > 10 && <span className="text-xs text-muted-foreground">+{post.hashtags.length - 10}</span>}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">{new Date(post.created_at).toLocaleDateString('es-AR')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UTM Link Builder
// ─────────────────────────────────────────────────────────────
const UTM_SOURCES = ['instagram', 'facebook', 'whatsapp', 'email', 'tiktok', 'otro'];
const UTM_MEDIUMS = ['social', 'story', 'bio', 'post', 'email', 'dm', 'otro'];

function UTMLinkBuilder() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('instagram');
  const [medium, setMedium] = useState('social');
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');
  const [generated, setGenerated] = useState('');

  const build = () => {
    if (!url.trim()) { toast.error("Ingresá la URL base"); return; }
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      u.searchParams.set('utm_source', source);
      u.searchParams.set('utm_medium', medium);
      if (campaign.trim()) u.searchParams.set('utm_campaign', campaign.trim().replace(/\s+/g, '_').toLowerCase());
      if (content.trim()) u.searchParams.set('utm_content', content.trim().replace(/\s+/g, '_').toLowerCase());
      setGenerated(u.toString());
    } catch {
      toast.error("URL inválida");
    }
  };

  const copy = () => { navigator.clipboard.writeText(generated); toast.success("Link UTM copiado"); };

  return (
    <div className="mb-6 border border-border rounded-xl bg-card/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Generador de Links UTM</span>
          <span className="text-[10px] text-muted-foreground font-normal">Para rastrear tus campañas</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">URL base</label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://tutienda.mitiendanube.com" className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre de campaña</label>
              <Input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="promo_mayo" className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fuente (utm_source)</label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{UTM_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Medio (utm_medium)</label>
              <Select value={medium} onValueChange={setMedium}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{UTM_MEDIUMS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Contenido (opcional — para A/B)</label>
              <Input value={content} onChange={e => setContent(e.target.value)} placeholder="banner_rojo" className="text-sm" />
            </div>
          </div>
          <Button onClick={build} size="sm" className="gradient-gold text-primary-foreground font-semibold"><Link2 className="w-3.5 h-3.5 mr-1.5" />Generar Link</Button>
          {generated && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-start gap-2">
              <p className="text-xs font-mono break-all flex-1 text-success">{generated}</p>
              <Button variant="ghost" size="sm" onClick={copy} className="shrink-0"><Copy className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AIContentForm({ onGenerate, generating, postTypes, themes }: { onGenerate: (type: string, theme: string) => void; generating: boolean; postTypes: any[]; themes: any[] }) {
  const [postType, setPostType] = useState('post');
  const [theme, setTheme] = useState('');

  useEffect(() => {
    if (postTypes.length && !postTypes.find(t => t.code === postType)) setPostType(postTypes[0].code);
  }, [postTypes]);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Tipo de publicación</label>
        <Select value={postType} onValueChange={setPostType}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {postTypes.map(t => <SelectItem key={t.code} value={t.code}>{t.emoji} {t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Tema o enfoque</label>
        <Input value={theme} onChange={e => setTheme(e.target.value)} placeholder="Escribí tu propio tema o elegí uno" className="bg-muted border-border" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {themes.map((t: any) => (
            <button type="button" key={t.id} onClick={() => setTheme(t.label)} className="text-xs bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary px-2 py-1 rounded transition-colors">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <Button onClick={() => onGenerate(postType, theme || 'promoción general')} disabled={generating} className="w-full gradient-gold text-primary-foreground font-semibold">
        {generating ? (
          <><div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />Generando...</>
        ) : (
          <><Sparkles className="w-4 h-4 mr-2" />Generar Contenido</>
        )}
      </Button>
    </div>
  );
}

function ManualPostForm({ userId, onSave, postTypes }: { userId: string; onSave: () => void; postTypes: any[] }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [postType, setPostType] = useState('post');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Agregá un título"); return; }
    await addMarketingPostDB({
      user_id: userId,
      title: title.trim(),
      content,
      post_type: postType,
      status: 'draft',
      ai_generated: false,
    });
    toast.success("Publicación creada");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Título</label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Nombre de la publicación" className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Tipo</label>
        <Select value={postType} onValueChange={setPostType}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {postTypes.length === 0
              ? <SelectItem value="post">📸 Post</SelectItem>
              : postTypes.map(t => <SelectItem key={t.code} value={t.code}>{t.emoji} {t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Contenido</label>
        <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Texto del post..." rows={6} className="bg-muted border-border" />
      </div>
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Crear Publicación</Button>
    </form>
  );
}
