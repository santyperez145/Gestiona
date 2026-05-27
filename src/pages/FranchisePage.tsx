import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Building2, MapPin, TrendingUp, DollarSign, CheckCircle, AlertTriangle,
  Plus, Users, Star, BarChart3, Calendar, ShieldCheck
} from "lucide-react";

interface FranchiseUnit {
  id: string;
  unit_code: string;
  owner_name: string;
  address: { city?: string; province?: string };
  opened_at: string | null;
  revenue_mtd: number;
  revenue_ytd: number;
  compliance_score: number;
  last_audit: string | null;
  is_active: boolean;
}

interface Royalty {
  unit_id: string;
  unit_code: string;
  period_month: string;
  gross_revenue: number;
  royalty_amount: number;
  marketing_fee: number;
  status: string;
}

const MOCK_UNITS: FranchiseUnit[] = [
  { id: "u1", unit_code: "ARG-001", owner_name: "Martín González", address: { city: "Palermo", province: "CABA" }, opened_at: "2023-03-15", revenue_mtd: 1_250_000, revenue_ytd: 12_800_000, compliance_score: 94, last_audit: "2026-04-10", is_active: true },
  { id: "u2", unit_code: "ARG-002", owner_name: "Laura Rodríguez", address: { city: "Córdoba", province: "Córdoba" }, opened_at: "2023-08-01", revenue_mtd: 890_000, revenue_ytd: 9_100_000, compliance_score: 88, last_audit: "2026-03-22", is_active: true },
  { id: "u3", unit_code: "ARG-003", owner_name: "Sergio Peña", address: { city: "Rosario", province: "Santa Fe" }, opened_at: "2024-01-10", revenue_mtd: 720_000, revenue_ytd: 7_200_000, compliance_score: 72, last_audit: "2026-02-15", is_active: true },
  { id: "u4", unit_code: "ARG-004", owner_name: "Ana Méndez", address: { city: "Mendoza", province: "Mendoza" }, opened_at: "2024-06-01", revenue_mtd: 0, revenue_ytd: 2_100_000, compliance_score: 65, last_audit: "2025-12-01", is_active: false },
];

const MOCK_ROYALTIES: Royalty[] = [
  { unit_id: "u1", unit_code: "ARG-001", period_month: "2026-05", gross_revenue: 1_250_000, royalty_amount: 62_500, marketing_fee: 25_000, status: "pending" },
  { unit_id: "u2", unit_code: "ARG-002", period_month: "2026-05", gross_revenue: 890_000, royalty_amount: 44_500, marketing_fee: 17_800, status: "invoiced" },
  { unit_id: "u3", unit_code: "ARG-003", period_month: "2026-05", gross_revenue: 720_000, royalty_amount: 36_000, marketing_fee: 14_400, status: "pending" },
  { unit_id: "u1", unit_code: "ARG-001", period_month: "2026-04", gross_revenue: 1_190_000, royalty_amount: 59_500, marketing_fee: 23_800, status: "paid" },
  { unit_id: "u2", unit_code: "ARG-002", period_month: "2026-04", gross_revenue: 840_000, royalty_amount: 42_000, marketing_fee: 16_800, status: "paid" },
];

function ComplianceBadge({ score }: { score: number }) {
  const cfg = score >= 90 ? { label: "Excelente", cls: "bg-green-100 text-green-700" }
    : score >= 75 ? { label: "Bueno", cls: "bg-blue-100 text-blue-700" }
    : score >= 60 ? { label: "Regular", cls: "bg-yellow-100 text-yellow-800" }
    : { label: "Crítico", cls: "bg-red-100 text-red-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

export default function FranchisePage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"units" | "royalties" | "compliance" | "analytics">("units");
  const [units] = useState<FranchiseUnit[]>(MOCK_UNITS);
  const [royalties] = useState<Royalty[]>(MOCK_ROYALTIES);
  const [selected, setSelected] = useState<FranchiseUnit | null>(null);
  const [showNew, setShowNew] = useState(false);

  const totalRevenueMtd = units.filter(u => u.is_active).reduce((sum, u) => sum + u.revenue_mtd, 0);
  const totalRoyaltiesPending = royalties.filter(r => r.status === "pending").reduce((sum, r) => sum + r.royalty_amount + r.marketing_fee, 0);
  const avgCompliance = units.length ? Math.round(units.reduce((s, u) => s + u.compliance_score, 0) / units.length) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="w-6 h-6 text-primary" /> Gestión de Franquicias</h1>
          <p className="text-muted-foreground text-sm mt-1">Red de unidades, regalías y cumplimiento</p>
        </div>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Nueva Unidad</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Agregar Unidad Franquiciada</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Código de Unidad</Label><Input placeholder="ARG-005" /></div>
              <div><Label>Nombre del Franquiciado</Label><Input placeholder="Nombre completo" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Ciudad</Label><Input placeholder="Buenos Aires" /></div>
                <div><Label>Provincia</Label><Input placeholder="CABA" /></div>
              </div>
              <div><Label>Fecha de Apertura</Label><Input type="date" /></div>
              <Button className="w-full" onClick={() => { toast.success("Unidad creada"); setShowNew(false); }}>Crear Unidad</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex gap-3 items-center"><Building2 className="w-8 h-8 text-blue-500" /><div><p className="text-xs text-muted-foreground">Unidades Activas</p><p className="text-2xl font-bold">{units.filter(u => u.is_active).length}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><DollarSign className="w-8 h-8 text-green-500" /><div><p className="text-xs text-muted-foreground">Revenue MTD Red</p><p className="text-xl font-bold">${(totalRevenueMtd / 1_000_000).toFixed(1)}M</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><TrendingUp className="w-8 h-8 text-purple-500" /><div><p className="text-xs text-muted-foreground">Regalías Pendientes</p><p className="text-xl font-bold">${(totalRoyaltiesPending / 1000).toFixed(0)}K</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex gap-3 items-center"><ShieldCheck className="w-8 h-8 text-yellow-500" /><div><p className="text-xs text-muted-foreground">Cumplimiento Prom.</p><p className="text-2xl font-bold">{avgCompliance}%</p></div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="units">Unidades</TabsTrigger>
          <TabsTrigger value="royalties">Regalías</TabsTrigger>
          <TabsTrigger value="compliance">Cumplimiento</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* UNITS */}
        <TabsContent value="units" className="space-y-3">
          {units.map(unit => (
            <Card key={unit.id} className={`cursor-pointer hover:shadow-md transition-shadow ${!unit.is_active ? "opacity-60" : ""}`} onClick={() => setSelected(unit)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">{unit.unit_code.split("-")[1]}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{unit.unit_code}</span>
                    <span className="text-sm text-muted-foreground">— {unit.owner_name}</span>
                    {!unit.is_active && <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin className="w-3 h-3" />{unit.address?.city}, {unit.address?.province}
                    {unit.opened_at && <span className="ml-2">· Abierta {new Date(unit.opened_at).toLocaleDateString("es-AR", { year: "numeric", month: "short" })}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">${(unit.revenue_mtd / 1000).toFixed(0)}K MTD</p>
                  <ComplianceBadge score={unit.compliance_score} />
                </div>
                <div className="w-24">
                  <p className="text-xs text-muted-foreground mb-1">Cumplimiento</p>
                  <Progress value={unit.compliance_score} className="h-2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ROYALTIES */}
        <TabsContent value="royalties">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left py-3 px-4">Unidad</th>
                    <th className="text-left py-3 px-4">Período</th>
                    <th className="text-right py-3 px-4">Revenue</th>
                    <th className="text-right py-3 px-4">Regalía (5%)</th>
                    <th className="text-right py-3 px-4">Mkt Fee (2%)</th>
                    <th className="text-center py-3 px-4">Estado</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {royalties.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-muted/20">
                      <td className="py-3 px-4 font-mono text-sm">{r.unit_code}</td>
                      <td className="py-3 px-4">{r.period_month}</td>
                      <td className="py-3 px-4 text-right">${r.gross_revenue.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-medium">${r.royalty_amount.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">${r.marketing_fee.toLocaleString()}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.status === "paid" ? "bg-green-100 text-green-700" :
                          r.status === "invoiced" ? "bg-blue-100 text-blue-700" :
                          "bg-yellow-100 text-yellow-800"}`}>
                          {r.status === "paid" ? "Pagado" : r.status === "invoiced" ? "Facturado" : "Pendiente"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {r.status === "pending" && <Button size="sm" variant="outline" onClick={() => toast.success("Factura emitida")}>Facturar</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMPLIANCE */}
        <TabsContent value="compliance" className="space-y-4">
          {units.filter(u => u.is_active).map(unit => (
            <Card key={unit.id} className={unit.compliance_score < 70 ? "border-red-300" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="font-semibold">{unit.unit_code}</span>
                    <span className="text-sm text-muted-foreground ml-2">{unit.owner_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {unit.compliance_score < 70 && <AlertTriangle className="w-4 h-4 text-red-500" />}
                    <ComplianceBadge score={unit.compliance_score} />
                    <span className="font-bold">{unit.compliance_score}/100</span>
                  </div>
                </div>
                <Progress value={unit.compliance_score} className="h-3 mb-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Última auditoría: {unit.last_audit ?? "Nunca"}</span>
                  <Button size="sm" variant="outline" onClick={() => toast.info("Iniciando auditoría...")}>Nueva Auditoría</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ANALYTICS */}
        <TabsContent value="analytics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Revenue por Unidad (MTD)</CardTitle></CardHeader>
              <CardContent>
                {units.filter(u => u.is_active).map(u => {
                  const maxRev = Math.max(...units.map(x => x.revenue_mtd));
                  return (
                    <div key={u.id} className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span>{u.unit_code}</span><span className="font-medium">${(u.revenue_mtd / 1000).toFixed(0)}K</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(u.revenue_mtd / maxRev) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Regalías Acumuladas YTD</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary mb-2">
                  ${(units.reduce((s, u) => s + u.revenue_ytd * 0.05, 0) / 1000).toFixed(0)}K
                </div>
                <p className="text-xs text-muted-foreground mb-4">Total regalías 5% sobre revenue YTD de toda la red</p>
                {units.filter(u => u.is_active).map(u => (
                  <div key={u.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span>{u.unit_code}</span>
                    <span className="font-medium">${(u.revenue_ytd * 0.05 / 1000).toFixed(0)}K</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Unit detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{selected.unit_code} — {selected.owner_name}</CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Ubicación</p><p>{selected.address?.city}, {selected.address?.province}</p></div>
                <div><p className="text-xs text-muted-foreground">Apertura</p><p>{selected.opened_at ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Revenue MTD</p><p className="font-bold text-green-600">${selected.revenue_mtd.toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Revenue YTD</p><p className="font-bold">${(selected.revenue_ytd / 1_000_000).toFixed(2)}M</p></div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Cumplimiento</span><span className="font-bold">{selected.compliance_score}%</span>
                </div>
                <Progress value={selected.compliance_score} className="h-3" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => toast.info("Abriendo chat...")}>Contactar</Button>
                <Button variant="outline" size="sm" onClick={() => toast.info("Generando reporte...")}>Reporte</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
