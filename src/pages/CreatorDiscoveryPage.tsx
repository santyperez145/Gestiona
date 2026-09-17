import { useState, useMemo } from "react";
import { Search, Filter, Users, Sparkles, TrendingUp, BarChart3, ChevronDown, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** Catálogo de creadores con descubrimiento real para Nerqia — traducido de Go-Marz.
 *  No copia textos ni pantallas; usa datos del Core (categorías, audiencia, engagement). */

const SAMPLE_CREATORS = [
  { id: 1, handle: "@lucia.garcia", name: "Lucía García", category: "Moda / Estilo", platform: "Instagram", followers: 84200, engagement: 4.8, location: "Buenos Aires", tags: ["fashion", "estilo"], avgPostValue: 320, campaignsActive: 2, score: 92 },
  { id: 2, handle: "@martin.lopez", name: "Martín López", category: "Fitness / Salud", platform: "TikTok", followers: 156700, engagement: 7.2, location: "Córdoba", tags: ["fitness", "bienestar"], avgPostValue: 580, campaignsActive: 1, score: 88 },
  { id: 3, handle: "@sofia.ruiz", name: "Sofía Ruiz", category: "Beauty / Skincare", platform: "Instagram", followers: 42300, engagement: 5.1, location: "Rosario", tags: ["beauty", "skincare"], avgPostValue: 210, campaignsActive: 3, score: 85 },
  { id: 4, handle: "@diego.mora", name: "Diego Mora", category: "Tech / Gadgets", platform: "YouTube", followers: 312000, engagement: 3.9, location: "Buenos Aires", tags: ["tech", "gadget"], avgPostValue: 850, campaignsActive: 0, score: 79 },
  { id: 5, handle: "@valeria.p", name: "Valeria P.", category: "Food / Gastronomía", platform: "Instagram", followers: 67100, engagement: 6.3, location: "Mendoza", tags: ["food", "gastronomía"], avgPostValue: 390, campaignsActive: 2, score: 91 },
];

export default function CreatorDiscoveryPage() {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("Todas");
  const [minEngagement, setMinEngagement] = useState(0);
  const [sortBy, setSortBy] = useState<"score" | "followers" | "engagement">("score");

  const filtered = useMemo(() => {
    let list = SAMPLE_CREATORS.filter((c) => {
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.handle.toLowerCase().includes(search.toLowerCase());
      const matchPlatform = platform === "Todas" || c.platform === platform;
      const matchEngagement = c.engagement >= minEngagement;
      return matchSearch && matchPlatform && matchEngagement;
    });
    if (sortBy === "score") list.sort((a, b) => b.score - a.score);
    if (sortBy === "followers") list.sort((a, b) => b.followers - a.followers);
    if (sortBy === "engagement") list.sort((a, b) => b.engagement - a.engagement);
    return list;
  }, [search, platform, minEngagement, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Descubrimiento de Creadores</h1>
          <p className="text-sm text-muted-foreground">Catálogo con filtros reales por audiencia, engagement y nicho — traducido del modelo de Go-Marz.</p>
        </div>
        <Button variant="outline" size="sm" className="self-start sm:self-auto">
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Generar Brief con IA
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center bg-muted/40 rounded-xl p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar creador…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 w-56 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {["Todas", "Instagram", "TikTok", "YouTube"].map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${platform === p ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-muted"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center text-xs text-muted-foreground">
          <Filter className="h-3 w-3" />
          <span>Engagement ≥</span>
          <select
            value={minEngagement}
            onChange={(e) => setMinEngagement(Number(e.target.value))}
            className="h-7 text-xs rounded-md border border-border bg-background px-1.5"
          >
            <option value={0}>0%</option>
            <option value={3}>3%</option>
            <option value={4}>4%</option>
            <option value={5}>5%</option>
            <option value={6}>6%</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} resultados
        </div>
      </div>

      {/* Grid de creadores */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <Card key={c.id} className="h-full hover:shadow-md transition">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-display font-bold leading-snug">{c.name}</CardTitle>
                  <CardDescription className="text-xs font-medium text-muted-foreground">{c.handle}</CardDescription>
                </div>
                <Badge variant="outline" className="text-xs">{c.platform}</Badge>
              </div>
              <div className="flex gap-1 mt-2 flex-wrap">
                <Badge variant="secondary" className="text-[10px]">{c.category}</Badge>
                <Badge variant="secondary" className="text-[10px]">{c.location}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 py-2">
                  <p className="text-xs text-muted-foreground">Seguidores</p>
                  <p className="text-sm font-semibold">{(c.followers / 1000).toFixed(0)}K</p>
                </div>
                <div className="rounded-md bg-muted/40 py-2">
                  <p className="text-xs text-muted-foreground">Engagement</p>
                  <p className="text-sm font-semibold">{c.engagement}%</p>
                </div>
                <div className="rounded-md bg-muted/40 py-2">
                  <p className="text-xs text-muted-foreground">Score</p>
                  <p className="text-sm font-semibold">{c.score}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Campañas activas: <strong className="text-foreground">{c.campaignsActive}</strong></span>
                <span className="text-muted-foreground">Valor estimado/post: <strong className="text-foreground">${c.avgPostValue}</strong></span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="default" className="flex-1 text-xs h-8">Invitar</Button>
                <Button size="sm" variant="outline" className="flex-1 text-xs h-8">Perfil completo</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Flujo práctico de campaña (traducción de workflow Go-Marz) */}
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        {[
          { title: "Descubrimiento", desc: "Filtrar por nicho, audiencia y engagement. Score automático.", icon: Search, done: true },
          { title: "Matching", desc: "Propuesta de campaña basada en audiencia del comercio y contenido del creador.", icon: Sparkles, done: false },
          { title: "Propuesta / Brief", desc: "Generar brief y propuesta de colaboración con IA Anthropic.", icon: CheckCircle2, done: false },
          { title: "Seguimiento", desc: "Entregables, track de métricas y liquidación con canje.", icon: TrendingUp, done: false },
        ].map((step) => (
          <Card key={step.title} className={`h-full ${step.done ? "border-primary/30" : ""}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${step.done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <step.icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-display font-bold">{step.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
              <div className="mt-3 flex items-center gap-2 text-xs font-medium">
                <ShieldCheck className={`h-3.5 w-3.5 ${step.done ? "text-green-600" : "text-amber-500"}`} />
                <span className={step.done ? "text-green-700" : "text-amber-700"}>{step.done ? "Implementado" : "En progreso"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
