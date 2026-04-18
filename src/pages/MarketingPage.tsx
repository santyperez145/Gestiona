import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getMarketingPostsDB, addMarketingPostDB, updateMarketingPostDB, deleteMarketingPostDB, getProductsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles, Instagram, Copy, Calendar, Image, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function MarketingPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState('all');

  const reload = async () => {
    if (!user) return;
    const [p, pr] = await Promise.all([getMarketingPostsDB(user.id), getProductsDB(user.id)]);
    setPosts(p);
    setProducts(pr);
  };
  useEffect(() => { reload(); }, [user]);

  const filtered = posts.filter(p => filter === 'all' || p.status === filter);

  const handleGenerateAI = async (postType: string, theme: string) => {
    if (!user) return;
    setGenerating(true);
    try {
      const topProducts = products.filter(p => p.stock > 0).slice(0, 5).map(p => ({
        name: p.name, brand: p.brand, category: p.category, price: p.sale_price_ars, stock: p.stock
      }));

      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: { type: 'marketing_copy', data: { products: topProducts, postType, theme } }
      });
      if (error) throw error;

      const content = data.content || '';
      const hashtagMatch = content.match(/#[\w\u00C0-\u024F]+/g);
      const hashtags = hashtagMatch ? hashtagMatch.slice(0, 30) : [];

      await addMarketingPostDB({
        user_id: user.id,
        title: `${postType === 'story' ? 'Historia' : postType === 'reel' ? 'Reel' : 'Post'} - ${theme}`,
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
  const typeIcons: Record<string, string> = { post: '📸', story: '📱', reel: '🎬' };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Instagram className="w-7 h-7 text-primary" /> Marketing
          </h1>
          <p className="text-muted-foreground text-sm">{posts.length} publicaciones · Contenido para Instagram</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                <Sparkles className="w-4 h-4 mr-2" />Generar con IA
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">Generar Contenido con IA</DialogTitle></DialogHeader>
              <AIContentForm onGenerate={(type, theme) => { handleGenerateAI(type, theme); setOpen(false); }} generating={generating} />
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline"><Plus className="w-4 h-4 mr-2" />Manual</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">Crear Publicación</DialogTitle></DialogHeader>
              <ManualPostForm userId={user?.id || ''} onSave={reload} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {['all', 'draft', 'scheduled', 'published'].map(s => (
          <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" onClick={() => setFilter(s)}>
            {s === 'all' ? 'Todos' : statusLabels[s]}
          </Button>
        ))}
      </div>

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

function AIContentForm({ onGenerate, generating }: { onGenerate: (type: string, theme: string) => void; generating: boolean }) {
  const [postType, setPostType] = useState('post');
  const [theme, setTheme] = useState('');

  const themes = [
    'Promoción de perfumes árabes',
    'Nuevos ingresos de vapers',
    'Descuentos especiales',
    'Fragancias para regalar',
    'Comparativa de perfumes',
    'Tips de fragancias',
    'Perfume del día',
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Tipo de publicación</label>
        <Select value={postType} onValueChange={setPostType}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="post">📸 Post de Feed</SelectItem>
            <SelectItem value="story">📱 Historia</SelectItem>
            <SelectItem value="reel">🎬 Reel</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Tema o enfoque</label>
        <Input value={theme} onChange={e => setTheme(e.target.value)} placeholder="Ej: Promoción de perfumes árabes" className="bg-muted border-border" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {themes.map(t => (
            <button key={t} onClick={() => setTheme(t)} className="text-xs bg-muted hover:bg-primary/20 text-muted-foreground hover:text-primary px-2 py-1 rounded transition-colors">
              {t}
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

function ManualPostForm({ userId, onSave }: { userId: string; onSave: () => void }) {
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
            <SelectItem value="post">📸 Post</SelectItem>
            <SelectItem value="story">📱 Historia</SelectItem>
            <SelectItem value="reel">🎬 Reel</SelectItem>
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

function Megaphone(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>;
}
