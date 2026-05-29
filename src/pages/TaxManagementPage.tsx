import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Receipt, Plus, TrendingUp, AlertCircle, CheckCircle,
  Clock, FileText, Building2, DollarSign, Percent, Scale, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface TaxRate {
  id: string;
  name: string;
  rate_pct: number;
  tax_type: string;
  applies_to: string;
  jurisdiction: string | null;
  code: string | null;
  active: boolean;
}

interface TaxDeclaration {
  id: string;
  tax_rate_id: string;
  period_type: string;
  year: number;
  period: number;
  taxable_base: number;
  tax_collected: number;
  tax_paid: number;
  tax_balance: number;
  status: string;
  due_date: string | null;
  filed_at: string | null;
  paid_at: string | null;
  declaration_number: string | null;
  notes: string | null;
  created_at: string;
  tax_rates?: { name: string; tax_type: string } | null;
}

interface WithholdingRecord {
  id: string;
  withholding_type: string;
  counterpart_name: string;
  counterpart_cuit: string | null;
  amount: number;
  rate_pct: number;
  base_amount: number;
  direction: string;
  date: string;
  certificate_number: string | null;
  reference_type: string | null;
  notes: string | null;
  created_at: string;
}

interface IibbRegistration {
  id: string;
  province: string;
  regime: string;
  cuit: string | null;
  registration_number: string | null;
  rate_pct: number;
  active: boolean;
}

const TAX_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  iva:         { label: "IVA",         color: "bg-blue-500/15 text-blue-400" },
  iibb:        { label: "IIBB",        color: "bg-purple-500/15 text-purple-400" },
  ganancias:   { label: "Ganancias",   color: "bg-orange-500/15 text-orange-400" },
  monotributo: { label: "Monotributo", color: "bg-emerald-500/15 text-emerald-400" },
  sellos:      { label: "Sellos",      color: "bg-yellow-500/15 text-yellow-400" },
  municipal:   { label: "Municipal",   color: "bg-muted/40 text-foreground" },
  otro:        { label: "Otro",        color: "bg-muted/40 text-muted-foreground" },
};

const DECL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:    { label: "Borrador", color: "bg-muted/40 text-foreground/80",    icon: <FileText className="w-3 h-3" /> },
  filed:    { label: "Presentada",  color: "bg-blue-500/15 text-blue-400",     icon: <CheckCircle className="w-3 h-3" /> },
  paid:     { label: "Pagada",      color: "bg-emerald-500/15 text-emerald-400", icon: <CheckCircle className="w-3 h-3" /> },
  amended:  { label: "Rectificada", color: "bg-orange-500/15 text-orange-400",  icon: <AlertCircle className="w-3 h-3" /> },
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const EMPTY_DECL = {
  tax_rate_id: "", period_type: "monthly" as string, year: new Date().getFullYear(),
  period: new Date().getMonth() + 1, taxable_base: 0, tax_collected: 0,
  tax_paid: 0, due_date: "", declaration_number: "", notes: ""
};

const EMPTY_WITHHOLDING = {
  withholding_type: "iva" as string, counterpart_name: "", counterpart_cuit: "",
  amount: 0, rate_pct: 0, base_amount: 0, direction: "suffered" as string,
  date: new Date().toISOString().split("T")[0], certificate_number: "",
  reference_type: "", notes: ""
};

const EMPTY_RATE = {
  name: "", rate_pct: 0, tax_type: "iva" as string, applies_to: "sales" as string,
  jurisdiction: "", code: ""
};

export default function TaxManagementPage() {
  usePageTitle("Gestión Impositiva");
  const { orgId } = useOrganization();

  const [taxRates, setTaxRates]         = useState<TaxRate[]>([]);
  const [declarations, setDeclarations] = useState<TaxDeclaration[]>([]);
  const [withholdings, setWithholdings] = useState<WithholdingRecord[]>([]);
  const [iibbRegs, setIibbRegs]         = useState<IibbRegistration[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState("declarations");
  const [seeding, setSeeding]           = useState(false);

  // Declaration dialog
  const [declOpen, setDeclOpen] = useState(false);
  const [declForm, setDeclForm] = useState({ ...EMPTY_DECL });
  const [savingDecl, setSavingDecl] = useState(false);
  const [editDecl, setEditDecl] = useState<TaxDeclaration | null>(null);

  // Withholding dialog
  const [withOpen, setWithOpen] = useState(false);
  const [withForm, setWithForm] = useState({ ...EMPTY_WITHHOLDING });
  const [savingWith, setSavingWith] = useState(false);

  // Rate dialog
  const [rateOpen, setRateOpen] = useState(false);
  const [rateForm, setRateForm] = useState({ ...EMPTY_RATE });
  const [savingRate, setSavingRate] = useState(false);

  // Filters
  const [yearFilter, setYearFilter]   = useState(new Date().getFullYear());
  const [typeFilter, setTypeFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [withTypeFilter, setWithTypeFilter] = useState("all");
  const [withDirFilter, setWithDirFilter]   = useState("all");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [ratesRes, declRes, withRes, iibbRes] = await Promise.allSettled([
      supabase.from("tax_rates").select("*").eq("org_id", orgId).order("name"),
      supabase.from("tax_declarations").select("*, tax_rates(name, tax_type)").eq("org_id", orgId).order("year", { ascending: false }).order("period", { ascending: false }),
      supabase.from("withholding_records").select("*").eq("org_id", orgId).order("date", { ascending: false }),
      supabase.from("iibb_registrations").select("*").eq("org_id", orgId).order("province"),
    ]);
    if (ratesRes.status === "fulfilled" && ratesRes.value.data) setTaxRates(ratesRes.value.data as TaxRate[]);
    if (declRes.status === "fulfilled" && declRes.value.data) setDeclarations(declRes.value.data as TaxDeclaration[]);
    if (withRes.status === "fulfilled" && withRes.value.data) setWithholdings(withRes.value.data as WithholdingRecord[]);
    if (iibbRes.status === "fulfilled" && iibbRes.value.data) setIibbRegs(iibbRes.value.data as IibbRegistration[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function seedRates() {
    if (!orgId) return;
    setSeeding(true);
    const { error } = await supabase.rpc("seed_tax_rates", { p_org_id: orgId });
    setSeeding(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Alícuotas argentinas cargadas correctamente");
    load();
  }

  async function saveDeclaration() {
    if (!orgId || !declForm.tax_rate_id) return toast.error("Seleccioná una alícuota");
    setSavingDecl(true);

    const payload = {
      org_id: orgId,
      tax_rate_id: declForm.tax_rate_id,
      period_type: declForm.period_type,
      year: Number(declForm.year),
      period: Number(declForm.period),
      taxable_base: Number(declForm.taxable_base),
      tax_collected: Number(declForm.tax_collected),
      tax_paid: Number(declForm.tax_paid),
      due_date: declForm.due_date || null,
      declaration_number: declForm.declaration_number || null,
      notes: declForm.notes || null,
    };

    let error;
    if (editDecl) {
      ({ error } = await supabase.from("tax_declarations").update(payload).eq("id", editDecl.id));
    } else {
      ({ error } = await supabase.from("tax_declarations").insert(payload));
    }

    setSavingDecl(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editDecl ? "Declaración actualizada" : "Declaración creada");
    setDeclOpen(false);
    setEditDecl(null);
    setDeclForm({ ...EMPTY_DECL });
    load();
  }

  async function updateDeclStatus(id: string, status: string) {
    const extra: Record<string, string | null> = {};
    if (status === "filed") extra.filed_at = new Date().toISOString();
    if (status === "paid") extra.paid_at = new Date().toISOString();
    const { error } = await supabase.from("tax_declarations").update({ status, ...extra }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Estado actualizado");
    load();
  }

  async function saveWithholding() {
    if (!orgId || !withForm.counterpart_name.trim()) return toast.error("Ingresá el nombre de la contraparte");
    if (Number(withForm.amount) <= 0) return toast.error("Ingresá el monto de la retención");
    setSavingWith(true);
    const { error } = await supabase.from("withholding_records").insert({
      org_id: orgId,
      withholding_type: withForm.withholding_type,
      counterpart_name: withForm.counterpart_name.trim(),
      counterpart_cuit: withForm.counterpart_cuit || null,
      amount: Number(withForm.amount),
      rate_pct: Number(withForm.rate_pct),
      base_amount: Number(withForm.base_amount),
      direction: withForm.direction,
      date: withForm.date,
      certificate_number: withForm.certificate_number || null,
      reference_type: withForm.reference_type || null,
      notes: withForm.notes || null,
    });
    setSavingWith(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Retención registrada");
    setWithOpen(false);
    setWithForm({ ...EMPTY_WITHHOLDING });
    load();
  }

  async function saveRate() {
    if (!orgId || !rateForm.name.trim()) return toast.error("Ingresá el nombre");
    setSavingRate(true);
    const { error } = await supabase.from("tax_rates").insert({
      org_id: orgId,
      name: rateForm.name.trim(),
      rate_pct: Number(rateForm.rate_pct),
      tax_type: rateForm.tax_type,
      applies_to: rateForm.applies_to,
      jurisdiction: rateForm.jurisdiction || null,
      code: rateForm.code || null,
    });
    setSavingRate(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Alícuota creada");
    setRateOpen(false);
    setRateForm({ ...EMPTY_RATE });
    load();
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredDecls = declarations.filter(d => {
    if (yearFilter && d.year !== yearFilter) return false;
    if (typeFilter !== "all" && d.tax_rates?.tax_type !== typeFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  const filteredWithholdings = withholdings.filter(w => {
    if (withTypeFilter !== "all" && w.withholding_type !== withTypeFilter) return false;
    if (withDirFilter !== "all" && w.direction !== withDirFilter) return false;
    return true;
  });

  const kpis = {
    pendingDecls: declarations.filter(d => d.status === "draft").length,
    totalCollected: declarations.filter(d => d.year === yearFilter).reduce((s, d) => s + Number(d.tax_collected), 0),
    totalPaid: declarations.filter(d => d.year === yearFilter).reduce((s, d) => s + Number(d.tax_paid), 0),
    withSuffered: withholdings.filter(w => w.direction === "suffered").reduce((s, w) => s + Number(w.amount), 0),
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Receipt}
        title="Gestión Impositiva"
        description="IVA, IIBB, retenciones y declaraciones AFIP"
        actions={<div className="flex gap-2">
          {taxRates.length === 0 && (
            <Button variant="outline" onClick={seedRates} disabled={seeding}>
              {seeding ? "Cargando..." : "🇦🇷 Cargar alícuotas AR"}
            </Button>
          )}
          {activeTab === "declarations" && (
            <Dialog open={declOpen} onOpenChange={open => { setDeclOpen(open); if (!open) { setEditDecl(null); setDeclForm({ ...EMPTY_DECL }); } }}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditDecl(null); setDeclForm({ ...EMPTY_DECL }); }}>
                  <Plus className="w-4 h-4 mr-2" /> Nueva declaración
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editDecl ? "Editar declaración" : "Nueva declaración"}</DialogTitle></DialogHeader>
                <div className="space-y-3 pb-12">
                  <div className="space-y-1 pb-12">
                    <Label>Alícuota *</Label>
                    <Select value={declForm.tax_rate_id} onValueChange={v => setDeclForm(f => ({ ...f, tax_rate_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar alícuota" /></SelectTrigger>
                      <SelectContent>
                        {taxRates.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.rate_pct}%)</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1 pb-12">
                      <Label>Período</Label>
                      <Select value={declForm.period_type} onValueChange={v => setDeclForm(f => ({ ...f, period_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Mensual</SelectItem>
                          <SelectItem value="bimonthly">Bimestral</SelectItem>
                          <SelectItem value="quarterly">Trimestral</SelectItem>
                          <SelectItem value="annual">Anual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Año</Label>
                      <Input type="number" value={declForm.year} onChange={e => setDeclForm(f => ({ ...f, year: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Mes/Período</Label>
                      <Select value={String(declForm.period)} onValueChange={v => setDeclForm(f => ({ ...f, period: Number(v) }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1 pb-12">
                      <Label>Base imponible</Label>
                      <Input type="number" min={0} value={declForm.taxable_base} onChange={e => setDeclForm(f => ({ ...f, taxable_base: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Débito fiscal</Label>
                      <Input type="number" min={0} value={declForm.tax_collected} onChange={e => setDeclForm(f => ({ ...f, tax_collected: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Crédito fiscal</Label>
                      <Input type="number" min={0} value={declForm.tax_paid} onChange={e => setDeclForm(f => ({ ...f, tax_paid: Number(e.target.value) }))} />
                    </div>
                  </div>
                  {(declForm.tax_collected > 0 || declForm.tax_paid > 0) && (
                    <div className={`rounded p-2 text-sm font-medium ${declForm.tax_collected - declForm.tax_paid >= 0 ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
                      Saldo: {fmt(declForm.tax_collected - declForm.tax_paid)}
                      {declForm.tax_collected - declForm.tax_paid > 0 ? " (a pagar)" : " (a favor)"}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 pb-12">
                      <Label>Vencimiento</Label>
                      <Input type="date" value={declForm.due_date} onChange={e => setDeclForm(f => ({ ...f, due_date: e.target.value }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Nro declaración</Label>
                      <Input value={declForm.declaration_number} onChange={e => setDeclForm(f => ({ ...f, declaration_number: e.target.value }))} placeholder="AFIP número..." />
                    </div>
                  </div>
                  <div className="space-y-1 pb-12">
                    <Label>Notas</Label>
                    <Textarea value={declForm.notes} onChange={e => setDeclForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveDeclaration} disabled={savingDecl}>
                    {savingDecl ? "Guardando..." : editDecl ? "Guardar cambios" : "Crear declaración"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "withholdings" && (
            <Dialog open={withOpen} onOpenChange={setWithOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setWithForm({ ...EMPTY_WITHHOLDING })}>
                  <Plus className="w-4 h-4 mr-2" /> Nueva retención
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Registrar retención</DialogTitle></DialogHeader>
                <div className="space-y-3 pb-12">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 pb-12">
                      <Label>Tipo</Label>
                      <Select value={withForm.withholding_type} onValueChange={v => setWithForm(f => ({ ...f, withholding_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ganancias">Ganancias</SelectItem>
                          <SelectItem value="iva">IVA</SelectItem>
                          <SelectItem value="iibb">IIBB</SelectItem>
                          <SelectItem value="suss">SUSS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Dirección</Label>
                      <Select value={withForm.direction} onValueChange={v => setWithForm(f => ({ ...f, direction: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="suffered">Nos retienen</SelectItem>
                          <SelectItem value="applied">Retenemos</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label>Nombre contraparte *</Label>
                      <Input value={withForm.counterpart_name} onChange={e => setWithForm(f => ({ ...f, counterpart_name: e.target.value }))} placeholder="Nombre proveedor o cliente" />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>CUIT contraparte</Label>
                      <Input value={withForm.counterpart_cuit} onChange={e => setWithForm(f => ({ ...f, counterpart_cuit: e.target.value }))} placeholder="20-12345678-3" />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Fecha</Label>
                      <Input type="date" value={withForm.date} onChange={e => setWithForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Base imponible</Label>
                      <Input type="number" min={0} value={withForm.base_amount} onChange={e => setWithForm(f => ({ ...f, base_amount: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Alícuota %</Label>
                      <Input type="number" min={0} step={0.01} value={withForm.rate_pct} onChange={e => setWithForm(f => ({ ...f, rate_pct: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Monto retenido *</Label>
                      <Input type="number" min={0} value={withForm.amount} onChange={e => setWithForm(f => ({ ...f, amount: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Nro certificado</Label>
                      <Input value={withForm.certificate_number} onChange={e => setWithForm(f => ({ ...f, certificate_number: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1 pb-12">
                    <Label>Notas</Label>
                    <Textarea value={withForm.notes} onChange={e => setWithForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveWithholding} disabled={savingWith}>
                    {savingWith ? "Guardando..." : "Registrar retención"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "rates" && (
            <Dialog open={rateOpen} onOpenChange={setRateOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setRateForm({ ...EMPTY_RATE })}>
                  <Plus className="w-4 h-4 mr-2" /> Nueva alícuota
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Nueva alícuota impositiva</DialogTitle></DialogHeader>
                <div className="space-y-3 pb-12">
                  <div className="space-y-1 pb-12">
                    <Label>Nombre *</Label>
                    <Input value={rateForm.name} onChange={e => setRateForm(f => ({ ...f, name: e.target.value }))} placeholder="IVA 21%, IIBB CABA..." />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 pb-12">
                      <Label>Tipo</Label>
                      <Select value={rateForm.tax_type} onValueChange={v => setRateForm(f => ({ ...f, tax_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TAX_TYPE_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Aplica a</Label>
                      <Select value={rateForm.applies_to} onValueChange={v => setRateForm(f => ({ ...f, applies_to: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sales">Ventas</SelectItem>
                          <SelectItem value="purchases">Compras</SelectItem>
                          <SelectItem value="both">Ambos</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Alícuota %</Label>
                      <Input type="number" min={0} step={0.01} value={rateForm.rate_pct} onChange={e => setRateForm(f => ({ ...f, rate_pct: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1 pb-12">
                      <Label>Jurisdicción</Label>
                      <Input value={rateForm.jurisdiction} onChange={e => setRateForm(f => ({ ...f, jurisdiction: e.target.value }))} placeholder="AFIP, AGIP, ARBA..." />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label>Código AFIP</Label>
                      <Input value={rateForm.code} onChange={e => setRateForm(f => ({ ...f, code: e.target.value }))} placeholder="0021" />
                    </div>
                  </div>
                  <Button className="w-full" onClick={saveRate} disabled={savingRate}>
                    {savingRate ? "Guardando..." : "Crear alícuota"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Declaraciones pendientes" value={kpis.pendingDecls} sub="en borrador" icon={AlertCircle} color="warning" />
        <KPICard label={`Débito fiscal ${yearFilter}`} value={fmt(kpis.totalCollected)} sub="IVA vendido" icon={TrendingUp} color="destructive" />
        <KPICard label={`Crédito fiscal ${yearFilter}`} value={fmt(kpis.totalPaid)} sub="IVA comprado" icon={DollarSign} color="success" />
        <KPICard label="Retenciones sufridas" value={fmt(kpis.withSuffered)} sub="acumuladas" icon={Scale} color="blue" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="declarations">Declaraciones ({declarations.length})</TabsTrigger>
          <TabsTrigger value="withholdings">Retenciones ({withholdings.length})</TabsTrigger>
          <TabsTrigger value="rates">Alícuotas ({taxRates.length})</TabsTrigger>
          <TabsTrigger value="iibb">IIBB ({iibbRegs.length})</TabsTrigger>
        </TabsList>

        {/* DECLARATIONS */}
        <TabsContent value="declarations" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Año</Label>
              <Input type="number" className="w-24 h-8" value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))} />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Tipo impuesto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {Object.entries(TAX_TYPE_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos estados</SelectItem>
                {Object.entries(DECL_STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredDecls.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay declaraciones para los filtros seleccionados</p>
              {taxRates.length === 0 && <p className="text-sm mt-2">Primero cargá las alícuotas usando el botón "Cargar alícuotas AR"</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Impuesto</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Período</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Base imponible</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Débito</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Crédito</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Saldo</th>
                    <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Estado</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Venc.</th>
                    <th className="py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDecls.map(d => {
                    const sc = DECL_STATUS_CONFIG[d.status] ?? DECL_STATUS_CONFIG.draft;
                    const tc = TAX_TYPE_CONFIG[d.tax_rates?.tax_type ?? "otro"] ?? TAX_TYPE_CONFIG.otro;
                    const isOverdue = d.due_date && new Date(d.due_date) < new Date() && d.status === "draft";
                    return (
                      <tr key={d.id} className="border-b hover:bg-muted/20">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${tc.color}`}>{tc.label}</Badge>
                            <span className="text-foreground">{d.tax_rates?.name ?? "—"}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {d.period_type === "annual" ? d.year : `${MONTHS[d.period - 1]} ${d.year}`}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{fmt(d.taxable_base)}</td>
                        <td className="py-2 px-3 text-right text-red-600 font-medium">{fmt(d.tax_collected)}</td>
                        <td className="py-2 px-3 text-right text-green-600 font-medium">{fmt(d.tax_paid)}</td>
                        <td className={`py-2 px-3 text-right font-bold ${Number(d.tax_balance) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {fmt(d.tax_balance)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Badge className={`text-xs flex items-center gap-1 justify-center ${sc.color}`}>
                            {sc.icon} {sc.label}
                          </Badge>
                        </td>
                        <td className={`py-2 px-3 text-right text-xs ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                          {d.due_date ? new Date(d.due_date).toLocaleDateString("es-AR") : "—"}
                          {isOverdue && " ⚠"}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                              onClick={() => { setEditDecl(d); setDeclForm({ tax_rate_id: d.tax_rate_id, period_type: d.period_type, year: d.year, period: d.period, taxable_base: d.taxable_base, tax_collected: d.tax_collected, tax_paid: d.tax_paid, due_date: d.due_date ?? "", declaration_number: d.declaration_number ?? "", notes: d.notes ?? "" }); setDeclOpen(true); }}>
                              Editar
                            </Button>
                            {d.status === "draft" && (
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => updateDeclStatus(d.id, "filed")}>
                                Presentar
                              </Button>
                            )}
                            {d.status === "filed" && (
                              <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-emerald-400 border-emerald-500/30" onClick={() => updateDeclStatus(d.id, "paid")}>
                                Pagado
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* WITHHOLDINGS */}
        <TabsContent value="withholdings" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={withTypeFilter} onValueChange={setWithTypeFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="ganancias">Ganancias</SelectItem>
                <SelectItem value="iva">IVA</SelectItem>
                <SelectItem value="iibb">IIBB</SelectItem>
                <SelectItem value="suss">SUSS</SelectItem>
              </SelectContent>
            </Select>
            <Select value={withDirFilter} onValueChange={setWithDirFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Dirección" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="suffered">Nos retienen</SelectItem>
                <SelectItem value="applied">Retenemos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredWithholdings.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay retenciones registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Fecha</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Tipo</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Dirección</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Contraparte</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">CUIT</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Base</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Alíc.%</th>
                    <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Monto</th>
                    <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Certificado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWithholdings.map(w => (
                    <tr key={w.id} className="border-b hover:bg-muted/20">
                      <td className="py-2 px-3 text-muted-foreground">{new Date(w.date).toLocaleDateString("es-AR")}</td>
                      <td className="py-2 px-3">
                        <Badge className={`text-xs ${TAX_TYPE_CONFIG[w.withholding_type]?.color ?? "bg-muted/40 text-foreground/80"}`}>
                          {w.withholding_type.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${w.direction === "suffered" ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"}`}>
                          {w.direction === "suffered" ? "Sufrida" : "Aplicada"}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-foreground">{w.counterpart_name}</td>
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{w.counterpart_cuit ?? "—"}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{fmt(w.base_amount)}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{w.rate_pct}%</td>
                      <td className="py-2 px-3 text-right font-semibold text-foreground">{fmt(w.amount)}</td>
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{w.certificate_number ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* RATES */}
        <TabsContent value="rates" className="mt-4">
          {taxRates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <Percent className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="mb-3">No hay alícuotas cargadas</p>
              <Button variant="outline" onClick={seedRates} disabled={seeding}>
                {seeding ? "Cargando..." : "🇦🇷 Cargar alícuotas estándar argentinas"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {taxRates.map(rate => {
                const tc = TAX_TYPE_CONFIG[rate.tax_type] ?? TAX_TYPE_CONFIG.otro;
                return (
                  <Card key={rate.id}>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <p className="font-semibold text-foreground">{rate.name}</p>
                        <Badge className={`text-xs ${tc.color}`}>{tc.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-2xl font-bold text-indigo-600">{rate.rate_pct}%</div>
                        <div className="text-sm text-muted-foreground">
                          <p>{rate.applies_to === "sales" ? "Ventas" : rate.applies_to === "purchases" ? "Compras" : "Ambos"}</p>
                          {rate.jurisdiction && <p className="text-xs">{rate.jurisdiction}</p>}
                          {rate.code && <p className="text-xs font-mono">{rate.code}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* IIBB */}
        <TabsContent value="iibb" className="mt-4">
          {iibbRegs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay inscripciones de IIBB</p>
              <p className="text-sm mt-1">Agregá las jurisdicciones provinciales donde tenés actividad</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {iibbRegs.map(reg => (
                <Card key={reg.id}>
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="font-semibold text-foreground">{reg.province}</p>
                      <Badge variant="outline" className="text-xs">{reg.regime === "local" ? "Local" : reg.regime === "convenio" ? "Convenio multilateral" : "CM"}</Badge>
                    </div>
                    <p className="text-2xl font-bold text-purple-600">{reg.rate_pct}%</p>
                    {reg.registration_number && <p className="text-sm text-muted-foreground">Nro: {reg.registration_number}</p>}
                    {reg.cuit && <p className="text-xs text-muted-foreground/70 font-mono">{reg.cuit}</p>}
                    <div className={`text-xs font-medium ${reg.active ? "text-green-600" : "text-muted-foreground/70"}`}>
                      {reg.active ? "● Activo" : "● Inactivo"}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
