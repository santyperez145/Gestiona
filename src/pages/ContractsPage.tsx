import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  FileText, Plus, X, Save, Search, Trash2, Edit2, CheckCircle,
  Clock, AlertTriangle, XCircle, RefreshCw, Download, ExternalLink,
  Calendar, DollarSign, User, Tag, Link, ChevronDown, ChevronUp,
  Shield, RotateCcw, Sparkles, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type ContractStatus = 'draft' | 'active' | 'expired' | 'cancelled' | 'renewed';
type ContractType = 'customer' | 'supplier' | 'partner' | 'employee' | 'nda' | 'other';

interface Contract {
  id: string;
  contract_number: string;
  title: string;
  description: string | null;
  status: ContractStatus;
  type: ContractType;
  customer_name: string | null;
  customer_email: string | null;
  value: number;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  auto_renewal: boolean;
  renewal_days: number;
  terms: string | null;
  document_url: string | null;
  signed_at: string | null;
  signer_name: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

// ── Config ────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<ContractStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:     { label: 'Borrador',   color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20',   icon: FileText },
  active:    { label: 'Activo',     color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',icon: CheckCircle },
  expired:   { label: 'Vencido',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',        icon: XCircle },
  cancelled: { label: 'Cancelado',  color: 'text-muted-foreground', bg: 'bg-muted/30 border-border/40',          icon: X },
  renewed:   { label: 'Renovado',   color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',      icon: RotateCcw },
};

const TYPE_LABELS: Record<ContractType, string> = {
  customer: '🤝 Cliente', supplier: '📦 Proveedor', partner: '🤜 Socio',
  employee: '👤 Empleado', nda: '🔒 NDA', other: '📄 Otro',
};

const emptyForm = () => ({
  title: '', description: '', status: 'draft' as ContractStatus,
  type: 'customer' as ContractType, customer_name: '', customer_email: '',
  value: '', currency: 'ARS', start_date: '', end_date: '',
  auto_renewal: false, renewal_days: '30', terms: '', document_url: '',
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function ContractsPage() {
  usePageTitle("Contratos");
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | ContractStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setContracts(data ?? []);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({
      title: c.title, description: c.description ?? '', status: c.status,
      type: c.type, customer_name: c.customer_name ?? '', customer_email: c.customer_email ?? '',
      value: c.value.toString(), currency: c.currency,
      start_date: c.start_date ?? '', end_date: c.end_date ?? '',
      auto_renewal: c.auto_renewal, renewal_days: c.renewal_days.toString(),
      terms: c.terms ?? '', document_url: c.document_url ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("El título es obligatorio"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        type: form.type,
        customer_name: form.customer_name.trim() || null,
        customer_email: form.customer_email.trim() || null,
        value: parseFloat(form.value) || 0,
        currency: form.currency,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        auto_renewal: form.auto_renewal,
        renewal_days: parseInt(form.renewal_days) || 30,
        terms: form.terms.trim() || null,
        document_url: form.document_url.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("contracts").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Contrato actualizado");
      } else {
        const contractNumber = `CON-${format(new Date(), 'yyyy')}-${String(contracts.length + 1).padStart(4, '0')}`;
        const { error } = await supabase.from("contracts").insert({
          ...payload, org_id: activeOrg.id, contract_number: contractNumber,
        });
        if (error) throw error;
        toast.success("Contrato creado");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteContract = async (id: string) => {
    if (!confirm("¿Eliminar este contrato?")) return;
    await supabase.from("contracts").delete().eq("id", id);
    load();
    toast.success("Contrato eliminado");
  };

  const quickStatus = async (c: Contract, status: ContractStatus) => {
    await supabase.from("contracts").update({ status }).eq("id", c.id);
    load();
    toast.success(`Estado → ${STATUS_CFG[status].label}`);
  };

  const filtered = useMemo(() => {
    return contracts.filter(c => {
      const matchSearch = !search
        || c.title.toLowerCase().includes(search.toLowerCase())
        || c.contract_number.toLowerCase().includes(search.toLowerCase())
        || (c.customer_name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || c.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [contracts, search, filterStatus]);

  // KPIs
  const kpis = useMemo(() => {
    const active = contracts.filter(c => c.status === 'active').length;
    const expiringSoon = contracts.filter(c => {
      if (c.status !== 'active' || !c.end_date) return false;
      const days = differenceInDays(new Date(c.end_date), new Date());
      return days >= 0 && days <= 30;
    }).length;
    const expired = contracts.filter(c => c.status === 'expired').length;
    const totalValue = contracts.filter(c => c.status === 'active').reduce((s, c) => s + c.value, 0);
    return { active, expiringSoon, expired, totalValue };
  }, [contracts]);

  const daysUntilExpiry = (c: Contract) => {
    if (!c.end_date) return null;
    return differenceInDays(new Date(c.end_date), new Date());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        title="Contratos"
        description="Gestión de contratos con clientes, proveedores y socios"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isAdmin && (
              <Button className="gradient-gold text-primary-foreground gap-2" onClick={openCreate}>
                <Plus className="w-4 h-4" /> Nuevo contrato
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Contratos activos" value={kpis.active} sub="vigentes ahora" icon={CheckCircle} color="success" />
        <KPICard label="Vencen pronto" value={kpis.expiringSoon} sub="próximos 30 días" icon={AlertTriangle} color="warning" />
        <KPICard label="Vencidos" value={kpis.expired} sub="requieren atención" icon={XCircle} color="destructive" />
        <KPICard label="Valor contratado" value={`$${kpis.totalValue.toLocaleString("es-AR")}`} sub="contratos activos" icon={DollarSign} color="primary" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar contrato, cliente..." className="pl-8 bg-muted" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...Object.keys(STATUS_CFG)] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterStatus === s ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {s === 'all' ? 'Todos' : STATUS_CFG[s as ContractStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Form Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">{editing ? 'Editar contrato' : 'Nuevo contrato'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="bg-muted" placeholder="Ej: Contrato de servicio anual — Empresa XYZ" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as ContractType }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Estado</label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as ContractStatus }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><User className="w-3 h-3" />Contraparte</label>
                  <Input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className="bg-muted" placeholder="Nombre empresa / persona" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                  <Input type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} className="bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" />Valor del contrato</label>
                  <Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} className="bg-muted" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="BRL">BRL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Inicio</label>
                  <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="bg-muted" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Vencimiento</label>
                  <Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="bg-muted" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.auto_renewal} onChange={e => setForm(f => ({ ...f, auto_renewal: e.target.checked }))} className="w-4 h-4 accent-primary" />
                  Auto-renovación
                </label>
                {form.auto_renewal && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Alertar</span>
                    <Input type="number" value={form.renewal_days} onChange={e => setForm(f => ({ ...f, renewal_days: e.target.value }))} className="w-16 bg-muted h-8 text-xs" />
                    <span className="text-xs text-muted-foreground">días antes</span>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Link className="w-3 h-3" />URL del documento</label>
                <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} className="bg-muted" placeholder="https://drive.google.com/..." />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Términos y condiciones</label>
                <Textarea value={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.value }))} className="bg-muted resize-none" rows={4} placeholder="Descripción de los términos del contrato..." />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear contrato'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Contract list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay contratos registrados.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(contract => {
            const sc = STATUS_CFG[contract.status];
            const StatusIcon = sc.icon;
            const isExpanded = expandedId === contract.id;
            const daysLeft = daysUntilExpiry(contract);
            const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && contract.status === 'active';
            const isOverdue = daysLeft !== null && daysLeft < 0 && contract.status === 'active';

            return (
              <div key={contract.id} className={`bg-card border rounded-xl overflow-hidden transition-all ${isExpiringSoon ? 'border-amber-500/30' : isOverdue ? 'border-red-500/30' : 'border-border'}`}>
                <button
                  className="w-full text-left p-4 flex items-start gap-3"
                  onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sc.bg}`}>
                    <StatusIcon className={`w-4 h-4 ${sc.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground/60">{contract.contract_number}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      <span className="text-[10px] text-muted-foreground">{TYPE_LABELS[contract.type]}</span>
                      {isExpiringSoon && (
                        <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                          ⚠ Vence en {daysLeft}d
                        </span>
                      )}
                      {isOverdue && (
                        <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full">
                          🚨 Vencido hace {Math.abs(daysLeft!)}d
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm">{contract.title}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {contract.customer_name && <span className="flex items-center gap-1"><User className="w-3 h-3" />{contract.customer_name}</span>}
                      {contract.end_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Vence: {format(new Date(contract.end_date), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                      {contract.auto_renewal && <span className="flex items-center gap-1"><RotateCcw className="w-3 h-3 text-blue-400" />Auto-renovable</span>}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {contract.value > 0 && (
                      <p className="font-bold text-sm">{contract.currency} {contract.value.toLocaleString("es-AR")}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(contract.created_at), { locale: es, addSuffix: true })}
                    </p>
                  </div>

                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                             : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-4">
                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {contract.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => quickStatus(contract, 'active')} className="gap-1.5 text-xs">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Activar
                        </Button>
                      )}
                      {contract.status === 'active' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => quickStatus(contract, 'renewed')} className="gap-1.5 text-xs">
                            <RotateCcw className="w-3.5 h-3.5 text-blue-400" /> Renovar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => quickStatus(contract, 'cancelled')} className="gap-1.5 text-xs">
                            <XCircle className="w-3.5 h-3.5 text-red-400" /> Cancelar
                          </Button>
                        </>
                      )}
                      {contract.document_url && (
                        <a href={contract.document_url} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                            <ExternalLink className="w-3.5 h-3.5" /> Ver documento
                          </Button>
                        </a>
                      )}
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(contract)} className="gap-1.5 text-xs ml-auto">
                            <Edit2 className="w-3.5 h-3.5" /> Editar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deleteContract(contract.id)} className="gap-1.5 text-xs text-destructive/70 hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" /> Eliminar
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {contract.start_date && (
                        <div><p className="text-xs text-muted-foreground mb-0.5">Inicio</p>
                          <p>{format(new Date(contract.start_date), "d 'de' MMMM yyyy", { locale: es })}</p></div>
                      )}
                      {contract.end_date && (
                        <div><p className="text-xs text-muted-foreground mb-0.5">Vencimiento</p>
                          <p>{format(new Date(contract.end_date), "d 'de' MMMM yyyy", { locale: es })}</p></div>
                      )}
                      {contract.signed_at && (
                        <div><p className="text-xs text-muted-foreground mb-0.5">Firmado</p>
                          <p>{format(new Date(contract.signed_at), "d MMM yyyy HH:mm", { locale: es })}</p>
                          {contract.signer_name && <p className="text-xs text-muted-foreground">por {contract.signer_name}</p>}
                        </div>
                      )}
                    </div>

                    {contract.description && (
                      <div><p className="text-xs text-muted-foreground mb-1">Descripción</p>
                        <p className="text-sm text-muted-foreground">{contract.description}</p></div>
                    )}

                    {contract.terms && (
                      <div className="p-3 rounded-lg bg-card border border-border">
                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><FileText className="w-3 h-3" />Términos y condiciones</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contract.terms}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
