import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BadgeCheck, BarChart3, ExternalLink, Search, Star, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import PageHeader from "@/components/shared/PageHeader";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type CreatorDirectoryRow = {
  slug: string; name: string; avatar_url: string | null; bio: string | null;
  instagram: string | null; tiktok: string | null; youtube: string | null;
  category: string | null; city: string | null; country_code: string;
  rate_from_ars: number | null; identity_verified: boolean; followers: number | null;
  engagement_rate: number | null; metrics_verified: boolean; rating: number | null;
  reviews_count: number; completed_campaigns: number;
  collaborations_count: number; on_time_rate: number | null; verified_publications: number;
};

const compact = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const money = (value: number | null) => value == null ? "A convenir" : `Desde ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value)}`;

export default function CreatorDiscoveryPage() {
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CreatorDirectoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("audience");
  const [minRating, setMinRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true); setError(null);
    const { data, error: queryError } = await (supabase as any).rpc("creator_discovery_search", { p_org_id: activeOrg.id, p_query: null, p_category: null });
    if (queryError) setError("No pudimos abrir el directorio de creadores.");
    else setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [activeOrg?.id]);

  const categories = useMemo(() => Array.from(new Set(rows.map(row => row.category).filter(Boolean) as string[])).sort(), [rows]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = rows.filter(row => (category === "all" || row.category === category) && (row.rating ?? 0) >= minRating
      && (!query || row.name.toLowerCase().includes(query) || row.bio?.toLowerCase().includes(query) || row.city?.toLowerCase().includes(query)));
    return result.sort((a, b) => sort === "rating" ? (b.rating ?? 0) - (a.rating ?? 0)
      : sort === "engagement" ? (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0)
      : (b.followers ?? 0) - (a.followers ?? 0));
  }, [rows, search, category, sort, minRating]);

  const addCreator = async (creator: CreatorDirectoryRow) => {
    if (!activeOrg?.id || adding) return;
    setAdding(creator.slug);
    const { error: addError } = await (supabase as any).rpc("creator_directory_add_to_org", { p_org_id: activeOrg.id, p_slug: creator.slug });
    setAdding(null);
    if (addError) { toast.error(addError.message || "No se pudo agregar el creador"); return; }
    toast.success(`${creator.name} ya está en tu red`);
    navigate("/influencer-marketing/creadores");
  };

  return <div className="space-y-6">
    <PageHeader icon={Search} eyebrow="Nerqia · Influencers" title="Descubrimiento" actions={<Button onClick={() => navigate("/influencer-marketing/campanas?nueva=1")}>Crear campaña</Button>} />
    <p className="max-w-3xl text-sm text-muted-foreground">Perfiles publicados por sus creadores y moderados por Nerqia. Las métricas visibles provienen de evidencia revisada, no de números autodeclarados.</p>

    <div className="grid gap-3 border-y border-border py-4 md:grid-cols-[minmax(220px,1fr)_190px_150px_170px]">
      <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, especialidad o ciudad" /></div>
      <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Categoría"><SelectValue placeholder="Todas las categorías" /></SelectTrigger><SelectContent><SelectItem value="all">Todas las categorías</SelectItem>{categories.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      <Select value={String(minRating)} onValueChange={value => setMinRating(Number(value))}><SelectTrigger aria-label="Rating mínimo"><SelectValue /></SelectTrigger><SelectContent>{[0, 3, 4, 4.5].map(value => <SelectItem key={value} value={String(value)}>{value ? `${value}+` : "Todo rating"}</SelectItem>)}</SelectContent></Select>
      <Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="Orden"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="audience">Mayor audiencia</SelectItem><SelectItem value="engagement">Mayor engagement</SelectItem><SelectItem value="rating">Mejor rating</SelectItem></SelectContent></Select>
    </div>

    {loading ? <WorkspaceState kind="initial-loading" title="Buscando creadores…" />
      : error ? <WorkspaceState kind="error-recoverable" title={error} actionLabel="Reintentar" onAction={() => void load()} />
      : !visible.length ? <WorkspaceState kind={rows.length ? "empty-filtered" : "empty-first-use"} title={rows.length ? "Sin creadores para los filtros aplicados" : "Todavía no registraste creadores"} description="Sólo aparecen perfiles consentidos y aprobados. Probá con otros filtros o volvé más tarde." />
      : <div className="divide-y divide-border border-y border-border">{visible.map(creator => <article key={creator.slug} className="grid gap-5 py-5 md:grid-cols-[minmax(0,1fr)_310px_auto] md:items-center">
        <div className="flex min-w-0 gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">{creator.avatar_url ? <img src={creator.avatar_url} alt="" className="h-full w-full object-cover" /> : <Users className="h-5 w-5 text-muted-foreground" />}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-semibold">{creator.name}</h2>{creator.identity_verified && <Badge variant="success"><BadgeCheck className="mr-1 h-3 w-3" />Identidad</Badge>}{creator.metrics_verified && <Badge variant="outline"><BarChart3 className="mr-1 h-3 w-3" />Métricas</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{[creator.category, creator.city, creator.country_code].filter(Boolean).join(" · ")}</p>{creator.bio && <p className="mt-2 line-clamp-2 text-sm text-foreground/75">{creator.bio}</p>}</div></div>
        <ReputationPanel creator={creator} />
        <div className="flex gap-2 md:justify-end"><Button asChild size="icon" variant="outline" title="Ver perfil"><Link to={`/influencer/${creator.slug}`} target="_blank"><ExternalLink className="h-4 w-4" /></Link></Button><Button size="sm" onClick={() => void addCreator(creator)} disabled={adding === creator.slug}><UserPlus className="mr-2 h-4 w-4" />Agregar</Button></div>
      </article>)}</div>}
  </div>;
}

function ReputationPanel({ creator }: { creator: CreatorDirectoryRow }) {
  return <div className="grid grid-cols-3 gap-3 text-sm"><div><p className="font-semibold">{compact(creator.followers)}</p><p className="text-xs text-muted-foreground">Audiencia</p></div><div><p className="font-semibold">{creator.engagement_rate == null ? "—" : `${creator.engagement_rate}%`}</p><p className="text-xs text-muted-foreground">Engagement</p></div><div><p className="flex items-center gap-1 font-semibold"><Star className="h-3.5 w-3.5 text-amber-500" />{creator.rating ?? "—"}</p><p className="text-xs text-muted-foreground">{creator.reviews_count ? `${creator.reviews_count} reseñas` : "Sin reviews todavía"}</p></div><p className="col-span-3 text-xs text-muted-foreground">{creator.collaborations_count} colaboraciones · {creator.on_time_rate == null ? "Puntualidad sin datos" : `${creator.on_time_rate}% a tiempo`} · {creator.verified_publications} publicaciones verificadas</p><p className="col-span-3 text-xs font-medium text-primary">{money(creator.rate_from_ars)}</p></div>;
}
