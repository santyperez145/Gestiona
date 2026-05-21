import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMarketingPostsDB, addMarketingPostDB, updateMarketingPostDB, deleteMarketingPostDB, getProductsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles, Instagram, Copy, Send, Megaphone, Link2, ChevronDown, ChevronUp, FileSpreadsheet, ImageIcon, Calendar, Download, RefreshCw, Loader2 } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<'posts' | 'images' | 'calendar'>('posts');

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
        description={`${posts.length} publicaciones · Contenido para tus redes`}
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
              <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-display">Generar Contenido con IA</DialogTitle></DialogHeader>
                <AIContentForm onGenerate={(type, theme) => { handleGenerateAI(type, theme); setOpen(false); }} generating={generating} postTypes={postTypes} themes={themes} />
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline"><Plus className="w-4 h-4 mr-2" />Manual</Button>
              </DialogTrigger>
              <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-display">Crear Publicación</DialogTitle></DialogHeader>
                <ManualPostForm userId={user?.id || ''} onSave={reload} postTypes={postTypes} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-muted/40 rounded-[10px] p-1 w-fit border border-border">
        {([
          { id: 'posts', label: 'Publicaciones', icon: Instagram },
          { id: 'images', label: 'Imágenes IA', icon: ImageIcon },
          { id: 'calendar', label: 'Calendario', icon: Calendar },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-card border border-border shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: PUBLICACIONES ── */}
      {activeTab === 'posts' && (
        <>
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

          <div className="mb-8 p-4 rounded-[10px] border border-border/60 bg-[hsl(228_24%_7%)]">
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
                <div key={post.id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-5 shadow-card hover:border-primary/30 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-[6px] bg-primary/10 flex items-center justify-center text-lg shrink-0">
                        {typeIcons[post.post_type] || '📸'}
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">{post.title}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`px-2 py-0.5 rounded-[5px] text-[10px] font-medium ${statusColors[post.status]}`}>
                            {statusLabels[post.status] || post.status}
                          </span>
                          {post.ai_generated && <span className="text-[10px] text-primary font-semibold flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />IA</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(post.content || '')} title="Copiar texto">
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Marcar publicado" onClick={async () => {
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
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[180px] overflow-y-auto mb-3 bg-muted/40 rounded-lg p-3 border border-border/50">
                    {post.content || 'Sin contenido'}
                  </div>
                  {post.hashtags && post.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {post.hashtags.slice(0, 8).map((h: string, i: number) => (
                        <span key={i} className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-[5px] font-medium">{h}</span>
                      ))}
                      {post.hashtags.length > 8 && <span className="text-[10px] text-muted-foreground">+{post.hashtags.length - 8}</span>}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">{new Date(post.created_at).toLocaleDateString('es-AR')}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TAB: IMÁGENES IA ── */}
      {activeTab === 'images' && <AIImageGenerator products={products} />}

      {/* ── TAB: CALENDARIO ── */}
      {activeTab === 'calendar' && <CampaignCalendar onGeneratePost={(theme) => { setActiveTab('posts'); setOpen(true); }} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI Image Generator — uses Pollinations.ai (free, no API key)
// ─────────────────────────────────────────────────────────────
const IMG_STYLES = [
  { id: 'showcase', emoji: '📸', label: 'Producto', prompt: (name: string, brand: string, cat: string) =>
    `professional product photography of ${name} by ${brand}, white studio background, soft lighting, sharp focus, 4K, luxury, commercial quality, clean minimal style` },
  { id: 'lifestyle', emoji: '🌟', label: 'Lifestyle', prompt: (name: string, brand: string, cat: string) =>
    `lifestyle photo featuring ${name} ${brand}, natural warm light, modern aesthetic, instagram influencer style, soft bokeh, authentic feel, trendy` },
  { id: 'promo', emoji: '🔥', label: 'Promoción', prompt: (name: string, brand: string, cat: string) =>
    `eye-catching promotional poster for ${name} by ${brand}, bold modern design, vibrant colors, sale offer, dynamic layout, social media marketing, high contrast` },
  { id: 'flat', emoji: '🎨', label: 'Flat Lay', prompt: (name: string, brand: string, cat: string) =>
    `flat lay photography of ${name} ${brand} product, minimalist top-down view, white or marble background, styled accessories, magazine quality, elegant composition` },
  { id: 'story', emoji: '📱', label: 'Historia', prompt: (name: string, brand: string, cat: string) =>
    `instagram story design for ${name} by ${brand}, vertical format 9:16, trendy aesthetic, glowing effects, neon accents, gen-z style, eye-catching typography` },
  { id: 'luxury', emoji: '💎', label: 'Lujo', prompt: (name: string, brand: string, cat: string) =>
    `luxury brand photography of ${name} by ${brand}, dark moody background, golden lighting, premium feel, high fashion editorial, sophisticated, velvet and gold tones` },
];

function AIImageGenerator({ products }: { products: any[] }) {
  const [selectedProductId, setSelectedProductId] = useState<string>('__none__');
  const [styleId, setStyleId] = useState('showcase');
  const [customPrompt, setCustomPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<{ url: string; label: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('gestiona.ai_images') || '[]'); } catch { return []; }
  });

  const selectedProduct = products.find(p => p.id === selectedProductId);
  const style = IMG_STYLES.find(s => s.id === styleId) || IMG_STYLES[0];

  const buildPrompt = () => {
    if (customPrompt.trim()) return customPrompt.trim();
    if (!selectedProduct) return '';
    return style.prompt(selectedProduct.name, selectedProduct.brand || '', selectedProduct.category || '');
  };

  const generate = () => {
    const prompt = buildPrompt();
    if (!prompt) { toast.error('Seleccioná un producto o escribí un prompt'); return; }
    setError(false);
    setLoading(true);
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1080&nologo=true&seed=${seed}&model=flux`;
    setImageUrl(url);
  };

  const handleLoad = () => {
    setLoading(false);
    if (imageUrl) {
      const label = selectedProduct ? `${selectedProduct.name} — ${style.label}` : 'Imagen generada';
      const newHistory = [{ url: imageUrl, label }, ...history].slice(0, 9);
      setHistory(newHistory);
      localStorage.setItem('gestiona.ai_images', JSON.stringify(newHistory));
    }
  };

  const handleError = () => { setLoading(false); setError(true); };

  const downloadImage = async (url: string) => {
    try {
      toast.info('Descargando imagen...');
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `marketing_ia_${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Error al descargar');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-[10px] p-5">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-base">Generador de Imágenes IA</h2>
          <span className="text-[10px] bg-success/20 text-success border border-success/20 px-2 py-0.5 rounded-[5px] font-semibold ml-1">GRATIS</span>
        </div>
        <p className="text-xs text-muted-foreground mb-5">Creá imágenes de marketing para tus productos en segundos con inteligencia artificial</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Controls */}
          <div className="space-y-4">
            {/* Product selector */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Producto (opcional)</label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue placeholder="Seleccioná un producto..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__none__">Sin producto específico</SelectItem>
                  {products.filter(p => p.stock > 0).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.image_url && <img src={p.image_url} className="w-4 h-4 rounded object-cover inline mr-2" />}
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Style selector */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Estilo</label>
              <div className="grid grid-cols-3 gap-2">
                {IMG_STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStyleId(s.id)}
                    className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-[6px] border text-xs font-medium transition-all ${
                      styleId === s.id
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-muted/50 border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom prompt */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                Prompt personalizado <span className="font-normal normal-case">(opcional — reemplaza el automático)</span>
              </label>
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="Ej: perfume bottle on marble surface, golden hour lighting, luxury feel..."
                rows={3}
                className="w-full text-xs bg-background border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
              />
              {selectedProduct && !customPrompt && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  ✨ Auto: "{style.prompt(selectedProduct.name, selectedProduct.brand || '', selectedProduct.category || '').slice(0, 80)}..."
                </p>
              )}
            </div>

            <Button
              onClick={generate}
              disabled={loading}
              className="w-full gradient-gold text-primary-foreground font-bold"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando imagen...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Generar imagen</>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">Powered by Pollinations.ai · Gratis y sin límites</p>
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vista previa</label>
            <div className="aspect-square rounded-[10px] overflow-hidden bg-muted/50 border border-border flex items-center justify-center relative">
              {imageUrl && !error ? (
                <>
                  {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80 backdrop-blur-sm z-10 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <p className="text-xs text-muted-foreground text-center px-4">Generando imagen con IA...<br />puede tomar 10-20 segundos</p>
                    </div>
                  )}
                  <img
                    src={imageUrl}
                    alt="Imagen generada"
                    className="w-full h-full object-cover"
                    onLoad={handleLoad}
                    onError={handleError}
                  />
                </>
              ) : error ? (
                <div className="text-center p-6">
                  <p className="text-sm text-muted-foreground mb-3">Error al generar. Intentá de nuevo.</p>
                  <Button variant="outline" size="sm" onClick={generate}><RefreshCw className="w-4 h-4 mr-2" />Reintentar</Button>
                </div>
              ) : (
                <div className="text-center p-6">
                  <ImageIcon className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-xs text-muted-foreground">Tu imagen aparecerá acá</p>
                </div>
              )}
            </div>
            {imageUrl && !loading && !error && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => downloadImage(imageUrl)}>
                  <Download className="w-4 h-4 mr-2" />Descargar
                </Button>
                <Button variant="outline" size="sm" onClick={generate}>
                  <RefreshCw className="w-4 h-4 mr-2" />Nueva variante
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image History */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Imágenes generadas</h3>
            <button onClick={() => { setHistory([]); localStorage.removeItem('gestiona.ai_images'); }} className="text-xs text-muted-foreground hover:text-destructive transition-colors">Limpiar historial</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {history.map((item, i) => (
              <div key={i} className="group relative aspect-square rounded-[10px] overflow-hidden bg-muted border border-border cursor-pointer hover:border-primary/50 transition-all"
                onClick={() => setImageUrl(item.url)}>
                <img src={item.url} alt={item.label} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <button onClick={e => { e.stopPropagation(); downloadImage(item.url); }} className="p-1.5 bg-white/20 rounded-[6px] hover:bg-white/30 transition-colors">
                    <Download className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
                <p className="absolute bottom-0 left-0 right-0 text-[8px] text-white/80 bg-black/60 px-1.5 py-1 truncate">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Campaign Calendar — Argentine marketing dates
// ─────────────────────────────────────────────────────────────
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  // month: 1-12, weekday: 0=Sun,1=Mon,...,6=Sat
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (d.getMonth() === month - 1) {
    if (d.getDay() === weekday) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return new Date(year, month - 1, 1);
}

interface CampaignDate {
  date: Date;
  name: string;
  emoji: string;
  ideas: string[];
  color: string;
}

function CampaignCalendar({ onGeneratePost }: { onGeneratePost: (theme: string) => void }) {
  const now = new Date();
  const year = now.getFullYear();

  const dates: CampaignDate[] = [
    { date: new Date(year, 0, 1), name: 'Año Nuevo', emoji: '🎉', color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10', ideas: ['Pack regalo de inicio de año', 'Oferta "Empezá el año con estilo"', 'Descuento especial primeros días de enero'] },
    { date: new Date(year, 1, 14), name: 'San Valentín', emoji: '💕', color: 'text-pink-400 border-pink-500/30 bg-pink-500/10', ideas: ['Pack perfume en pareja', 'Gift set con lazo', 'Descuento para regalos de amor', '"El mejor regalo es oler bien"'] },
    { date: new Date(year, 2, 8), name: 'Día de la Mujer', emoji: '💜', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10', ideas: ['Foco en fragancias femeninas', 'Mensaje de empoderamiento', 'Pack especial para regalar', 'Descuento en línea mujer'] },
    { date: new Date(year, 3, 2), name: 'Día de los Veteranos', emoji: '🇦🇷', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10', ideas: ['Post institucional con respeto', 'Descuento por tiempo limitado', 'Mensaje de orgullo nacional'] },
    { date: new Date(year, 4, 16), name: 'Hot Sale 🔥', emoji: '🛒', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10', ideas: ['Descuentos de hasta 40%', 'Oferta flash de 48h', 'Pack ahorro multi-producto', '"Tu mejor compra del año"'] },
    { date: new Date(year, 5, 20), name: 'Día del Padre', emoji: '👨', color: 'text-sky-400 border-sky-500/30 bg-sky-500/10', ideas: ['Perfumes masculinos en pack', 'Gift box elegante para papá', 'Fragancias orientales premium', '"El mejor regalo para papá"'] },
    { date: new Date(year, 6, 9), name: 'Día de la Independencia', emoji: '🇦🇷', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10', ideas: ['Post patriótico con descuento', 'Celebramos siendo argentinos', 'Feriado = más tiempo para oler bien'] },
    { date: new Date(year, 6, 20), name: 'Día del Amigo', emoji: '👫', color: 'text-green-400 border-green-500/30 bg-green-500/10', ideas: ['Comprá uno y regalá otro', '2x1 en decants', 'Pack duo para amigos', '"Para oler bien junto a tu mejor amigo"'] },
    { date: getNthWeekdayOfMonth(year, 10, 0, 2), name: 'Día de la Madre', emoji: '💐', color: 'text-rose-400 border-rose-500/30 bg-rose-500/10', ideas: ['Pack regalo especial mamá', 'Fragancias florales destacadas', 'Envío gratis por el día de la madre', '"El mejor perfume para la mejor mamá"'] },
    { date: new Date(year, 9, 31), name: 'Halloween', emoji: '🎃', color: 'text-orange-500 border-orange-600/30 bg-orange-600/10', ideas: ['Fragancias oscuras y misteriosas', 'Pack "terror al precio viejo"', 'Descuento especial en perfumes exóticos', '"Olfato de miedo 👻"'] },
    { date: new Date(year, 10, 3), name: 'Cyber Monday', emoji: '💻', color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10', ideas: ['Ofertas exclusivas online 24h', 'Descuento por pago digital', 'Flash sale relámpago', 'Catálogo online con precios especiales'] },
    { date: new Date(year, 11, 25), name: 'Navidad', emoji: '🎄', color: 'text-red-400 border-red-500/30 bg-red-500/10', ideas: ['Pack regalo navideño', 'Descuento especial Diciembre', 'Envío gratis para regalos', '"El regalo que nunca falla"'] },
  ].map(d => ({ ...d, date: new Date(d.date.setHours(12, 0, 0, 0)) }))
   .sort((a, b) => {
     const daysA = Math.ceil((a.date.getTime() - now.getTime()) / 86400000);
     const daysB = Math.ceil((b.date.getTime() - now.getTime()) / 86400000);
     const normA = daysA < -30 ? daysA + 365 : daysA;
     const normB = daysB < -30 ? daysB + 365 : daysB;
     return normA - normB;
   });

  const upcoming = dates.filter(d => {
    const days = Math.ceil((d.date.getTime() - now.getTime()) / 86400000);
    return days >= -7; // show events up to 7 days past
  }).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-5 h-5 text-primary" />
        <h2 className="font-bold text-base">Calendario de Marketing</h2>
        <span className="text-xs text-muted-foreground">Fechas clave para tu negocio en Argentina</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {upcoming.map((event, i) => {
          const daysLeft = Math.ceil((event.date.getTime() - now.getTime()) / 86400000);
          const isPast = daysLeft < 0;
          const isUrgent = daysLeft >= 0 && daysLeft <= 14;
          const isSoon = daysLeft > 14 && daysLeft <= 30;
          return (
            <div
              key={i}
              className={`rounded-[10px] border p-4 transition-all ${event.color} ${isPast ? 'opacity-50' : 'hover:shadow-md'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{event.emoji}</span>
                    <div>
                      <p className="font-bold text-sm">{event.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {event.date.toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}
                      </p>
                    </div>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-[5px] ${
                  isPast ? 'bg-muted text-muted-foreground' :
                  isUrgent ? 'bg-red-500/20 text-red-400 animate-pulse' :
                  isSoon ? 'bg-amber-500/20 text-amber-400' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {isPast ? `Hace ${Math.abs(daysLeft)}d` : daysLeft === 0 ? '¡Hoy!' : `${daysLeft}d`}
                </span>
              </div>

              <div className="space-y-1.5 mb-3">
                {event.ideas.map((idea, j) => (
                  <div key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span className="mt-0.5 w-1 h-1 rounded-full bg-current shrink-0" />
                    {idea}
                  </div>
                ))}
              </div>

              {!isPast && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => onGeneratePost(`${event.name} ${event.emoji}`)}
                >
                  <Sparkles className="w-3 h-3 mr-1.5" />Generar contenido para {event.name}
                </Button>
              )}
            </div>
          );
        })}
      </div>
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
    <div className="mb-6 border border-border/60 rounded-[10px] bg-[hsl(228_24%_7%)]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors rounded-[10px]"
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
