import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Trash2, Plus, AlertTriangle, CheckCircle, BarChart3, Package, Loader2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface WasteCategory {
  id: string;
  name: string;
  waste_type: string;
  active: boolean;
}

interface WasteRecord {
  id: string;
  category_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  date: string;
  reason: string | null;
  reported_by: string | null;
  location: string | null;
  approved: boolean;
  approved_by: string | null;
  notes: string | null;
  waste_categories?: { name: string; waste_type: string } | null;
}

interface WasteSummary {
  category_name: string;
  waste_type: string;
  record_count: number;
  total_qty: number;
  total_cost: number;
}

interface Product {
  id: string;
  name: string;
  cost_price: number;
  unit: string;
}

const WASTE_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  spoilage:       { label: "Deterioro",      color: "bg-orange-500/15 text-orange-400" },
  damage:         { label: "Daño/Rotura",    color: "bg-red-500/15 text-red-400" },
  theft:          { label: "Hurto",          color: "bg-purple-500/15 text-purple-400" },
  expiry:         { label: "Vencimiento",    color: "bg-yellow-500/15 text-yellow-400" },
  production:     { label: "Producción",     color: "bg-blue-500/15 text-blue-400" },
  administrative: { label: "Administrativo", color: "bg-muted/40 text-muted-foreground" },
  other:          { label: "Otro",           color: "bg-muted/40 text-muted-foreground" },
};

const EMPTY_RECORD = {
  category_id: "", product_id: "", product_name: "",
  quantity: 0, unit_cost: 0, date: new Date().toISOString().split("T")[0],
  reason: "", reported_by: "", location: "", notes: ""
};

export default function WasteControlPage() {
  usePageTitle("Control de Mermas");
  const { orgId } = useOrganization();

  const [categories, setCategories]   = useState<WasteCategory[]>([]);
  const [records, setRecords]         = useState<WasteRecord[]>([]);
  const [summary, setSummary]         = useState<WasteSummary[]>([]);
  const [products, setProducts]       = useState<Product[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState("records");
  const [seeding, setSeeding]         = useState(false);

  const [recordOpen, setRecordOpen]   = useState(false);
  const [recordForm, setRecordForm]   = useState({ ...EMPTY_RECORD });
  const [savingRecord, setSavingRecord] = useState(false);

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [approvedFilter, setApprovedFilter] = useState("all");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [catRes, recRes, sumRes, prodRes] = await Promise.allSettled([
      supabase.from("waste_categories").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("waste_records").select("*, waste_categories(name, waste_type)").eq("org_id", orgId).order("date", { ascending: false }),
      supabase.rpc("get_waste_summary", { p_org_id: orgId, p_from: fromDate, p_to: toDate }),
      supabase.from("products").select("id, name, cost_price, unit").eq("org_id", orgId).order("name"),
    ]);
    if (catRes.status === "fulfilled" && catRes.value.data) setCategories(catRes.value.data as WasteCategory[]);
    if (recRes.status === "fulfilled" && recRes.value.data) setRecords(recRes.value.data as WasteRecord[]);
    if (sumRes.status === "fulfilled" && sumRes.value.data) setSummary(sumRes.value.data as WasteSummary[]);
    if (prodRes.status === "fulfilled" && prodRes.value.data) setProducts(prodRes.value.data as Product[]);
    setLoading(false);
  }, [orgId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  async function seedCategories() {
    if (!orgId) return;
    setSeeding(true);
    const { error } = await supabase.rpc("seed_waste_categories", { p_org_id: orgId });
    setSeeding(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Categorías de merma cargadas");
    load();
  }

  async function saveRecord() {
    if (!orgId) return;
    if (!recordForm.product_name.trim()) return toast.error("Ingresá el nombre del producto");
    if (Number(recordForm.quantity) <= 0) return toast.error("Ingresá la cantidad");
    setSavingRecord(true);
    const { error } = await supabase.from("waste_records").insert({
      org_id: orgId,
      category_id: recordForm.category_id || null,
      product_id: recordForm.product_id || null,
      product_name: recordForm.product_name.trim(),
      quantity: Number(recordForm.quantity),
      unit_cost: Number(recordForm.unit_cost),
      date: recordForm.date,
      reason: recordForm.reason || null,
      reported_by: recordForm.reported_by || null,
      location: recordForm.location || null,
      notes: recordForm.notes || null,
    });
    setSavingRecord(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Merma registrada");
    setRecordOpen(false);
    setRecordForm({ ...EMPTY_RECORD });
    load();
  }

  async function approveRecord(id: string) {
    const { error } = await supabase.from("waste_records").update({
      approved: true, approved_at: new Date().toISOString()
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Merma aprobada");
    load();
  }

  function selectProduct(productId: string) {
    const prod = products.find(p => p.id === productId);
    if (prod) setRecordForm(f => ({ ...f, product_id: prod.id, product_name: prod.name, unit_cost: prod.cost_price ?? 0 }));
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredRecords = records.filter(r => {
    if (typeFilter !== "all" && r.waste_categories?.waste_type !== typeFilter) return false;
    if (approvedFilter === "pending" && r.approved) return false;
    if (approvedFilter === "approved" && !r.approved) return false;
    return true;
  });

  const totalCost = records.reduce((s, r) => s + Number(r.total_cost), 0);
  const pendingApproval = records.filter(r => !r.approved).length;
  const thisMonthCost = records
    .filter(r => r.date.startsWith(new Date().toISOString().substring(0, 7)))
    .reduce((s, r) => s + Number(r.total_cost), 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="Control de Mermas"
        description="Registro y análisis de pérdidas, mermas y desperdicios"
        actions={
          <div className="flex gap-2">
            {categories.length === 0 && (
              <Button variant="outline" onClick={seedCategories} disabled={seeding}>
                {seeding ? "Cargando..." : "Cargar categorías"}
              </Button>
            )}
            <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setRecordForm({ ...EMPTY_RECORD })}>
                <Plus className="w-4 h-4 mr-2" /> Registrar merma
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Registrar merma / pérdida</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Categoría</Label>
                  <Select value={recordForm.category_id} onValueChange={v => setRecordForm(f => ({ ...f, category_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => {
                        const tc = WASTE_TYPE_CONFIG[c.waste_type];
                        return <SelectItem key={c.id} value={c.id}>{c.name} ({tc?.label})</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Producto del sistema</Label>
                  <Select value={recordForm.product_id} onValueChange={selectProduct}>
                    <SelectTrigger><SelectValue placeholder="Buscar producto (opcional)" /></SelectTrigger>
                    <SelectContent>
                      {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nombre del producto *</Label>
                  <Input value={recordForm.product_name} onChange={e => setRecordForm(f => ({ ...f, product_name: e.target.value }))} placeholder="Nombre del artículo" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Cantidad *</Label>
                    <Input type="number" min={0} step={0.001} value={recordForm.quantity} onChange={e => setRecordForm(f => ({ ...f, quantity: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Costo unitario</Label>
                    <Input type="number" min={0} value={recordForm.unit_cost} onChange={e => setRecordForm(f => ({ ...f, unit_cost: Number(e.target.value) }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Fecha</Label>
                    <Input type="date" value={recordForm.date} onChange={e => setRecordForm(f => ({ ...f, date: e.target.value }))} />
                  </div>
                </div>
                {recordForm.quantity > 0 && recordForm.unit_cost > 0 && (
                  <div className="bg-red-50 rounded p-2 text-sm text-red-800 font-medium">
                    Pérdida estimada: {fmt(Number(recordForm.quantity) * Number(recordForm.unit_cost))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Reportado por</Label>
                    <Input value={recordForm.reported_by} onChange={e => setRecordForm(f => ({ ...f, reported_by: e.target.value }))} placeholder="Nombre del empleado" />
                  </div>
                  <div className="space-y-1">
                    <Label>Ubicación</Label>
                    <Input value={recordForm.location} onChange={e => setRecordForm(f => ({ ...f, location: e.target.value }))} placeholder="Depósito, Sala fría..." />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Motivo</Label>
                  <Input value={recordForm.reason} onChange={e => setRecordForm(f => ({ ...f, reason: e.target.value }))} placeholder="Descripción del motivo..." />
                </div>
                <div className="space-y-1">
                  <Label>Notas adicionales</Label>
                  <Textarea value={recordForm.notes} onChange={e => setRecordForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                </div>
                <Button className="w-full" onClick={saveRecord} disabled={savingRecord}>
                  {savingRecord ? "Guardando..." : "Registrar merma"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total pérdidas" value={fmt(totalCost)} icon={Trash2} color="destructive" />
        <KPICard label="Este mes" value={fmt(thisMonthCost)} icon={Package} color="warning" />
        <KPICard label="Sin aprobar" value={pendingApproval} icon={AlertTriangle} color="warning" sub="pendientes de revisión" />
        <KPICard label="Total registros" value={records.length} icon={BarChart3} color="primary" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="records">Registros ({records.length})</TabsTrigger>
          <TabsTrigger value="summary">Análisis por categoría</TabsTrigger>
        </TabsList>

        {/* RECORDS */}
        <TabsContent value="records" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Tipo de merma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {Object.entries(WASTE_TYPE_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={approvedFilter} onValueChange={setApprovedFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="approved">Aprobados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <Trash2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay registros de merma</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Fecha</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Categoría</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Producto</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Cantidad</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Costo/u</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Pérdida</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Reportado por</th>
                    <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Estado</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(r => {
                    const tc = WASTE_TYPE_CONFIG[r.waste_categories?.waste_type ?? "other"] ?? WASTE_TYPE_CONFIG.other;
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/20">
                        <td className="py-2 px-3 text-muted-foreground">{new Date(r.date).toLocaleDateString("es-AR")}</td>
                        <td className="py-2 px-3">
                          {r.waste_categories ? (
                            <Badge className={`text-xs ${tc.color}`}>{r.waste_categories.name}</Badge>
                          ) : <span className="text-muted-foreground/70 text-xs">—</span>}
                        </td>
                        <td className="py-2 px-3 text-foreground">{r.product_name}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{Number(r.quantity).toLocaleString("es-AR")}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{fmt(r.unit_cost)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-red-700">{fmt(r.total_cost)}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.reported_by ?? "—"}</td>
                        <td className="py-2 px-3 text-center">
                          {r.approved
                            ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle className="w-3 h-3" /> Aprobado</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-yellow-700"><AlertTriangle className="w-3 h-3" /> Pendiente</span>}
                        </td>
                        <td className="py-2 px-3">
                          {!r.approved && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-green-700" onClick={() => approveRecord(r.id)}>
                              Aprobar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* SUMMARY */}
        <TabsContent value="summary" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" className="h-8 w-36" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" className="h-8 w-36" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" className="h-8" onClick={load}>Actualizar</Button>
          </div>

          {summary.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Sin datos para el período seleccionado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {summary.map((s, idx) => {
                const tc = WASTE_TYPE_CONFIG[s.waste_type] ?? WASTE_TYPE_CONFIG.other;
                const maxCost = summary[0]?.total_cost ?? 1;
                const pct = (Number(s.total_cost) / Number(maxCost)) * 100;
                return (
                  <div key={idx} className="bg-card border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${tc.color}`}>{tc.label}</Badge>
                        <span className="font-medium text-foreground">{s.category_name}</span>
                        <span className="text-xs text-muted-foreground/70">({s.record_count} registros)</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-red-700">{fmt(Number(s.total_cost))}</p>
                        <p className="text-xs text-muted-foreground/70">{Number(s.total_qty).toLocaleString("es-AR")} unidades</p>
                      </div>
                    </div>
                    <div className="w-full bg-muted/40 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
