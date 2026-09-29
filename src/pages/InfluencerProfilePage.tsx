import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BadgeCheck, BarChart3, CalendarCheck, ExternalLink, Instagram, MapPin, Star, Users } from "lucide-react";
import BrandLogo from "@/components/shared/BrandLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type InfluencerPublicProfile = {
  slug: string; name: string; avatar_url?: string; bio?: string;
  instagram?: string; tiktok?: string; youtube?: string; category?: string;
  city?: string; country_code: string; rate_from_ars?: number;
  identity_verified: boolean; followers?: number; engagement_rate?: number;
  metrics_verified: boolean; last_verified_at?: string; rating?: number;
  reviews_count: number; completed_campaigns: number;
};

type PublicReview = { id: string; rating: number; comment: string | null; created_at: string; org_name: string | null };
type PortfolioItem = { id: string; description: string; campaign_name: string | null; content_url: string };

const compactNumber = (value?: number) => value == null ? "Sin datos verificados" : new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const money = (value?: number) => value == null ? null : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);

function socialUrl(network: "instagram" | "tiktok" | "youtube", handle: string) {
  const clean = handle.replace(/^@/, "").trim();
  if (handle.startsWith("https://")) return handle;
  return network === "instagram" ? `https://instagram.com/${clean}` : network === "tiktok" ? `https://tiktok.com/@${clean}` : `https://youtube.com/@${clean}`;
}

export default function InfluencerProfilePage() {
  const { token = "" } = useParams<{ token: string }>();
  const [profile, setProfile] = useState<InfluencerPublicProfile | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      (supabase as any).rpc("get_influencer_public_profile", { p_token: token }),
      (supabase as any).rpc("get_influencer_public_reviews", { p_token: token }),
      (supabase as any).rpc("get_influencer_public_portfolio", { p_token: token }),
    ]).then(([profileResult, reviewResult, portfolioResult]) => {
      if (!active) return;
      setProfile(profileResult.error ? null : profileResult.data as InfluencerPublicProfile | null);
      setReviews(reviewResult.error || !Array.isArray(reviewResult.data) ? [] : reviewResult.data);
      setPortfolio(portfolioResult.error || !Array.isArray(portfolioResult.data) ? [] : portfolioResult.data);
    }).catch(() => { if (active) setProfile(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => { document.title = profile ? `${profile.name} · Nerqia Creadores` : "Creador · Nerqia"; }, [profile]);

  if (loading) return <main className="grid min-h-screen place-items-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Cargando perfil" /></main>;
  if (!profile) return <main className="grid min-h-screen place-items-center bg-background px-6"><div className="max-w-md text-center"><BrandLogo compact decorative className="mx-auto mb-5" /><h1 className="text-2xl font-semibold">Perfil no disponible</h1><p className="mt-2 text-sm text-muted-foreground">El creador no publicó este perfil, está en revisión o el enlace ya no está vigente.</p><Button asChild className="mt-6"><Link to="/">Volver a Nerqia</Link></Button></div></main>;

  const socials = (["instagram", "tiktok", "youtube"] as const).filter(network => profile[network]);
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Link to="/"><BrandLogo decorative /></Link><Badge variant="outline">Directorio de creadores</Badge></div></header>
    <section className="border-b border-border bg-card"><div className="mx-auto grid max-w-5xl gap-7 px-5 py-10 md:grid-cols-[minmax(0,1fr)_260px] md:items-end">
      <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <Users className="h-9 w-9 text-muted-foreground" />}</div>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-semibold">{profile.name}</h1>{profile.identity_verified && <Badge variant="success"><BadgeCheck className="mr-1 h-3.5 w-3.5" />Identidad verificada</Badge>}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">{profile.category && <span>{profile.category}</span>}{profile.city && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{profile.city}, {profile.country_code}</span>}</div>
          {profile.bio && <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground/80">{profile.bio}</p>}
          <div className="mt-4 flex flex-wrap gap-2">{socials.map(network => <Button key={network} asChild size="sm" variant="outline"><a href={socialUrl(network, profile[network]!)} target="_blank" rel="noopener noreferrer"><Instagram className="mr-2 h-4 w-4" />{network === "instagram" ? "Instagram" : network === "tiktok" ? "TikTok" : "YouTube"}<ExternalLink className="ml-2 h-3.5 w-3.5" /></a></Button>)}</div>
        </div>
      </div>
      <div className="border-l-2 border-primary pl-4"><p className="text-xs text-muted-foreground">Tarifa orientativa</p><p className="mt-1 text-xl font-semibold">{money(profile.rate_from_ars) ? `Desde ${money(profile.rate_from_ars)}` : "A convenir"}</p><p className="mt-2 text-xs text-muted-foreground">La contratación se acuerda dentro de cada campaña.</p></div>
    </div></section>

    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="grid border-y border-border sm:grid-cols-4">{[
        { icon: Users, label: "Audiencia verificada", value: compactNumber(profile.followers) },
        { icon: BarChart3, label: "Engagement verificado", value: profile.engagement_rate == null ? "Sin datos verificados" : `${profile.engagement_rate}%` },
        { icon: CalendarCheck, label: "Campañas completadas", value: String(profile.completed_campaigns ?? 0) },
        { icon: Star, label: "Valoración pública", value: profile.rating == null ? "Sin reseñas públicas" : `${profile.rating}/5 (${profile.reviews_count})` },
      ].map((item, index) => <div key={item.label} className={`min-w-0 px-4 py-5 ${index ? "sm:border-l sm:border-border" : ""}`}><item.icon className="h-4 w-4 text-primary" /><p className="mt-3 text-lg font-semibold">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.label}</p></div>)}</div>
      {!profile.metrics_verified && <p className="mt-3 text-xs text-muted-foreground">Las métricas autodeclaradas no se muestran. Nerqia publica únicamente reportes revisados por una marca.</p>}

      <Tabs defaultValue="portfolio" className="mt-8"><TabsList><TabsTrigger value="portfolio">Publicaciones</TabsTrigger><TabsTrigger value="reviews">Reseñas ({reviews.length})</TabsTrigger></TabsList>
        <TabsContent value="portfolio" className="mt-5">{portfolio.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{portfolio.map(item => <a key={item.id} href={item.content_url} target="_blank" rel="noopener noreferrer" className="border border-border bg-card p-4 transition-colors hover:border-primary"><p className="line-clamp-2 text-sm font-medium">{item.description}</p><p className="mt-3 text-xs text-muted-foreground">{item.campaign_name ?? "Publicación verificada"}</p><span className="mt-4 flex items-center text-xs font-medium text-primary">Abrir publicación <ExternalLink className="ml-1 h-3.5 w-3.5" /></span></a>)}</div> : <p className="border-y border-border py-10 text-center text-sm text-muted-foreground">El creador todavía no eligió publicaciones verificadas para mostrar.</p>}</TabsContent>
        <TabsContent value="reviews" className="mt-5">{reviews.length ? <div className="divide-y divide-border border-y border-border">{reviews.map(review => <article key={review.id} className="py-5"><div className="flex items-center gap-2"><span className="font-medium">{review.org_name ?? "Marca verificada"}</span><span className="text-sm text-amber-600">{review.rating}/5</span></div>{review.comment && <p className="mt-2 text-sm text-foreground/80">{review.comment}</p>}<p className="mt-2 text-xs text-muted-foreground">{new Date(review.created_at).toLocaleDateString("es-AR")}</p></article>)}</div> : <p className="border-y border-border py-10 text-center text-sm text-muted-foreground">No hay reseñas con consentimiento público.</p>}</TabsContent>
      </Tabs>
    </div>
  </main>;
}
