import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  DollarSign,
  TrendingUp,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Banknote,
  ChevronDown,
  ChevronUp,
  Download,
  UserPlus,
  Zap,
  Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AffiliatePartner {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  code: string;
  status: "pending" | "active" | "suspended" | "inactive";
  commission_type: "percentage" | "fixed" | "tiered";
  commission_rate: number;
  payout_threshold: number;
  total_referrals: number;
  total_revenue: number;
  total_commission: number;
  pending_payout: number;
  notes: string | null;
  joined_at: string;
  created_at: string;
}

interface AffiliateConversion {
  id: string;
  partner_id: string;
  sale_amount: number;
  commission_amount: number;
  customer_name: string | null;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
  partner?: { name: string; code: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: "Pendiente", color: "bg-amber-500/15 text-amber-400", icon: Clock },
  active: { label: "Activo", color: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle },
  suspended: { label: "Suspendido", color: "bg-orange-500/15 text-orange-400", icon: XCircle },
  inactive: { label: "Inactivo", color: "bg-muted/40 text-muted-foreground", icon: XCircle },
};

const CONV_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-amber-500/15 text-amber-400" },
  approved: { label: "Aprobada", color: "bg-blue-500/15 text-blue-400" },
  paid: { label: "Pagada", color: "bg-emerald-500/15 text-emerald-400" },
  rejected: { label: "Rechazada", color: "bg-red-500/15 text-red-400" },
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function generateCode(name: string) {
  const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${clean}${suffix}`;
}

// ─── Partner Form ─────────────────────────────────────────────────────────────

interface PartnerFormProps {
  open: boolean;
  partner: AffiliatePartner | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function PartnerForm({ open, partner, orgId, onClose, onSaved }: PartnerFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("pending");
  const [commType, setCommType] = useState("percentage");
  const [commRate, setCommRate] = useState("10");
  const [payoutThreshold, setPayoutThreshold] = useState("1000");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (partner) {
      setName(partner.name); setEmail(partner.email); setPhone(partner.phone ?? ""); setCompany(partner.company ?? "");
      setCode(partner.code); setStatus(partner.status); setCommType(partner.commission_type);
      setCommRate(String(partner.commission_rate)); setPayoutThreshold(String(partner.payout_threshold));
      setNotes(partner.notes ?? "");
    } else {
      setName(""); setEmail(""); setPhone(""); setCompany(""); setCode(""); setStatus("pending");
      setCommType("percentage"); setCommRate("10"); setPayoutThreshold("1000"); setNotes("");
    }
  }, [partner, open]);

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Nombre y email requeridos"); return; }
    if (!code.trim()) { toast.error("Código requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId, name: name.trim(), email: email.trim(), phone: phone.trim() || null,
      company: company.trim() || null, code: code.trim().toUpperCase(), status,
      commission_type: commType, commission_rate: parseFloat(commRate) || 10,
      payout_threshold: parseFloat(payoutThreshold) || 1000, notes: notes.trim() || null,
    };
    const { error } = partner
      ? await supabase.from("affiliate_partners").update(payload).eq("id", partner.id)
      : await supabase.from("affiliate_partners").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(partner ? "Afiliado actualizado" : "Afiliado creado");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{partner ? "Editar afiliado" : "Nuevo afiliado"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nombre *</Label>
              <Input value={name} onChange={e => { setName(e.target.value); if (!partner && !code) setCode(generateCode(e.target.value)); }} placeholder="Nombre completo" />
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>Empresa</Label>
              <Input value={company} onChange={e => setCompany(e.target.value)} />
            </div>
            <div>
              <Label>Código único *</Label>
              <div className="flex gap-2">
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
                <Button size="sm" variant="outline" type="button" onClick={() => setCode(generateCode(name))}>
                  <Zap className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de comisión</Label>
              <Select value={commType} onValueChange={setCommType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                  <SelectItem value="fixed">Monto fijo</SelectItem>
                  <SelectItem value="tiered">Escalonado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{commType === "percentage" ? "Tasa (%)" : "Monto por venta"}</Label>
              <Input type="number" value={commRate} onChange={e => setCommRate(e.target.value)} min="0" />
            </div>
            <div className="col-span-2">
              <Label>Umbral de pago mínimo (ARS)</Label>
              <Input type="number" value={payoutThreshold} onChange={e => setPayoutThreshold(e.target.value)} min="0" />
            </div>
            <div className="col-span-2">
              <Label>Notas internas</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {partner ? "Guardar" : "Crear afiliado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Partner Card ─────────────────────────────────────────────────────────────

interface PartnerCardProps {
  partner: AffiliatePartner;
  onEdit: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onPayout: () => void;
}

function PartnerCard({ partner, onEdit, onDelete, onApprove, onPayout }: PartnerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_CONFIG[partner.status];
  const StatusIcon = sc.icon;
  const canPayout = partner.pending_payout >= partner.payout_threshold;

  const copyCode = () => {
    navigator.clipboard.writeText(partner.code);
    toast.success("Código copiado!");
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{partner.name}</span>
            <Badge className={`text-xs ${sc.color}`}><StatusIcon className="w-3 h-3 mr-1" />{sc.label}</Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{partner.email}</span>
            {partner.company && <span>· {partner.company}</span>}
            <button
              className="flex items-center gap-1 font-mono text-primary hover:underline"
              onClick={e => { e.stopPropagation(); copyCode(); }}
            >
              <Copy className="w-3 h-3" /> {partner.code}
            </button>
          </div>
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          <p className="text-sm font-bold">{fmtCurrency(partner.total_commission)}</p>
          <p className="text-xs text-muted-foreground">{partner.total_referrals} conversiones</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-border p-4 bg-muted/10 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Revenue generado</p>
              <p className="font-bold text-sm">{fmtCurrency(partner.total_revenue)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Comisión total</p>
              <p className="font-bold text-sm">{fmtCurrency(partner.total_commission)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pago pendiente</p>
              <p className={`font-bold text-sm ${canPayout ? "text-amber-400" : ""}`}>{fmtCurrency(partner.pending_payout)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Comisión</p>
              <p className="font-medium">
                {partner.commission_type === "percentage" ? `${partner.commission_rate}%` :
                 partner.commission_type === "fixed" ? fmtCurrency(partner.commission_rate) : "Escalonado"}
              </p>
            </div>
          </div>

          {partner.notes && (
            <div className="text-xs text-muted-foreground border border-border rounded p-2">{partner.notes}</div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {partner.status === "pending" && (
              <Button size="sm" variant="outline" onClick={onApprove}>
                <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Aprobar
              </Button>
            )}
            {canPayout && (
              <Button size="sm" variant="outline" onClick={onPayout} className="text-amber-400 border-amber-500/30">
                <Banknote className="w-3.5 h-3.5 mr-1" /> Pagar {fmtCurrency(partner.pending_payout)}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Edit className="w-3.5 h-3.5 mr-1" /> Editar
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AffiliateProgramPage() {
  usePageTitle("Programa de Afiliados");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [partners, setPartners] = useState<AffiliatePartner[]>([]);
  const [conversions, setConversions] = useState<AffiliateConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<AffiliatePartner | null>(null);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [pRes, cRes] = await Promise.all([
      supabase.from("affiliate_partners").select("*").eq("org_id", orgId).order("joined_at", { ascending: false }),
      supabase.from("affiliate_conversions").select("*, partner:affiliate_partners(name,code)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100),
    ]);
    setPartners((pRes.data ?? []) as unknown as AffiliatePartner[]);
    setConversions((cRes.data ?? []) as unknown as AffiliateConversion[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  const kpis = useMemo(() => {
    const active = partners.filter(p => p.status === "active").length;
    const totalRev = partners.reduce((a, p) => a + p.total_revenue, 0);
    const totalComm = partners.reduce((a, p) => a + p.total_commission, 0);
    const pendingPayout = partners.reduce((a, p) => a + p.pending_payout, 0);
    return { active, totalRev, totalComm, pendingPayout };
  }, [partners]);

  const filteredPartners = useMemo(() => {
    return partners.filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [partners, search, filterStatus]);

  const handleApprove = async (partner: AffiliatePartner) => {
    await supabase.from("affiliate_partners").update({ status: "active" }).eq("id", partner.id);
    setPartners(prev => prev.map(p => p.id === partner.id ? { ...p, status: "active" as const } : p));
    toast.success(`${partner.name} aprobado como afiliado`);
  };

  const handlePayout = async (partner: AffiliatePartner) => {
    const { error } = await supabase.from("affiliate_payouts").insert({
      partner_id: partner.id, org_id: orgId,
      amount: partner.pending_payout, currency: "ARS", status: "pending",
    });
    if (error) { toast.error("Error"); return; }
    // Mark approved conversions as paid
    await supabase.from("affiliate_conversions")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("partner_id", partner.id).eq("status", "approved");
    toast.success(`Pago de ${fmtCurrency(partner.pending_payout)} registrado`);
    loadAll();
  };

  const handleDelete = async (partner: AffiliatePartner) => {
    if (!confirm(`¿Eliminar a ${partner.name}?`)) return;
    await supabase.from("affiliate_partners").delete().eq("id", partner.id);
    setPartners(prev => prev.filter(p => p.id !== partner.id));
    toast.success("Afiliado eliminado");
  };

  const approveConversion = async (conv: AffiliateConversion) => {
    await supabase.from("affiliate_conversions").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", conv.id);
    setConversions(prev => prev.map(c => c.id === conv.id ? { ...c, status: "approved" as const } : c));
    toast.success("Conversión aprobada");
    loadAll();
  };

  const exportCSV = () => {
    const rows = [["Nombre", "Email", "Código", "Estado", "Revenue", "Comisión", "Pendiente"],
      ...partners.map(p => [p.name, p.email, p.code, STATUS_CONFIG[p.status]?.label, p.total_revenue, p.total_commission, p.pending_payout])];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "afiliados.csv"; a.click();
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={UserPlus}
        title="Programa de Afiliados"
        description="Gestioná socios y comisiones por referidos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-4 h-4 mr-1.5" /> Exportar
            </Button>
            <Button size="sm" onClick={() => { setEditingPartner(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo afiliado
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="Afiliados activos" value={kpis.active} icon={Users} color="success" />
        <KPICard label="Revenue generado" value={fmtCurrency(kpis.totalRev)} icon={TrendingUp} color="primary" />
        <KPICard label="Comisiones totales" value={fmtCurrency(kpis.totalComm)} icon={DollarSign} color="purple" />
        <KPICard label="Pagos pendientes" value={fmtCurrency(kpis.pendingPayout)} icon={Banknote} color="warning" />
      </div>

      <Tabs defaultValue="partners">
        <TabsList>
          <TabsTrigger value="partners">
            <Users className="w-4 h-4 mr-1.5" /> Afiliados ({partners.length})
          </TabsTrigger>
          <TabsTrigger value="conversions">
            Conversiones ({conversions.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Partners ── */}
        <TabsContent value="partners" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar afiliado, código..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          : filteredPartners.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin afiliados</p>
            </div>
          ) : filteredPartners.map(p => (
            <PartnerCard
              key={p.id}
              partner={p}
              onEdit={() => { setEditingPartner(p); setFormOpen(true); }}
              onDelete={() => handleDelete(p)}
              onApprove={() => handleApprove(p)}
              onPayout={() => handlePayout(p)}
            />
          ))}
        </TabsContent>

        {/* ── Conversions ── */}
        <TabsContent value="conversions" className="mt-4">
          {conversions.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin conversiones registradas</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Afiliado</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Cliente</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Venta</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Comisión</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Fecha</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {conversions.map(c => {
                    const cs = CONV_STATUS_CONFIG[c.status];
                    return (
                      <tr key={c.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{c.partner?.name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{c.partner?.code}</p>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{c.customer_name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{fmtCurrency(c.sale_amount)}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-400">{fmtCurrency(c.commission_amount)}</td>
                        <td className="px-4 py-2.5"><Badge className={`text-xs ${cs.color}`}>{cs.label}</Badge></td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: es })}
                        </td>
                        <td className="px-4 py-2.5">
                          {c.status === "pending" && (
                            <Button size="sm" variant="ghost" onClick={() => approveConversion(c)}>
                              <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Aprobar
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
      </Tabs>

      <PartnerForm
        open={formOpen}
        partner={editingPartner}
        orgId={orgId}
        onClose={() => { setFormOpen(false); setEditingPartner(null); }}
        onSaved={loadAll}
      />
    </div>
  );
}
