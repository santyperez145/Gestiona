import { useState, useEffect } from "react";
import { BarChart3, Bell, Building2, DollarSign, Eye, FileText, MessageCircle, Share2, TrendingUp, Users, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listInfluencers } from "@/lib/influencersDB";

/**
 * Brand Portal — Panel de gestión de marca para influencers.
 * Sin mocks: datos reales desde Supabase.
 */
export default function BrandPortalPage() {
  const [creators, setCreators] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listInfluencers().then((data) => setCreators(data)).catch(() => setCreators([])).finally(() => setLoading(false));
  }, []);

  const filtered = creators.filter((c) => {
    const name = (c.name || "").toLowerCase();
    const insta = (c.instagram || "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || insta.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-semibold">Brand Portal</h2>
          <p className="text-sm text-muted-foreground">Gestión de colaboraciones con influencers</p>
        </div>
        <Input placeholder="Buscar creador…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
      </div>

      {loading && (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Cargando creadores desde el Core…
        </div>
      )}

      {!loading && (
        <>
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
                    <Badge variant="secondary" className="text-[10px]">{c.followers_ig ? `${(c.followers_ig / 1000).toFixed(0)}K` : "—"} seg.</Badge>
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
                    <Button size="sm" variant="default" className="flex-1 text-xs h-8">Ver perfil</Button>
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-8">Mensaje</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No se encontraron creadores para "{search}".</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}