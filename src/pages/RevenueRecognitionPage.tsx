import { useState, useEffect } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrg } from "@/lib/orgContext";
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
import {
  BarChart3, DollarSign, Clock, CheckCircle, FileText,
  Plus, TrendingUp, ArrowRight, AlertCircle, Layers
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface RevenueContract {
  id: string;
  contract_number: string;
  title: string;
  customer_id: string | null;
  customer_name: string;
  total_value: number;
  currency: string;
  start_date: string;
  end_date: string | null;
  status: string;
  recognition_method: string;
  obligations: Obligation[];
}

interface Obligation {
  id: string;
  contract_id: string;
  name: string;
  allocated_price: number;
  progress_pct: number;
  fulfillment_method: string;
  is_satisfied: boolean;
  recognized_amount: number;
  deferred_amount: number;
}

interface JournalEntry {
  id: string;
  entry_date: string;
  entry_type: string;
  contract_id: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string | null;
  period_month: string;
  contract_number?: string;
}

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:     { label: "Borrador",  color: "bg-muted/40 text-muted-foreground" },
  active:    { label: "Activo",    color: "bg-emerald-500/15 text-emerald-400" },
  completed: { label: "Completo",  color: "bg-blue-500/15 text-blue-400" },
  cancelled: { label: "Cancelado", color: "bg-red-500/15 text-red-400" },
};

function ObligationRow({ ob }: { ob: Obligation }) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {ob.is_satisfied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Clock className="w-4 h-4 text-yellow-500" />}
          <span className="font-medium text-sm">{ob.name}</span>
          <span className="text-xs text-muted-foreground capitalize">({ob.fulfillment_method === "over_time" ? "Tiempo" : "Momento"})</span>
        </div>
        <span className="text-sm font-semibold">${ob.allocated_price.toLocaleString()}</span>
      </div>
      <Progress value={ob.progress_pct} className="h-2" />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="text-green-600">Reconocido: ${ob.recognized_amount.toLocaleString()}</span>
        <span>{ob.progress_pct.toFixed(1)}% completado</span>
        <span className="text-orange-600">Diferido: ${ob.deferred_amount.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function RevenueRecognitionPage() {
  usePageTitle("Reconocimiento de Ingresos");
  const { orgId } = useOrganization();
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState<"contracts" | "waterfall" | "journal" | "config">("contracts");
  const [contracts, setContracts] = useState<RevenueContract[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [waterfallData, setWaterfallData] = useState<{ month: string; new_contracts: number; recognized: number; deferred: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RevenueContract | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);

    const fetchData = async () => {
      // Fetch contracts with obligations
      const { data: contractsData } = await supabase
        .from("revenue_contracts")
        .select(`
          id, contract_number, title, customer_id, total_value, currency,
          start_date, end_date, status, recognition_method,
          performance_obligations(id, contract_id, name, allocated_price, progress_pct,
            fulfillment_method, is_satisfied, recognized_amount, deferred_amount)
        `)
        .eq("org_id", activeOrg.id)
        .order("start_date", { ascending: false });

      if (contractsData) {
        const mapped: RevenueContract[] = (contractsData as any[]).map(c => ({
          id: c.id,
          contract_number: c.contract_number,
          title: c.title,
          customer_id: c.customer_id,
          customer_name: c.customer_id ?? "—",
          total_value: Number(c.total_value),
          currency: c.currency,
          start_date: c.start_date,
          end_date: c.end_date,
          status: c.status,
          recognition_method: c.recognition_method,
          obligations: (c.performance_obligations ?? []).map((o: any) => ({
            id: o.id,
            contract_id: o.contract_id,
            name: o.name,
            allocated_price: Number(o.allocated_price),
            progress_pct: Number(o.progress_pct),
            fulfillment_method: o.fulfillment_method,
            is_satisfied: o.is_satisfied,
            recognized_amount: Number(o.recognized_amount),
            deferred_amount: Number(o.deferred_amount),
          })),
        }));
        setContracts(mapped);
      }

      // Fetch journal entries
      const { data: journalData } = await supabase
        .from("revenue_journal_entries")
        .select("id, entry_date, entry_type, contract_id, debit_account, credit_account, amount, description, period_month")
        .eq("org_id", activeOrg.id)
        .order("entry_date", { ascending: false })
        .limit(50);

      if (journalData) {
        setJournalEntries(journalData as JournalEntry[]);
      }

      // Build waterfall from journal entries grouped by period_month
      const { data: waterfallRaw } = await supabase
        .from("revenue_journal_entries")
        .select("period_month, entry_type, amount")
        .eq("org_id", activeOrg.id)
        .order("period_month", { ascending: true });

      if (waterfallRaw) {
        const byMonth: Record<string, { new_contracts: number; recognized: number }> = {};
        (waterfallRaw as any[]).forEach(row => {
          if (!byMonth[row.period_month]) byMonth[row.period_month] = { new_contracts: 0, recognized: 0 };
          if (row.entry_type === "deferred") byMonth[row.period_month].new_contracts += Number(row.amount);
          else if (row.entry_type === "recognized") byMonth[row.period_month].recognized += Number(row.amount);
        });
        let cumDeferred = 0;
        const wf = Object.entries(byMonth).slice(-6).map(([period_month, vals]) => {
          cumDeferred += vals.new_contracts - vals.recognized;
          return {
            month: new Date(period_month + "-01").toLocaleString("es-AR", { month: "short" }),
            new_contracts: vals.new_contracts,
            recognized: vals.recognized,
            deferred: Math.max(0, cumDeferred),
          };
        });
        setWaterfallData(wf);
      }

      setLoading(false);
    };

    fetchData();
  }, [activeOrg]);

  const totalContractValue = contracts.reduce((s, c) => s + c.total_value, 0);
  const totalRecognized = contracts.flatMap(c => c.obligations).reduce((s, o) => s + o.recognized_amount, 0);
  const totalDeferred = contracts.flatMap(c => c.obligations).reduce((s, o) => s + o.deferred_amount, 0);

  const maxWaterfall = waterfallData.length > 0
    ? Math.max(...waterfallData.map(d => d.deferred))
    : 1;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={DollarSign}
        title="Reconocimiento de Ingresos"
        description="ASC 606 / IFRS 15 — Contratos, obligaciones de desempeño y diferidos"
        actions={
          <Dialog open={showNew} onOpenChange={setShowNew}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Nuevo Contrato</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo Contrato</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div><Label>N° Contrato</Label><Input placeholder="CON-2026-XXX" /></div>
                <div><Label>Título</Label><Input placeholder="Descripción del contrato" /></div>
                <div><Label>Cliente</Label><Input placeholder="Nombre del cliente" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Valor Total (ARS)</Label><Input type="number" placeholder="500000" /></div>
                  <div><Label>Método de Reconocimiento</Label>
                    <Select defaultValue="over_time">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="over_time">En el tiempo</SelectItem>
                        <SelectItem value="point_in_time">En un momento</SelectItem>
                        <SelectItem value="milestone">Por hitos</SelectItem>
                        <SelectItem value="percentage_completion">% Completado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" onClick={() => { toast.success("Contrato creado"); setShowNew(false); }}>Crear Contrato</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KPICard label="Valor Total Contratos" value={`$${(totalContractValue / 1_000_000).toFixed(2)}M`} sub="contratos activos" icon={FileText} color="primary" />
        <KPICard label="Revenue Reconocido" value={`$${(totalRecognized / 1000).toFixed(0)}K`} sub="reconocido a la fecha" icon={CheckCircle} color="success" />
        <KPICard label="Revenue Diferido" value={`$${(totalDeferred / 1_000_000).toFixed(2)}M`} sub="por reconocer" icon={Clock} color="warning" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="contracts">Contratos</TabsTrigger>
          <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
          <TabsTrigger value="journal">Diario Contable</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        {/* CONTRACTS */}
        <TabsContent value="contracts" className="space-y-3 pb-12">
          {contracts.map(contract => {
            const recognized = contract.obligations.reduce((s, o) => s + o.recognized_amount, 0);
            const pct = contract.total_value > 0 ? (recognized / contract.total_value) * 100 : 0;
            return (
              <Card key={contract.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(contract)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">{contract.contract_number}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CFG[contract.status]?.color}`}>{STATUS_CFG[contract.status]?.label}</span>
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded capitalize">{contract.recognition_method.replace("_"," ")}</span>
                      </div>
                      <h3 className="font-semibold mt-1">{contract.title}</h3>
                      <p className="text-sm text-muted-foreground">{contract.customer_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">${(contract.total_value / 1000).toFixed(0)}K</p>
                      <p className="text-xs text-muted-foreground">{contract.obligations.length} obligaciones</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-green-600">Reconocido: ${(recognized / 1000).toFixed(0)}K</span>
                      <span>{pct.toFixed(1)}%</span>
                      <span className="text-orange-600">Diferido: ${((contract.total_value - recognized) / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* WATERFALL */}
        <TabsContent value="waterfall">
          <Card>
            <CardHeader><CardTitle className="text-base">Saldo de Revenue Diferido — Evolución</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm mb-6">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4">Mes</th>
                      <th className="text-right py-2 px-3">Nuevos contratos</th>
                      <th className="text-right py-2 px-3">Reconocido</th>
                      <th className="text-right py-2 px-3">Saldo Diferido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waterfallData.map((d, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{d.month}</td>
                        <td className="py-2 px-3 text-right text-green-600">+${(d.new_contracts / 1000).toFixed(0)}K</td>
                        <td className="py-2 px-3 text-right text-orange-600">-${(d.recognized / 1000).toFixed(0)}K</td>
                        <td className="py-2 px-3 text-right font-bold">${(d.deferred / 1_000_000).toFixed(2)}M</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Bar chart */}
              <div className="flex items-end gap-2 h-32">
                {WATERFALL_DATA.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                    <div className="w-full flex flex-col gap-0.5">
                      <div className="w-full rounded-t-sm bg-orange-300" style={{ height: `${(d.deferred / maxWaterfall) * 100}px`, maxHeight: "100px" }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{d.month}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* JOURNAL */}
        <TabsContent value="journal">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left py-3 px-4">Fecha</th>
                    <th className="text-left py-3 px-4">Tipo</th>
                    <th className="text-left py-3 px-4">Contrato</th>
                    <th className="text-left py-3 px-4">Débito</th>
                    <th className="text-left py-3 px-4">Crédito</th>
                    <th className="text-right py-3 px-4">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { date: "2026-05-31", type: "recognized", contract: "CON-2026-001", debit: "Ingresos Diferidos", credit: "Revenue SaaS", amount: 75_000 },
                    { date: "2026-05-01", type: "deferred", contract: "CON-2026-001", debit: "Cuentas a Cobrar", credit: "Ingresos Diferidos", amount: 100_000 },
                    { date: "2026-04-30", type: "recognized", contract: "CON-2026-002", debit: "Ingresos Diferidos", credit: "Revenue Consultoría", amount: 112_500 },
                    { date: "2026-03-01", type: "deferred", contract: "CON-2026-003", debit: "Cuentas a Cobrar", credit: "Ingresos Diferidos", amount: 240_000 },
                  ].map((entry, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-3 px-4 text-muted-foreground">{entry.date}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${entry.type === "recognized" ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400"}`}>
                          {entry.type === "recognized" ? "Reconocido" : "Diferido"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{entry.contract}</td>
                      <td className="py-3 px-4 text-sm">{entry.debit}</td>
                      <td className="py-3 px-4 text-sm">{entry.credit}</td>
                      <td className="py-3 px-4 text-right font-medium">${entry.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONFIG */}
        <TabsContent value="config">
          <Card className="max-w-lg">
            <CardHeader><CardTitle className="text-sm">Estándar Contable</CardTitle></CardHeader>
            <CardContent className="space-y-4 pb-12">
              {[
                { key: "ASC606", label: "ASC 606 (US GAAP)", desc: "Para empresas con reportes bajo normas americanas" },
                { key: "IFRS15", label: "IFRS 15 (Internacional)", desc: "Para empresas argentinas con reportes internacionales" },
                { key: "RT17", label: "RT 17 (Argentina)", desc: "Resolución Técnica 17 — norma contable argentina" },
              ].map((std, i) => (
                <div key={i} className={`p-3 rounded-lg border cursor-pointer transition-all ${i === 1 ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                  <p className="font-medium text-sm">{std.label}</p>
                  <p className="text-xs text-muted-foreground">{std.desc}</p>
                </div>
              ))}
              <Button className="w-full" onClick={() => toast.success("Configuración guardada")}>Guardar</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Contract detail */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{selected.contract_number}</span>
                <CardTitle className="text-base">{selected.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{selected.customer_name}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-3 pb-12">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Valor Total</p><p className="font-bold">${selected.total_value.toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Período</p><p>{selected.start_date} → {selected.end_date ?? "Indefinido"}</p></div>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Obligaciones de Desempeño</p>
                <div className="space-y-2 pb-12">
                  {selected.obligations.map(ob => <ObligationRow key={ob.id} ob={ob} />)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
