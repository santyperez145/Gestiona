import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter, Sparkles, TrendingUp, BarChart3, CheckCircle2, ShieldCheck, UserCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listInfluencers, type Influencer } from "@/lib/influencersDB";

export default function CreatorDiscoveryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("Todas");
  const [minEngagement, setMinEngagement] = useState(0);
  const [sortBy, setSortBy] = useState<"tier" | "followers_ig" | "engagement_rate">("tier");
  const [creators, setCreators] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInfluencers().then(setCreators).catch(() => setCreators([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const list = creators.filter((c) => {
      const matchSearch = !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) || (c.instagram || "").toLowerCase().includes(search.toLowerCase());
      const matchPlatform = platform === "Todas" || (c.instagram && platform === "Instagram") || (c.tiktok && platform === "TikTok");
      const matchEngagement = (c.engagement_rate || 0) >= minEngagement;
      return matchSearch && matchPlatform && matchEngagement;
    });
    if (sortBy === "tier") list.sort((a, b) => (b.followers_ig || 0) - (a.followers_ig || 0));
    if (sortBy === "followers_ig") list.sort((a, b) => (b.followers_ig || 0) - (a.followers_ig || 0));
    if (sortBy === "engagement_rate") list.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    return list;
  }, [creators, search, platform, minEngagement, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Descubrimiento de Creadores</h1>
          <p className="text-sm text-muted-foreground">Catálogo conectado al Core (tabla <code>influencers</code>, RLS por org_id).</p>
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
          <select value={minEngagement} onChange={(e) => setMinEngagement(Number(e.target.value))} className="h-7 text-xs rounded-md border border-border bg-background px-1.5">
            <option value={0}>0%</option><option value={3}>3%</option><option value={4}>4%</option><option value={5}>5%</option><option value={6}>6%</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">{filtered.length} resultados · {loading ? "cargando…" : "listo"}</div>
      </div>

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
    </div>
  );
}
