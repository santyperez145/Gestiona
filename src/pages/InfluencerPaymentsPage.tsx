import { useState, useEffect } from "react";
import { TrendingUp, DollarSign, Users, Award } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listInfluencerSales, listPayouts, listInfluencers, listPayments, type InfluencerPayment, createPayment, processPayment } from "@/lib/influencersDB";
import { toast } from "sonner";

/**
 * Pagos a Influencers — Gestión completa de liquidaciones y comisiones.
 * Sin mocks: datos reales desde Supabase.
 */
export default function InfluencerPaymentsPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [payments, setPayments] = useState<InfluencerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const [s, p, inf, pmts] = await Promise.all([
        listInfluencerSales(),
        listPayouts(),
        listInfluencers(),
        listPayments()
      ]);
      setSales(s);
      setPayouts(p);
      setInfluencers(inf);
      setPayments(pmts);
    } catch {
      setSales([]);
      setPayouts([]);
      setInfluencers([]);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const filteredSales = sales.filter((r) => {
    const q = search.toLowerCase();
    return (r.influencer_name || "").toLowerCase().includes(q) || (r.sale_id || "").toLowerCase().includes(q);
  });

  const totalCommissions = sales.reduce((s, r) => s + Number(r.commission_ars || 0), 0);
  const totalPaid = payouts.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const pendingSales = sales.filter((r) => !r.paid);
  const pendingPayouts = payments.filter((p) => p.status === "pending" || p.status === "processing");
  const completedPayouts = payments.filter((p) => p.status === "completed");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-semibold">Pagos a Influencers</h2>
          <p className="text-sm text-muted-foreground">Liquidaciones y comisiones — datos reales del Core</p>
        </div>
        <Input placeholder="Buscar venta…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Comisiones Generadas</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">${totalCommissions.toLocaleString("es-AR")}</p><p className="text-xs text-muted-foreground">{sales.length} ventas</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pagos Realizados</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">${totalPaid.toLocaleString("es-AR")}</p><p className="text-xs text-muted-foreground">{completedPayouts.length} pagos</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pendientes</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{pendingSales.length}</p><p className="text-xs text-muted-foreground">ventas sin payout</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tasa de Conversión</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{sales.length > 0 ? ((sales.filter((r) => r.paid).length / sales.length) * 100).toFixed(1) : 0}%</p><p className="text-xs text-muted-foreground">ventas pagadas</p></CardContent></Card>
      </div>

      {/* Historial de liquidaciones */}
      <Card>
        <CardHeader><CardTitle className="text-lg font-display font-semibold">Liquidaciones</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Payout</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Influencer</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Monto</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Método</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-muted">
                    <td className="px-4 py-3 text-sm">{p.payout_id || p.id}</td>
                    <td className="px-4 py-3 text-sm">{p.influencer_name || "—"}</td>
                    <td className="px-4 py-3 text-sm">${Number(p.amount_ars || 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-sm">{p.payment_method || "transfer"}</td>
                    <td className="px-4 py-3 text-sm"><Badge variant={p.status === "paid" ? "secondary" : "outline"}>{p.status || "pendiente"}</Badge></td>
                    <td className="px-4 py-3 text-sm">{p.paid_at || p.created_at || "—"}</td>
                  </tr>
                ))}
                {payouts.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Sin liquidaciones registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Ventas con comisión */}
      <Card>
        <CardHeader><CardTitle className="text-lg font-display font-semibold">Ventas con Comisión</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Venta</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Influencer</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Monto</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Comisión</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredSales.map((r) => (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="px-4 py-3 text-sm">{r.sale_id || r.id}</td>
                    <td className="px-4 py-3 text-sm">{r.influencer_name || "—"}</td>
                    <td className="px-4 py-3 text-sm">${Number(r.sale_total_ars || 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-sm">${Number(r.commission_ars || 0).toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-sm"><Badge variant={r.paid ? "secondary" : "default"}>{r.paid ? "Pagada" : "Pendiente"}</Badge></td>
                  </tr>
                ))}
                {filteredSales.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">Sin ventas atribuidas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}