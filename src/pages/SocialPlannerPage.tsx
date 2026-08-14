import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Share2, Plus, Pencil, Trash2, Copy, Lightbulb, Hash, Calendar,
  Eye, Heart, MessageCircle, Repeat2, MousePointerClick, CheckCircle2, Clock,
  Send, XCircle, FileEdit, Loader2, Sparkles,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

interface SocialPost {
  id: string;
  title: string;
  content: string;
  media_urls: string[];
  platforms: string[];
  hashtags: string[];
  status: "draft" | "scheduled" | "published" | "cancelled";
  scheduled_for: string | null;
  published_at: string | null;
  post_type: string;
  campaign_name: string | null;
  target_audience: string | null;
  cta_text: string | null;
  cta_url: string | null;
  notes: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  created_at: string;
}

interface HashtagSet {
  id: string;
  name: string;
  hashtags: string[];
  platform: string;
}

interface ContentIdea {
  id: string;
  idea: string;
  category: string;
  priority: number;
  converted_to_post: boolean;
  created_at: string;
}

const PLATFORMS = [
  { value: "instagram", label: "Instagram", emoji: "📸" },
  { value: "facebook", label: "Facebook", emoji: "👥" },
  { value: "tiktok", label: "TikTok", emoji: "🎵" },
  { value: "twitter", label: "Twitter/X", emoji: "🐦" },
  { value: "linkedin", label: "LinkedIn", emoji: "💼" },
  { value: "whatsapp_status", label: "WhatsApp Status", emoji: "💬" },
];

const POST_TYPES = [
  { value: "post", label: "Post" },
  { value: "story", label: "Story" },
  { value: "reel", label: "Reel" },
  { value: "carousel", label: "Carousel" },
  { value: "thread", label: "Thread" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:     { label: "Borrador",   color: "bg-muted/50 text-muted-foreground",   icon: FileEdit },
  scheduled: { label: "Programado", color: "bg-blue-500/15 text-blue-400",         icon: Clock },
  published: { label: "Publicado",  color: "bg-emerald-500/15 text-emerald-400",   icon: CheckCircle2 },
  cancelled: { label: "Cancelado",  color: "bg-destructive/15 text-destructive",   icon: XCircle },
};

const IDEA_CATEGORIES = ["producto", "educativo", "entretenimiento", "promocion", "detras_de_escena", "testimonio", "otros"];

const PLATFORM_EMOJI: Record<string, string> = Object.fromEntries(PLATFORMS.map(p => [p.value, p.emoji]));

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

const EMPTY_POST = {
  title: "", content: "", platforms: ["instagram"] as string[], hashtags: [] as string[],
  // Tipado como la unión completa (no `as const`): el form cambia de estado
  // y también se carga desde un post existente.
  status: "draft" as "draft" | "scheduled" | "published" | "cancelled",
  scheduled_for: "", post_type: "post",
  campaign_name: "", target_audience: "", cta_text: "", cta_url: "", notes: "",
};

export default function SocialPlannerPage() {
  usePageTitle("Planner de Redes Sociales");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = usePersistedState(
    orgViewKey("social-planner.tab", orgId),
    "posts",
  );

  // Dialogs
  const [postOpen, setPostOpen] = useState(false);
  const [hashtagOpen, setHashtagOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);

  // Forms
  const [postForm, setPostForm] = useState(EMPTY_POST);
  const [hashtagInput, setHashtagInput] = useState("");
  const [postHashtagInput, setPostHashtagInput] = useState("");
  const [htForm, setHtForm] = useState({ name: "", hashtags: [] as string[], platform: "instagram", tagInput: "" });
  const [ideaForm, setIdeaForm] = useState({ idea: "", category: "producto", priority: "0" });

  // Status filter
  const [statusFilter, setStatusFilter] = useState("all");
  // Generador de copy con IA
  const [products, setProducts] = useState<{ id: string; name: string; brand: string; category: string }[]>([]);
  const [aiProductId, setAiProductId] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [postsRes, htRes, ideasRes, prodRes] = await Promise.all([
      supabase.from("social_posts").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("hashtag_sets").select("*").eq("org_id", orgId).order("name"),
      supabase.from("content_ideas").select("*").eq("org_id", orgId).order("priority", { ascending: false }),
      supabase.from("products").select("id, name, brand, category").eq("org_id", orgId).order("name"),
    ]);
    setPosts((postsRes.data || []) as SocialPost[]);
    setHashtagSets((htRes.data || []) as HashtagSet[]);
    setIdeas((ideasRes.data || []) as ContentIdea[]);
    setProducts((prodRes.data || []) as any[]);
    setLoading(false);
  }

  async function generateCopy() {
    const prod = products.find(p => p.id === aiProductId);
    if (!prod && !postForm.title.trim()) {
      toast.error("Elegí un producto o escribí un título/tema"); return;
    }
    setAiGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-copy", {
        body: {
          productName: prod?.name || postForm.title.trim(),
          brand: prod?.brand || "",
          category: prod?.category || "",
          postType: postForm.post_type,
          topic: postForm.title.trim(),
        },
      });
      if (error) throw error;
      setPostForm(p => ({
        ...p,
        title: p.title.trim() || (data?.title ?? p.title),
        content: data?.content ?? p.content,
        hashtags: Array.isArray(data?.hashtags) && data.hashtags.length ? Array.from(new Set([...p.hashtags, ...data.hashtags])) : p.hashtags,
      }));
      toast.success("Copy generado con IA");
    } catch (err: any) {
      toast.error("Error generando copy: " + (err.message || "desconocido"));
    } finally {
      setAiGenerating(false);
    }
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function savePost() {
    if (!postForm.title.trim() || !postForm.content.trim()) {
      toast.error("Título y contenido requeridos"); return;
    }
    const payload = {
      org_id: orgId,
      title: postForm.title.trim(),
      content: postForm.content.trim(),
      platforms: postForm.platforms,
      hashtags: postForm.hashtags,
      status: postForm.status,
      scheduled_for: postForm.scheduled_for || null,
      post_type: postForm.post_type,
      campaign_name: postForm.campaign_name || null,
      target_audience: postForm.target_audience || null,
      cta_text: postForm.cta_text || null,
      cta_url: postForm.cta_url || null,
      notes: postForm.notes || null,
    };
    if (editingPost) {
      const { error } = await supabase.from("social_posts").update(payload).eq("id", editingPost.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Post actualizado");
    } else {
      const { error } = await supabase.from("social_posts").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Post creado");
    }
    setPostOpen(false); setEditingPost(null); setPostForm(EMPTY_POST); setPostHashtagInput("");
    loadData();
  }

  async function deletePost(id: string) {
    if (!confirm("¿Eliminar post?")) return;
    await supabase.from("social_posts").delete().eq("id", id);
    toast.success("Post eliminado");
    loadData();
  }

  async function publishPost(id: string) {
    await supabase.from("social_posts").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
    toast.success("Marcado como publicado");
    loadData();
  }

  function openEditPost(post: SocialPost) {
    setEditingPost(post);
    setPostForm({
      title: post.title, content: post.content, platforms: post.platforms,
      hashtags: post.hashtags, status: post.status,
      scheduled_for: post.scheduled_for ? post.scheduled_for.substring(0, 16) : "",
      post_type: post.post_type, campaign_name: post.campaign_name || "",
      target_audience: post.target_audience || "", cta_text: post.cta_text || "",
      cta_url: post.cta_url || "", notes: post.notes || "",
    });
    setPostOpen(true);
  }

  function togglePlatform(p: string) {
    setPostForm(prev => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter(x => x !== p)
        : [...prev.platforms, p],
    }));
  }

  function addPostHashtag() {
    const tag = postHashtagInput.trim().replace(/^#/, "");
    if (!tag) return;
    if (!postForm.hashtags.includes(tag)) {
      setPostForm(p => ({ ...p, hashtags: [...p.hashtags, tag] }));
    }
    setPostHashtagInput("");
  }

  function applyHashtagSet(hs: HashtagSet) {
    const merged = Array.from(new Set([...postForm.hashtags, ...hs.hashtags]));
    setPostForm(p => ({ ...p, hashtags: merged }));
    toast.success(`Aplicados ${hs.hashtags.length} hashtags de "${hs.name}"`);
  }

  async function saveHashtagSet() {
    if (!htForm.name.trim() || htForm.hashtags.length === 0) {
      toast.error("Nombre y al menos un hashtag requeridos"); return;
    }
    const { error } = await supabase.from("hashtag_sets").insert({
      org_id: orgId, name: htForm.name.trim(), hashtags: htForm.hashtags, platform: htForm.platform,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Set de hashtags guardado");
    setHashtagOpen(false);
    setHtForm({ name: "", hashtags: [], platform: "instagram", tagInput: "" });
    loadData();
  }

  async function deleteHashtagSet(id: string) {
    await supabase.from("hashtag_sets").delete().eq("id", id);
    toast.success("Set eliminado");
    loadData();
  }

  async function saveIdea() {
    if (!ideaForm.idea.trim()) { toast.error("La idea no puede estar vacía"); return; }
    const { error } = await supabase.from("content_ideas").insert({
      org_id: orgId, idea: ideaForm.idea.trim(), category: ideaForm.category, priority: Number(ideaForm.priority),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Idea guardada");
    setIdeaOpen(false);
    setIdeaForm({ idea: "", category: "producto", priority: "0" });
    loadData();
  }

  async function convertIdeaToPost(idea: ContentIdea) {
    await supabase.from("content_ideas").update({ converted_to_post: true }).eq("id", idea.id);
    setPostForm({ ...EMPTY_POST, content: idea.idea });
    setTab("posts");
    setPostOpen(true);
    loadData();
  }

  async function deleteIdea(id: string) {
    await supabase.from("content_ideas").delete().eq("id", id);
    toast.success("Idea eliminada");
    loadData();
  }

  const filteredPosts = statusFilter === "all" ? posts : posts.filter(p => p.status === statusFilter);

  const totalEngagement = posts.reduce((s, p) => s + p.likes + p.comments + p.shares + p.clicks, 0);
  const publishedCount = posts.filter(p => p.status === "published").length;
  const scheduledCount = posts.filter(p => p.status === "scheduled").length;

  const kpis = useMemo(() => [
    { label: "Total posts", value: posts.length, icon: Share2, color: "primary" as const },
    { label: "Publicados", value: publishedCount, icon: CheckCircle2, color: "success" as const },
    { label: "Programados", value: scheduledCount, icon: Clock, color: "blue" as const },
    { label: "Interacciones totales", value: totalEngagement.toLocaleString("es-AR"), icon: Heart, color: "purple" as const },
  ], [posts.length, publishedCount, scheduledCount, totalEngagement]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Share2}
        title="Planner de Redes Sociales"
        description="Planificá, programá y analizá tu contenido en Instagram, TikTok, Facebook y más."
        actions={
          <>
            <Button variant="outline" onClick={() => setIdeaOpen(true)}>
              <Lightbulb className="w-4 h-4 mr-1" /> Idea
            </Button>
            <Button variant="outline" onClick={() => setHashtagOpen(true)}>
              <Hash className="w-4 h-4 mr-1" /> Hashtags
            </Button>
            <Button onClick={() => { setEditingPost(null); setPostForm(EMPTY_POST); setPostOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo post
            </Button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} color={k.color} />
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="posts">Posts ({posts.length})</TabsTrigger>
            <TabsTrigger value="hashtags">Hashtags ({hashtagSets.length})</TabsTrigger>
            <TabsTrigger value="ideas">Ideas ({ideas.length})</TabsTrigger>
          </TabsList>

          {/* Posts tab */}
          <TabsContent value="posts" className="pt-3 space-y-3">
            {/* Filter row */}
            <div className="flex gap-2 flex-wrap">
              {["all", "draft", "scheduled", "published", "cancelled"].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s === "all" ? "Todos" : STATUS_CONFIG[s]?.label}
                </button>
              ))}
            </div>

            {filteredPosts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Share2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin posts. Creá uno o convertí una idea.</p>
              </div>
            ) : (
              <div className="space-y-3 pb-12">
                {filteredPosts.map(post => {
                  const sc = STATUS_CONFIG[post.status];
                  const StatusIcon = sc.icon;
                  return (
                    <div key={post.id} className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
                      {/* Header */}
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.color}`}>
                              <StatusIcon className="w-3 h-3" />
                              {sc.label}
                            </span>
                            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">{POST_TYPES.find(t => t.value === post.post_type)?.label}</span>
                            {post.campaign_name && (
                              <span className="text-xs text-primary/70 bg-primary/8 px-2 py-0.5 rounded-full">{post.campaign_name}</span>
                            )}
                          </div>
                          <h3 className="font-semibold text-sm truncate">{post.title}</h3>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {post.status !== "published" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => publishPost(post.id)}>
                              <Send className="w-3 h-3 mr-1" /> Publicar
                            </Button>
                          )}
                          <button onClick={() => openEditPost(post)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deletePost(post.id)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Content preview */}
                      <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>

                      {/* Platforms + hashtags */}
                      <div className="flex flex-wrap gap-1.5">
                        {post.platforms.map(p => (
                          <span key={p} className="text-xs bg-muted/40 px-2 py-0.5 rounded-full">
                            {PLATFORM_EMOJI[p]} {PLATFORMS.find(x => x.value === p)?.label}
                          </span>
                        ))}
                        {post.hashtags.slice(0, 5).map(h => (
                          <span key={h} className="text-xs text-primary/70">#{h}</span>
                        ))}
                        {post.hashtags.length > 5 && (
                          <span className="text-xs text-muted-foreground">+{post.hashtags.length - 5} más</span>
                        )}
                      </div>

                      {/* Engagement + dates */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex gap-3">
                          {post.likes > 0 && <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{post.likes}</span>}
                          {post.comments > 0 && <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" />{post.comments}</span>}
                          {post.shares > 0 && <span className="flex items-center gap-1"><Repeat2 className="w-3 h-3" />{post.shares}</span>}
                          {post.views > 0 && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{post.views}</span>}
                        </div>
                        {post.scheduled_for && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {fmtDate(post.scheduled_for)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Hashtags tab */}
          <TabsContent value="hashtags" className="pt-3 space-y-3">
            {hashtagSets.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin sets de hashtags. Creá uno para reutilizarlos rápido.</p>
            ) : (
              hashtagSets.map(hs => (
                <div key={hs.id} className="rounded-xl border border-border/50 bg-card p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-medium text-sm flex-1">{hs.name}</span>
                    <span className="text-xs text-muted-foreground">{PLATFORM_EMOJI[hs.platform]} {PLATFORMS.find(p => p.value === hs.platform)?.label}</span>
                    <button onClick={() => deleteHashtagSet(hs.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hs.hashtags.map(h => (
                      <span key={h} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">#{h}</span>
                    ))}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(hs.hashtags.map(h => `#${h}`).join(" ")); toast.success("Hashtags copiados"); }}
                    className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copiar todos
                  </button>
                </div>
              ))
            )}
          </TabsContent>

          {/* Ideas tab */}
          <TabsContent value="ideas" className="pt-3 space-y-2">
            {ideas.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin ideas de contenido. Anotá tus próximas ideas.</p>
            ) : (
              ideas.map(idea => (
                <div key={idea.id} className={`rounded-xl border border-border/50 bg-card p-3 ${idea.converted_to_post ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-full capitalize">{idea.category.replace("_", " ")}</span>
                        {idea.priority > 0 && (
                          <span className="text-xs text-yellow-400">★ {idea.priority}</span>
                        )}
                        {idea.converted_to_post && (
                          <span className="text-xs text-emerald-400 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> Convertida</span>
                        )}
                      </div>
                      <p className="text-sm">{idea.idea}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!idea.converted_to_post && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => convertIdeaToPost(idea)}>
                          <Share2 className="w-3 h-3 mr-1" /> Crear post
                        </Button>
                      )}
                      <button onClick={() => deleteIdea(idea.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Post dialog */}
      <Dialog open={postOpen} onOpenChange={v => { setPostOpen(v); if (!v) { setEditingPost(null); setPostForm(EMPTY_POST); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingPost ? "Editar post" : "Nuevo post"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Título *</Label>
              <Input value={postForm.title} onChange={e => setPostForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Post lanzamiento verano..." />
            </div>

            {/* ── Generador de copy con IA ─────────────────────────── */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />Generar copy con IA
              </p>
              <div className="flex gap-2">
                <Select value={aiProductId || "__none"} onValueChange={v => setAiProductId(v === "__none" ? "" : v)}>
                  <SelectTrigger className="flex-1 text-xs h-9"><SelectValue placeholder="Producto (opcional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Sin producto — usar el título como tema</SelectItem>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.brand ? ` · ${p.brand}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" onClick={generateCopy} disabled={aiGenerating} className="shrink-0">
                  {aiGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span className="ml-1">Generar</span>
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Genera texto + hashtags para el tipo de post elegido. Podés editar todo después.</p>
            </div>

            {/* Platforms */}
            <div>
              <Label className="mb-2 block">Plataformas</Label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(pl => (
                  <button
                    key={pl.value}
                    onClick={() => togglePlatform(pl.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      postForm.platforms.includes(pl.value)
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-muted/30 border-border/30 text-muted-foreground hover:border-border"
                    }`}
                  >
                    <span>{pl.emoji}</span> {pl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo</Label>
                <Select value={postForm.post_type} onValueChange={v => setPostForm(p => ({ ...p, post_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POST_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Estado</Label>
                <Select value={postForm.status} onValueChange={v => setPostForm(p => ({ ...p, status: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Borrador</SelectItem>
                    <SelectItem value="scheduled">Programado</SelectItem>
                    <SelectItem value="published">Publicado</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {postForm.status === "scheduled" && (
              <div><Label>Fecha/hora programada</Label>
                <Input type="datetime-local" value={postForm.scheduled_for}
                  onChange={e => setPostForm(p => ({ ...p, scheduled_for: e.target.value }))} />
              </div>
            )}

            <div><Label>Contenido *</Label>
              <Textarea value={postForm.content} onChange={e => setPostForm(p => ({ ...p, content: e.target.value }))}
                placeholder="Texto del post..." rows={4} />
              <p className="text-xs text-muted-foreground mt-1">{postForm.content.length} caracteres</p>
            </div>

            {/* Hashtags */}
            <div>
              <Label className="mb-2 block">Hashtags</Label>
              <div className="flex gap-2 mb-2">
                <Input value={postHashtagInput} onChange={e => setPostHashtagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPostHashtag(); } }}
                  placeholder="#hashtag (Enter para agregar)" />
                <Button variant="outline" onClick={addPostHashtag} type="button">Agregar</Button>
              </div>
              {hashtagSets.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {hashtagSets.map(hs => (
                    <button key={hs.id} onClick={() => applyHashtagSet(hs)}
                      className="text-xs bg-muted/40 hover:bg-muted px-2 py-1 rounded-full text-muted-foreground">
                      + {hs.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {postForm.hashtags.map(h => (
                  <span key={h} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    #{h}
                    <button onClick={() => setPostForm(p => ({ ...p, hashtags: p.hashtags.filter(x => x !== h) }))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Campaña</Label>
                <Input value={postForm.campaign_name} onChange={e => setPostForm(p => ({ ...p, campaign_name: e.target.value }))}
                  placeholder="Verano 2026..." />
              </div>
              <div><Label>Audiencia objetivo</Label>
                <Input value={postForm.target_audience} onChange={e => setPostForm(p => ({ ...p, target_audience: e.target.value }))}
                  placeholder="Mujeres 25-35 CABA..." />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>CTA (texto)</Label>
                <Input value={postForm.cta_text} onChange={e => setPostForm(p => ({ ...p, cta_text: e.target.value }))}
                  placeholder="Comprá ahora..." />
              </div>
              <div><Label>CTA (URL)</Label>
                <Input value={postForm.cta_url} onChange={e => setPostForm(p => ({ ...p, cta_url: e.target.value }))}
                  placeholder="https://..." />
              </div>
            </div>

            <div><Label>Notas internas</Label>
              <Textarea value={postForm.notes} onChange={e => setPostForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Notas para el equipo..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPostOpen(false); setEditingPost(null); setPostForm(EMPTY_POST); }}>Cancelar</Button>
            <Button onClick={savePost}>{editingPost ? "Guardar cambios" : "Crear post"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hashtag set dialog */}
      <Dialog open={hashtagOpen} onOpenChange={setHashtagOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuevo set de hashtags</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Nombre del set *</Label>
              <Input value={htForm.name} onChange={e => setHtForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Verano, Productos, General..." />
            </div>
            <div><Label>Plataforma</Label>
              <Select value={htForm.platform} onValueChange={v => setHtForm(p => ({ ...p, platform: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(pl => <SelectItem key={pl.value} value={pl.value}>{pl.emoji} {pl.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Agregar hashtags</Label>
              <div className="flex gap-2 mt-1">
                <Input value={htForm.tagInput} onChange={e => setHtForm(p => ({ ...p, tagInput: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const tag = htForm.tagInput.trim().replace(/^#/, "");
                      if (tag && !htForm.hashtags.includes(tag)) setHtForm(p => ({ ...p, hashtags: [...p.hashtags, tag], tagInput: "" }));
                    }
                  }}
                  placeholder="#moda (Enter)" />
                <Button variant="outline" onClick={() => {
                  const tag = htForm.tagInput.trim().replace(/^#/, "");
                  if (tag && !htForm.hashtags.includes(tag)) setHtForm(p => ({ ...p, hashtags: [...p.hashtags, tag], tagInput: "" }));
                }}>+</Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {htForm.hashtags.map(h => (
                  <span key={h} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    #{h}
                    <button onClick={() => setHtForm(p => ({ ...p, hashtags: p.hashtags.filter(x => x !== h) }))}>×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHashtagOpen(false)}>Cancelar</Button>
            <Button onClick={saveHashtagSet}>Guardar set</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Idea dialog */}
      <Dialog open={ideaOpen} onOpenChange={setIdeaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva idea de contenido</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Idea *</Label>
              <Textarea value={ideaForm.idea} onChange={e => setIdeaForm(p => ({ ...p, idea: e.target.value }))}
                placeholder="Describí la idea del contenido..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Categoría</Label>
                <Select value={ideaForm.category} onValueChange={v => setIdeaForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IDEA_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Prioridad (0-10)</Label>
                <Input type="number" min="0" max="10" value={ideaForm.priority}
                  onChange={e => setIdeaForm(p => ({ ...p, priority: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIdeaOpen(false)}>Cancelar</Button>
            <Button onClick={saveIdea}>Guardar idea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
