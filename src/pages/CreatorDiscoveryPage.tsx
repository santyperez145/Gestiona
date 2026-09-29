import { useState, useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Filter, Sparkles, TrendingUp, BarChart3, CheckCircle2, ShieldCheck, UserCheck, Star, CalendarCheck, BadgeCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listInfluencers, listInfluencerReputation, type Influencer, type InfluencerReputation } from "@/lib/influencersDB";
import { requireActiveOrgId } from "@/lib/orgContext";
import WorkspaceState from "@/components/shared/WorkspaceState";

export default function CreatorDiscoveryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("Todas");
  const [minEngagement, setMinEngagement] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<"tier" | "followers_ig" | "engagement_rate" | "rating">("tier");
  const [creators, setCreators] = useState<Influencer[]>([]);
  const [reputation, setReputation] = useState<Map<string, InfluencerReputation>>(new Map());
  const [loading, setLoading] = useState(true);
  // Recarga la reputación al volver a la página (ej.: después de verificar
  // métricas en la bandeja): el sello de evidencia se refresca sin F5.
  const { pathname } = useLocation();
  const [refetchToken, setRefetchToken] = useState(0);
  useEffect(() => {
    setRefetchToken(t => t + 1);
  }, [pathname]);

  useEffect(() => {
    const orgId = requireActiveOrgId();
    Promise.all([listInfluencers(), listInfluencerReputation(orgId)]).then(([creators, reputations]) => {
      setCreators(creators);
      setReputation(reputations);
    }).catch(() => {
      setCreators([]);
      setReputation(new Map());
    }).finally(() => setLoading(false));
  }, [refetchToken]);

  const filtered = useMemo(() => {
    const list = creators.filter((c) => {
      const matchSearch = !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) || (c.instagram || "").toLowerCase().includes(search.toLowerCase());
      const matchPlatform = platform === "Todas" || (c.instagram && platform === "Instagram") || (c.tiktok && platform === "TikTok");
      const matchEngagement = (c.engagement_rate || 0) >= minEngagement;
      const rep = reputation.get(c.id);
      const matchRating = minRating === 0 || (rep?.rating ?? 0) >= minRating;
      return matchSearch && matchPlatform && matchEngagement && matchRating;
    });
    if (sortBy === "tier") list.sort((a, b) => (b.followers_ig || 0) - (a.followers_ig || 0));
    if (sortBy === "followers_ig") list.sort((a, b) => (b.followers_ig || 0) - (a.followers_ig || 0));
    if (sortBy === "engagement_rate") list.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    if (sortBy === "rating") list.sort((a, b) => (reputation.get(b.id)?.rating ?? 0) - (reputation.get(a.id)?.rating ?? 0));
    return list;
  }, [creators, search, platform, minEngagement, minRating, sortBy, reputation]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Descubrimiento de Creadores</h1>
          <p className="text-sm text-muted-foreground">Los creadores de tu comercio, filtrados por plataforma y engagement.</p>
        </div>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => navigate("/influencer-marketing/campanas?nueva=1")}>
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Crear Campaña
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center bg-muted/40 rounded-xl p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar creador…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-56 text-sm" />
        </div>
        <div className="flex gap-2">
          {["Todas", "Instagram", "TikTok"].map((p) => (
            <button key={p} onClick={() => setPlatform(p)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${platform === p ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-muted"}`}>{p}</button>
          ))}
        </div>
        <div className="flex gap-2 items-center text-xs text-muted-foreground">
          <Filter className="h-3 w-3" />
          <span>Engagement ≥</span>
          <Select value={String(minEngagement)} onValueChange={(value) => setMinEngagement(Number(value))}>
            <SelectTrigger className="h-8 w-20 text-xs" aria-label="Engagement mínimo"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[0, 3, 4, 5, 6].map((value) => (
                <SelectItem key={value} value={String(value)}>{value}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center text-xs text-muted-foreground">
          <Star className="h-3 w-3" />
          <span>Rating ≥</span>
          <Select value={String(minRating)} onValueChange={(value) => setMinRating(Number(value))}>
            <SelectTrigger className="h-8 w-20 text-xs" aria-label="Rating mínimo"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[0, 3, 4, 4.5, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>{value === 0 ? "Todos" : value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 items-center text-xs text-muted-foreground">
          <BarChart3 className="h-3 w-3" />
          <span>Ordenar</span>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Ordenar por"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tier">Relevancia (seguidores)</SelectItem>
              <SelectItem value="engagement_rate">Mayor engagement</SelectItem>
              <SelectItem value="rating">Mejor rating</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">{filtered.length} resultados · {loading ? "cargando…" : "listo"}</div>
      </div>

      {loading ? (
        <WorkspaceState kind="initial-loading" title="Buscando creadores disponibles…" />
      ) : filtered.length === 0 ? (
        <WorkspaceState
          kind={search || platform !== "Todas" || minEngagement > 0 ? "empty-filtered" : "empty-first-use"}
          title={search || platform !== "Todas" || minEngagement > 0 ? "Sin creadores para los filtros aplicados" : "Todavía no registraste creadores"}
          description="Sumá creadores e influencers para acordar canjes, medir ventas con cupones y liquidar comisiones."
          actionLabel="Crear campaña"
          onAction={() => navigate("/influencer-marketing/campanas?nueva=1")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="h-full hover:shadow-md transition">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-display font-bold leading-snug">{c.name || "Sin nombre"}</CardTitle>
                    <CardDescription className="text-xs font-medium text-muted-foreground">@{c.instagram || c.tiktok || "—"}</CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">{c.tier || "—"}</Badge>
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">{c.status || "activo"}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{c.followers_ig ? `${(c.followers_ig/1000).toFixed(0)}K` : "—"} seg.</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/40 py-2"><p className="text-xs text-muted-foreground">Seguidores</p><p className="text-sm font-semibold">{(c.followers_ig || 0).toLocaleString("es-AR")}</p></div>
                  <div className="rounded-md bg-muted/40 py-2"><p className="text-xs text-muted-foreground">Engagement</p><p className="text-sm font-semibold">{(c.engagement_rate || 0).toFixed(1)}%</p></div>
                  <div className="rounded-md bg-muted/40 py-2"><p className="text-xs text-muted-foreground">Tier</p><p className="text-sm font-semibold">{c.tier || "—"}</p></div>
                </div>
                <ReputationPanel rep={reputation.get(c.id)} />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Comisión: <strong className="text-foreground">{c.commission_percent || 0}%</strong></span>
                  <span className="text-muted-foreground">Ventas: <strong className="text-foreground">{c.total_sales_count || 0}</strong></span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="default" className="flex-1 text-xs h-8" onClick={() => navigate(`/influencer-marketing/campanas?nueva=1`)}>Invitar</Button>
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => navigate(`/influencer/${c.referral_code || c.id}`)}>Perfil</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Reputación verificada del creador (Go-Marz discovery parity).
 * Rating real de reviews, colaboraciones cerradas, cumplimiento a tiempo y
 * publicaciones verificadas. Sin datos: dice «Sin reviews todavía» — nunca un
 * rating inventado.
 */
function ReputationPanel({ rep }: { rep: InfluencerReputation | undefined }) {
  if (!rep || (rep.reviews_count === 0 && rep.collaborations_count === 0)) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Sin reviews todavía — reputación cero en esta marca.
      </div>
    );
  }
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-foreground">
          <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" aria-hidden="true" />
          {rep.rating != null ? `${Number(rep.rating).toFixed(1)}/5` : "Sin rating"}
        </span>
        <span className="text-muted-foreground">{rep.reviews_count} {rep.reviews_count === 1 ? "review" : "reviews"}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {rep.collaborations_count} {rep.collaborations_count === 1 ? "colaboración" : "colaboraciones"}
        </span>
        {rep.on_time_rate != null && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {rep.on_time_rate}% a tiempo
          </span>
        )}
      </div>
      {rep.verified_publications > 0 && (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {rep.verified_publications} {rep.verified_publications === 1 ? "publicación verificada" : "publicaciones verificadas"}
        </div>
      )}
      {rep.verified_metrics && (
        <div className="flex items-center justify-between text-xs text-emerald-600">
          <span className="flex items-center gap-1">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Métricas con evidencia verificada
          </span>
          {rep.last_verified_at && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(rep.last_verified_at).toLocaleDateString("es-AR")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
