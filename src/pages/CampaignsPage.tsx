import { useState, useEffect } from "react";
import { Filter, Users, Sparkles, BarChart3, TrendingUp, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  listInfluencerSales,
  listPayouts,
  type Influencer,
} from "@/lib/influencersDB";

/** Campañas del flujo Influencer Marketing.
 *  Sin mocks: cualquier métrica se calcula sobre filas reales de Supabase. */
export default function CampaignsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Todas");
  const [sales, setSales] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listInfluencerSales(), listPayouts()])
      .then(([s, p]) => { setSales(s); setPayouts(p); })
      .catch(() => { setSales([]); setPayouts([]); })
      .finally(() => setLoading(false));
  }, []);

  // Sin datos inventados: vacío honesto con carga.
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Gestión de Campañas</h1>
          <p className="text-sm text-muted-foreground">
            Sin datos simulados. Las métricas se obtienen desde <code>influencer_sales</code> y <code>influencer_payouts</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => window.alert("Nueva Campaña — integrar con ai-brief-generator")}>
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Nueva Campaña
        </Button>
      </div>

      {loading && (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Cargando campañas y métricas desde el Core…
        </div>
      )}

      {!loading && (
        <>
          {/* KPIs calculados sobre datos reales (o vacío si no hay filas) */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="h-[120px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Comisiones Generadas</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">Desde influencer_sales</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-2xl font-display font-bold">
                  ${sales.reduce((s, r) => s + Number(r.commission_ars || 0), 0).toLocaleString("es-AR")}
                </p>
              </CardContent>
              <CardFooter className="pt-2 text-xs text-muted-foreground">{sales.length} registros</CardFooter>
            </Card>
            <Card className="h-[120px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Pagos Realizados</CardDescription>
                <CardDescription className="text-xs text-muted-foreground">Desde influencer_payouts</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-2xl font-display font-bold">
                  ${payouts.reduce((s, r) => s + Number(r.amount_ars || 0), 0).toLocaleString("es-AR")}
                </p>
              </CardContent>
              <CardFooter className="pt-2 text-xs text-muted-foreground">{payouts.length} pagos</CardFooter>
            </Card>
            <Card className="h-[120px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Ventas Atribuidas</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">Referencias por cupón</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-2xl font-display font-bold">{sales.length}</p>
              </CardContent>
              <CardFooter className="pt-2 text-xs text-muted-foreground">
                {sales.filter((r) => r.paid).length} pagadas
              </CardFooter>
            </Card>
            <Card className="h-[120px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Pendientes de Cobrar</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">Sin asignar a payout</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-2xl font-display font-bold">
                  ${sales.filter((r) => !r.paid).length}
                </p>
              </CardContent>
              <CardFooter className="pt-2 text-xs text-muted-foreground">sin payout</CardFooter>
            </Card>
          </div>

          <div className="flex flex-wrap gap-3 items-center bg-muted/40 rounded-xl p-3">
            <div className="relative">
              <Filter className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar por influencer…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
            </div>
            <div className="flex gap-2">
              {["Todas", "Pagadas", "Pendientes"].map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={`px-2 py-1 rounded-md text-xs font-medium transition ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-muted"}`}>{s}</button>
              ))}
            </div>
            <div className="ml-auto text-xs text-muted-foreground">{sales.length} ventas</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Influencer</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cupón</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Venta</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Monto</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Comisión</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sales.filter((r) => !search || (r.influencer_name || "").includes(search)).map((r) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 text-sm font-medium">{r.influencer_name || "—"}</td>
                    <td className="px-4 py-3 text-sm">{r.referral_code || "—"}</td>
                    <td className="px-4 py-3 text-sm">{r.sale_id || "—"}</td>
                    <td className="px-4 py-3 text-sm">${Number(r.sale_total_ars || 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-sm">${Number(r.commission_ars || 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={r.paid ? "secondary" : "default"}>{r.paid ? "Pagada" : "Pendiente"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">{r.payout_id ? "Asignado" : "—"}</td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Sin ventas atribuidas a influencers aún.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
