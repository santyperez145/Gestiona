import { useState, useEffect } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Leaf, TrendingDown, TrendingUp, Target, Plus, Download,
  Zap, Truck, Building, Users, Globe, CheckCircle, Loader2
} from "lucide-react";

interface EmissionEntry {
  id: string;
  scope: number;
  category: string;
  period_date: string;
  co2e_kg: number;
  quantity: number;
  unit: string;
}

interface CarbonOffset {
  id: string;
  program_name: string;
  offset_type: string;
  co2e_kg_offset: number;
  cost_ars: number;
  purchase_date: string;
  is_retired: boolean;
}

const SCOPE_COLORS: Record<number, { color: string; bg: string; label: string; icon: typeof Leaf }> = {
  1: { color: "text-red-400",    bg: "bg-red-500/10",    label: "Scope 1 — Directo",    icon: Building },
  2: { color: "text-yellow-400", bg: "bg-yellow-500/10", label: "Scope 2 — Energía",    icon: Zap },
  3: { color: "text-blue-400",   bg: "bg-blue-500/10",   label: "Scope 3 — Cadena",     icon: Truck },
};

const OFFSET_ICONS: Record<string, string> = {
  reforestation:    "🌳",
  renewable_energy: "☀️",
  methane_capture:  "⚗️",
  ocean:            "🌊",
  other:            "♻️",
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun"];

export default function CarbonFootprintPage() {
  usePageTitle("Huella de Carbono");
  const { orgId } = useOrganization();
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState<"dashboard" | "emissions" | "offsets" | "targets">("dashboard");
  const [showAddEmission, setShowAddEmission] = useState(false);
  const [showAddOffset, setShowAddOffset] = useState(false);
  const [emissions, setEmissions] = useState<EmissionEntry[]>([]);
  const [offsets, setOffsets] = useState<CarbonOffset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);

    const fetchData = async () => {
      const [emissionsRes, offsetsRes] = await Promise.all([
        supabase
          .from("carbon_emissions")
          .select(`
            id,
            quantity,
            co2e_kg,
            period_date,
            carbon_emission_categories!inner(scope, category, unit)
          `)
          .eq("org_id", activeOrg.id)
          .order("period_date", { ascending: false }),
        supabase
          .from("carbon_offsets")
          .select("id, program_name, offset_type, co2e_kg_offset, cost_ars, purchase_date, is_retired")
          .eq("org_id", activeOrg.id)
          .order("purchase_date", { ascending: false }),
      ]);

      if (emissionsRes.data) {
        const mapped: EmissionEntry[] = emissionsRes.data.map((row: any) => ({
          id: row.id,
          scope: row.carbon_emission_categories.scope as number,
          category: row.carbon_emission_categories.category as string,
          period_date: row.period_date as string,
          co2e_kg: Number(row.co2e_kg),
          quantity: Number(row.quantity),
          unit: row.carbon_emission_categories.unit as string,
        }));
        setEmissions(mapped);
      }

      if (offsetsRes.data) {
        setOffsets(offsetsRes.data as CarbonOffset[]);
      }

      setLoading(false);
    };

    fetchData();
  }, [activeOrg]);

  const totalEmissions = emissions.reduce((s, e) => s + e.co2e_kg, 0);
  const totalOffsets = offsets.filter(o => !o.is_retired).reduce((s, o) => s + o.co2e_kg_offset, 0);
  const netEmissions = totalEmissions - totalOffsets;
  const reductionPct = totalEmissions > 0 ? (totalOffsets / totalEmissions) * 100 : 0;

  const byScope: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  emissions.forEach(e => { byScope[e.scope] = (byScope[e.scope] ?? 0) + e.co2e_kg; });

  // Build monthly chart from emissions data
  const monthlyMap: Record<string, { scope1: number; scope2: number; scope3: number }> = {};
  emissions.forEach(e => {
    const month = e.period_date ? e.period_date.substring(0, 7) : "";
    if (!monthlyMap[month]) monthlyMap[month] = { scope1: 0, scope2: 0, scope3: 0 };
    if (e.scope === 1) monthlyMap[month].scope1 += e.co2e_kg;
    else if (e.scope === 2) monthlyMap[month].scope2 += e.co2e_kg;
    else if (e.scope === 3) monthlyMap[month].scope3 += e.co2e_kg;
  });
  const MONTHLY_EMISSIONS = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, vals]) => ({
      month: new Date(month + "-01").toLocaleString("es-AR", { month: "short" }),
      ...vals,
    }));

  const maxMonthly = MONTHLY_EMISSIONS.length > 0
    ? Math.max(...MONTHLY_EMISSIONS.map(m => m.scope1 + m.scope2 + m.scope3))
    : 1;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Leaf}
        title="Huella de Carbono"
        description="Medición GHG Protocol, offsets y reporte ESG"
        actions={
          <div className="flex gap-2">
            <Dialog open={showAddEmission} onOpenChange={setShowAddEmission}>
              <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="w-4 h-4 mr-2" />Registrar Emisión</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Registrar Emisión</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div><Label>Scope</Label>
                    <Select defaultValue="2">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Scope 1 — Emisiones directas</SelectItem>
                        <SelectItem value="2">Scope 2 — Energía indirecta</SelectItem>
                        <SelectItem value="3">Scope 3 — Cadena de valor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Categoría</Label><Input placeholder="Ej: Electricidad oficina" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Cantidad</Label><Input type="number" placeholder="1000" /></div>
                    <div><Label>Unidad</Label><Input placeholder="kwh / litros / km" /></div>
                  </div>
                  <div><Label>Período</Label><Input type="month" defaultValue="2026-05" /></div>
                  <Button className="w-full" onClick={() => { toast.success("Emisión registrada"); setShowAddEmission(false); }}>Registrar</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={() => toast.info("Exportando reporte ESG...")}>
              <Download className="w-4 h-4 mr-2" />Reporte ESG
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Emisiones Brutas" value={`${(totalEmissions / 1000).toFixed(1)} t`} icon={Building} color="destructive" />
        <KPICard label="Créditos de Carbono" value={`${(totalOffsets / 1000).toFixed(1)} t`} icon={Leaf} color="success" />
        <KPICard label="Emisiones Netas" value={`${(netEmissions / 1000).toFixed(1)} t`} icon={TrendingDown} color={netEmissions > 0 ? "warning" : "success"} />
        <KPICard label="Compensación" value={`${reductionPct.toFixed(0)}%`} icon={Target} color="blue" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="emissions">Emisiones</TabsTrigger>
          <TabsTrigger value="offsets">Offsets</TabsTrigger>
          <TabsTrigger value="targets">Metas</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-4">
          {/* Scope breakdown */}
          <div className="grid grid-cols-3 gap-4">
            {([1, 2, 3] as const).map(scope => {
              const cfg = SCOPE_COLORS[scope];
              const Icon = cfg.icon;
              const val = byScope[scope] ?? 0;
              return (
                <div key={scope} className={`${cfg.bg} border border-border/40 rounded-xl p-4 flex items-center gap-3`}>
                  <Icon className={`w-8 h-8 ${cfg.color}`} />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{cfg.label}</p>
                    <p className={`text-xl font-bold ${cfg.color}`}>{(val / 1000).toFixed(2)} t CO₂e</p>
                    <p className="text-xs text-muted-foreground">{totalEmissions > 0 ? ((val / totalEmissions) * 100).toFixed(0) : 0}% del total</p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Monthly trend */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <p className="text-sm font-semibold mb-4">Emisiones Mensuales por Scope</p>
            <div className="flex items-end gap-2 h-32">
              {MONTHLY_EMISSIONS.map((m, i) => {
                const total = m.scope1 + m.scope2 + m.scope3;
                const h = (total / maxMonthly) * 100;
                const s1h = (m.scope1 / total) * h;
                const s2h = (m.scope2 / total) * h;
                const s3h = (m.scope3 / total) * h;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: "100px" }}>
                      <div className="w-full bg-blue-400/60 rounded-t-sm" style={{ height: `${s3h}px` }} />
                      <div className="w-full bg-yellow-400/60" style={{ height: `${s2h}px` }} />
                      <div className="w-full bg-red-400/60" style={{ height: `${s1h}px` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{m.month}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400/60 rounded" />S1</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-400/60 rounded" />S2</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400/60 rounded" />S3</span>
            </div>
          </div>
        </TabsContent>

        {/* EMISSIONS */}
        <TabsContent value="emissions">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left py-3 px-4">Categoría</th>
                    <th className="text-center py-3 px-4">Scope</th>
                    <th className="text-right py-3 px-4">Cantidad</th>
                    <th className="text-right py-3 px-4">CO₂e (kg)</th>
                    <th className="text-right py-3 px-4">tCO₂e</th>
                  </tr>
                </thead>
                <tbody>
                  {emissions.map((e, i) => {
                    const cfg = SCOPE_COLORS[e.scope];
                    return (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="py-3 px-4 font-medium">{e.category}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color} ${cfg.bg}`}>S{e.scope}</span>
                        </td>
                        <td className="py-3 px-4 text-right">{e.quantity.toLocaleString()} {e.unit}</td>
                        <td className="py-3 px-4 text-right">{e.co2e_kg.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-medium">{(e.co2e_kg / 1000).toFixed(3)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/30 font-bold border-t">
                    <td className="py-3 px-4">TOTAL</td>
                    <td />
                    <td />
                    <td className="py-3 px-4 text-right">{totalEmissions.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right">{(totalEmissions / 1000).toFixed(3)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OFFSETS */}
        <TabsContent value="offsets" className="space-y-4">
          <Button onClick={() => setShowAddOffset(true)}><Plus className="w-4 h-4 mr-2" />Comprar Créditos</Button>
          <div className="space-y-3">
            {offsets.map(offset => (
              <Card key={offset.id} className={offset.is_retired ? "opacity-50" : ""}>
                <CardContent className="p-4 flex items-center gap-4">
                  <span className="text-3xl">{OFFSET_ICONS[offset.offset_type]}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{offset.program_name}</span>
                      {offset.is_retired
                        ? <Badge variant="secondary" className="text-xs">Retirado</Badge>
                        : <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-xs">Activo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{offset.offset_type.replace("_", " ")} · {offset.purchase_date}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-400">{(offset.co2e_kg_offset / 1000).toFixed(1)} t CO₂e</p>
                    <p className="text-xs text-muted-foreground">${offset.cost_ars.toLocaleString()}</p>
                  </div>
                  {!offset.is_retired && (
                    <Button size="sm" variant="outline" onClick={() => toast.success("Certificado descargado")}>
                      <CheckCircle className="w-3 h-3 mr-1" />Cert.
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* TARGETS */}
        <TabsContent value="targets">
          <div className="space-y-4">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Target className="w-8 h-8 text-emerald-400" />
                  <div>
                    <h3 className="font-bold text-lg">Meta de Reducción 2030</h3>
                    <p className="text-sm text-muted-foreground">Base: 2023 (estimado 45.000 kg CO₂e anuales)</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { year: 2026, target_pct: 15, current_pct: 12 },
                    { year: 2027, target_pct: 25, current_pct: null },
                    { year: 2028, target_pct: 35, current_pct: null },
                    { year: 2029, target_pct: 45, current_pct: null },
                    { year: 2030, target_pct: 50, current_pct: null },
                  ].map(t => (
                    <div key={t.year}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{t.year}</span>
                        <span className={t.current_pct ? "text-emerald-400" : "text-muted-foreground"}>
                          {t.current_pct ? `${t.current_pct}%` : "—"} / Meta: {t.target_pct}%
                        </span>
                      </div>
                      <div className="h-3 bg-muted/30 rounded-full overflow-hidden relative">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${t.target_pct}%` }} />
                        {t.current_pct && (
                          <div className="absolute top-0 h-full bg-green-700 rounded-full" style={{ width: `${t.current_pct}%` }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1"><Globe className="w-3 h-3" />Alineado con Acuerdo de París (1.5°C)</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
