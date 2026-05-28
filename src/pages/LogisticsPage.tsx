import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
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
import { PageHeader } from "@/components/shared/PageHeader";
import { KPICard } from "@/components/shared/KPICard";
import {
  Truck, Package, MapPin, Plus, CheckCircle, Clock, AlertCircle,
  XCircle, RotateCcw, TrendingUp, Star, Navigation, Zap, Loader2
} from "lucide-react";

interface Carrier {
  id: string;
  name: string;
  code: string;
  carrier_type: string;
  is_active: boolean;
  avg_days: number;
  max_weight_kg: number | null;
}

interface Shipment {
  id: string;
  tracking_number: string | null;
  status: string;
  order_ref: string | null;
  shipping_cost: number;
  weight_kg: number;
  estimated_delivery: string | null;
  actual_delivery: string | null;
  dest_address: Record<string, string>;
  created_at: string;
}

interface CarrierPerf {
  carrier_id: string;
  carrier_name: string;
  total_shipments: number;
  on_time: number;
  late: number;
  returned: number;
  on_time_rate: number;
  avg_days: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Package }> = {
  pending:            { label: "Pendiente",        color: "bg-muted/40 text-muted-foreground",    icon: Clock },
  label_created:      { label: "Etiqueta",         color: "bg-blue-500/15 text-blue-400",         icon: Package },
  picked_up:          { label: "Retirado",         color: "bg-indigo-500/15 text-indigo-400",     icon: Truck },
  in_transit:         { label: "En Tránsito",      color: "bg-yellow-500/15 text-yellow-400",     icon: Navigation },
  out_for_delivery:   { label: "En Reparto",       color: "bg-orange-500/15 text-orange-400",     icon: Zap },
  delivered:          { label: "Entregado",        color: "bg-emerald-500/15 text-emerald-400",   icon: CheckCircle },
  failed:             { label: "Falló",            color: "bg-red-500/15 text-red-400",           icon: XCircle },
  returned:           { label: "Devuelto",         color: "bg-purple-500/15 text-purple-400",     icon: RotateCcw },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted/40 text-muted-foreground", icon: Package };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function OnTimeBar({ rate }: { rate: number }) {
  const color = rate >= 90 ? "bg-green-500" : rate >= 70 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs w-10 text-right font-medium">{rate?.toFixed(1)}%</span>
    </div>
  );
}


export default function LogisticsPage() {
  usePageTitle("Logística & Envíos");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"shipments" | "carriers" | "zones" | "performance">("shipments");
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [perf, setPerf] = useState<CarrierPerf[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showNewShipment, setShowNewShipment] = useState(false);
  const [selected, setSelected] = useState<Shipment | null>(null);

  // New shipment form
  const [form, setForm] = useState({ carrier_id: "", order_ref: "", weight_kg: "", dest_city: "", dest_province: "" });

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("carriers")
        .select("id, name, code, carrier_type, is_active, avg_days, max_weight_kg")
        .eq("org_id", orgId)
        .order("name"),
      supabase
        .from("shipments")
        .select("id, tracking_number, status, order_ref, shipping_cost, weight_kg, estimated_delivery, actual_delivery, dest_address, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      supabase.rpc("get_carrier_performance", { p_org_id: orgId, p_days: 30 }),
    ]).then(([carriersRes, shipmentsRes, perfRes]) => {
      if (carriersRes.error) toast.error("Error cargando transportistas");
      else setCarriers((carriersRes.data ?? []) as Carrier[]);

      if (shipmentsRes.error) toast.error("Error cargando envíos");
      else setShipments((shipmentsRes.data ?? []) as Shipment[]);

      if (perfRes.error) toast.error("Error cargando performance");
      else setPerf((perfRes.data ?? []) as CarrierPerf[]);

      setLoading(false);
    });
  }, [orgId]);

  const filtered = shipments.filter(s => {
    const matchSearch = !search || s.tracking_number?.toLowerCase().includes(search.toLowerCase()) || s.order_ref?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = () => {
    if (!form.carrier_id || !form.order_ref) { toast.error("Completá transportista y orden"); return; }
    const carrier = carriers.find(c => c.id === form.carrier_id);
    const newShipment: Shipment = {
      id: `s${Date.now()}`,
      tracking_number: null,
      status: "pending",
      order_ref: form.order_ref,
      shipping_cost: 800,
      weight_kg: parseFloat(form.weight_kg) || 1,
      estimated_delivery: null,
      actual_delivery: null,
      dest_address: { city: form.dest_city, province: form.dest_province },
      created_at: new Date().toISOString(),
    };
    setShipments(prev => [newShipment, ...prev]);
    toast.success("Envío creado");
    setShowNewShipment(false);
    setForm({ carrier_id: "", order_ref: "", weight_kg: "", dest_city: "", dest_province: "" });
  };

  const advance = (shipment: Shipment) => {
    const order: Shipment["status"][] = ["pending","label_created","picked_up","in_transit","out_for_delivery","delivered"];
    const idx = order.indexOf(shipment.status as Shipment["status"]);
    if (idx < 0 || idx >= order.length - 1) return;
    setShipments(prev => prev.map(s => s.id === shipment.id ? { ...s, status: order[idx + 1] } : s));
    toast.success(`Estado actualizado a: ${STATUS_CONFIG[order[idx + 1]]?.label}`);
  };

  const stats = {
    total: shipments.length,
    in_transit: shipments.filter(s => ["in_transit","out_for_delivery","picked_up"].includes(s.status)).length,
    delivered: shipments.filter(s => s.status === "delivered").length,
    pending: shipments.filter(s => s.status === "pending").length,
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Logística & Envíos"
        description="Gestión de transportistas, zonas y seguimiento de envíos"
        actions={
          <Dialog open={showNewShipment} onOpenChange={setShowNewShipment}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Nuevo Envío</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Crear Envío</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Transportista</Label>
                  <Select value={form.carrier_id} onValueChange={v => setForm(f => ({ ...f, carrier_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {carriers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} — {c.avg_days}d</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>N° de Orden</Label>
                  <Input value={form.order_ref} onChange={e => setForm(f => ({ ...f, order_ref: e.target.value }))} placeholder="ORD-001234" />
                </div>
                <div>
                  <Label>Peso (kg)</Label>
                  <Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} placeholder="1.5" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Ciudad</Label>
                    <Input value={form.dest_city} onChange={e => setForm(f => ({ ...f, dest_city: e.target.value }))} placeholder="Buenos Aires" />
                  </div>
                  <div>
                    <Label>Provincia</Label>
                    <Input value={form.dest_province} onChange={e => setForm(f => ({ ...f, dest_province: e.target.value }))} placeholder="CABA" />
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreate}>Crear Envío</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Total Envíos" value={stats.total} icon={Package} color="primary" />
        <KPICard label="En Tránsito" value={stats.in_transit} icon={Truck} color="warning" />
        <KPICard label="Entregados" value={stats.delivered} icon={CheckCircle} color="success" />
        <KPICard label="Pendientes" value={stats.pending} icon={Clock} color="blue" />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="shipments">Envíos</TabsTrigger>
          <TabsTrigger value="carriers">Transportistas</TabsTrigger>
          <TabsTrigger value="zones">Zonas</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* SHIPMENTS */}
        <TabsContent value="shipments" className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Buscar tracking o N° orden..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {filtered.map(s => (
              <Card key={s.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(s)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.order_ref ?? "—"}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.tracking_number ?? "Sin tracking"} · {s.dest_address?.city}, {s.dest_address?.province}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium">${s.shipping_cost.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{s.weight_kg} kg</p>
                  </div>
                  {["pending","label_created","picked_up","in_transit","out_for_delivery"].includes(s.status) && (
                    <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); advance(s); }}>
                      Avanzar
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No hay envíos que coincidan</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* CARRIERS */}
        <TabsContent value="carriers" className="space-y-3">
          {carriers.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline" className="text-xs">{c.code}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{c.carrier_type}</Badge>
                    {c.is_active ? <Badge className="bg-green-100 text-green-700 text-xs">Activo</Badge> : <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tiempo promedio: {c.avg_days} días · Peso máx: {c.max_weight_kg ? `${c.max_weight_kg} kg` : "Ilimitado"}
                  </p>
                </div>
                <Button size="sm" variant="outline">Configurar</Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ZONES */}
        <TabsContent value="zones">
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { name: "CABA y GBA", provinces: ["CABA", "Buenos Aires"], color: "bg-blue-50 border-blue-200" },
                  { name: "Centro", provinces: ["Córdoba", "Santa Fe", "Entre Ríos"], color: "bg-green-50 border-green-200" },
                  { name: "Cuyo", provinces: ["Mendoza", "San Juan", "San Luis"], color: "bg-yellow-50 border-yellow-200" },
                  { name: "NOA", provinces: ["Tucumán", "Salta", "Jujuy", "Catamarca", "La Rioja"], color: "bg-orange-50 border-orange-200" },
                  { name: "NEA", provinces: ["Chaco", "Corrientes", "Misiones", "Formosa"], color: "bg-purple-50 border-purple-200" },
                  { name: "Patagonia", provinces: ["Neuquén", "Río Negro", "Chubut", "Santa Cruz", "Tierra del Fuego"], color: "bg-pink-50 border-pink-200" },
                ].map(zone => (
                  <div key={zone.name} className={`rounded-lg border p-4 ${zone.color}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">{zone.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {zone.provinces.map(p => <span key={p} className="text-xs bg-card/70 px-1.5 py-0.5 rounded border border-border/30">{p}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PERFORMANCE */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Performance por Transportista — Últimos 30 días</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground text-xs border-b">
                    <th className="pb-2">Transportista</th>
                    <th className="pb-2 text-right">Envíos</th>
                    <th className="pb-2 text-right">A Tiempo</th>
                    <th className="pb-2 text-right">Tardíos</th>
                    <th className="pb-2 text-right">Devueltos</th>
                    <th className="pb-2">Tasa A Tiempo</th>
                    <th className="pb-2 text-right">Días Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.map(p => (
                    <tr key={p.carrier_id} className="border-b last:border-0">
                      <td className="py-3 font-medium">{p.carrier_name}</td>
                      <td className="py-3 text-right">{p.total_shipments}</td>
                      <td className="py-3 text-right text-green-600">{p.on_time}</td>
                      <td className="py-3 text-right text-yellow-600">{p.late}</td>
                      <td className="py-3 text-right text-red-600">{p.returned}</td>
                      <td className="py-3 w-40"><OnTimeBar rate={p.on_time_rate} /></td>
                      <td className="py-3 text-right">{p.avg_days}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Shipment detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Detalle de Envío</CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.status} />
                <span className="text-sm font-mono">{selected.tracking_number ?? "Sin tracking"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Orden</p><p className="font-medium">{selected.order_ref}</p></div>
                <div><p className="text-xs text-muted-foreground">Costo</p><p className="font-medium">${selected.shipping_cost.toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Peso</p><p className="font-medium">{selected.weight_kg} kg</p></div>
                <div><p className="text-xs text-muted-foreground">Destino</p><p className="font-medium">{selected.dest_address?.city}, {selected.dest_address?.province}</p></div>
                <div><p className="text-xs text-muted-foreground">Entrega Estimada</p><p className="font-medium">{selected.estimated_delivery ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Entrega Real</p><p className="font-medium">{selected.actual_delivery ? new Date(selected.actual_delivery).toLocaleDateString("es-AR") : "—"}</p></div>
              </div>
              {/* Timeline */}
              <div className="mt-2">
                <p className="text-xs font-semibold text-muted-foreground mb-2">ESTADOS</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {["pending","label_created","picked_up","in_transit","out_for_delivery","delivered"].map((st, i) => {
                    const order = ["pending","label_created","picked_up","in_transit","out_for_delivery","delivered"];
                    const currentIdx = order.indexOf(selected.status);
                    const done = i <= currentIdx;
                    return (
                      <div key={st} className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${done ? "bg-primary" : "bg-muted"}`} />
                        {i < 5 && <div className={`h-0.5 w-4 ${done && i < currentIdx ? "bg-primary" : "bg-muted"}`} />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Pendiente</span><span>Entregado</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
