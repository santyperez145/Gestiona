import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Search, Truck, Phone, Mail,
  MapPin, FileText, ChevronDown, ChevronUp, Building2, ShoppingCart,
  AlertCircle, CheckCircle2, Clock, DollarSign, CreditCard, Square, CheckSquare, Store,
  ArrowUpDown, StickyNote, Check, X, FileSpreadsheet, BarChart2, TrendingUp, Package,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { addSupplierPaymentDB, formatARS } from "@/lib/supabaseStore";
import SupplierPOModal from "@/components/shared/SupplierPOModal";
import { usePageTitle } from "@/hooks/usePageTitle";

type Supplier = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
  created_at: string;
};

type PurchaseSummary = {
  id: string;
  product_name: string;
  quantity: number;
  total_ars: number;
  date: string;
};

const EMPTY: Partial<Supplier> = { name: "", contact: "", phone: "", email: "", address: "", notes: "", active: true };

type SupplierDebt = {
  id: string;
  supplier_name: string;
  supplier_id: string | null;
  description: string;
  amount_ars: number;
  paid_ars: number;
  remaining_ars: number;
  due_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

const DEBT_EMPTY = { supplier_name: "", supplier_id: "", description: "", amount_ars: "", due_date: "", notes: "" };

export default function ProveedoresPage() {
  usePageTitle("Proveedores");
  const { activeOrg } = useOrg();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [supplierSort, setSupplierSort] = useState<{ col: "name" | "pending" | "created_at"; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });
  const [purchases, setPurchases] = useState<Record<string, PurchaseSummary[]>>({});
  const [loadingPurchases, setLoadingPurchases] = useState(false);

  // Cuentas a pagar
  const [debts, setDebts] = useState<SupplierDebt[]>([]);
  const [debtForm, setDebtForm] = useState(DEBT_EMPTY);
  const [debtOpen, setDebtOpen] = useState(false);
  const [payDebtId, setPayDebtId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("transferencia");
  const [savingDebt, setSavingDebt] = useState(false);
  const [selectedDebtIds, setSelectedDebtIds] = useState<Set<string>>(new Set());
  const [bulkPayLoading, setBulkPayLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'proveedores' | 'aging' | 'pagos' | 'analytics'>('proveedores');
  const [allPurchases, setAllPurchases] = useState<any[]>([]);
  const [poOpen, setPoOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState<string | undefined>(undefined);
  const [editingNote, setEditingNote] = useState<{ id: string; value: string } | null>(null);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: suppData }, { data: debtData }, { data: purchData }] = await Promise.all([
      supabase.from("suppliers").select("*").eq("org_id", activeOrg.id).order("name"),
      supabase.from("supplier_debts").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
      supabase.from("purchases").select("id, supplier_name, supplier_id, total_ars, total_usd, date, product_name, quantity").eq("org_id", activeOrg.id).order("date", { ascending: false }),
    ]);
    setSuppliers((suppData as Supplier[]) || []);
    setDebts(debtData || []);
    setAllPurchases(purchData || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const handleCreateDebt = async () => {
    if (!activeOrg || !debtForm.description.trim() || !debtForm.amount_ars) return;
    setSavingDebt(true);
    try {
      const { error } = await supabase.from("supplier_debts").insert({
        org_id: activeOrg.id,
        supplier_name: debtForm.supplier_name || "Sin proveedor",
        supplier_id: debtForm.supplier_id || null,
        description: debtForm.description,
        amount_ars: Number(debtForm.amount_ars),
        paid_ars: 0,
        due_date: debtForm.due_date || null,
        notes: debtForm.notes || null,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Deuda registrada");
      setDebtOpen(false);
      setDebtForm(DEBT_EMPTY);
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingDebt(false); }
  };

  const handlePayDebt = async () => {
    if (!payDebtId || !payAmount || !activeOrg) return;
    const debt = debts.find(d => d.id === payDebtId);
    if (!debt) return;
    const amount = Math.min(Number(payAmount), debt.remaining_ars);
    setSavingDebt(true);
    try {
      await addSupplierPaymentDB(payDebtId, amount, { paymentMethod: payMethod });
      toast.success(`Pago de ${formatARS(amount)} registrado`);
      setPayDebtId(null);
      setPayAmount("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingDebt(false); }
  };

  const toggleDebtSelect = (id: string) => {
    setSelectedDebtIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const bulkPayDebts = async () => {
    const toMark = pendingDebts.filter(d => selectedDebtIds.has(d.id));
    if (!toMark.length || !activeOrg) return;
    setBulkPayLoading(true);
    try {
      await Promise.all(toMark.map(d => addSupplierPaymentDB(d.id, Number(d.remaining_ars), { paymentMethod: "transferencia" })));
      toast.success(`${toMark.length} deuda${toMark.length !== 1 ? "s" : ""} marcada${toMark.length !== 1 ? "s" : ""} como pagada${toMark.length !== 1 ? "s" : ""}`);
      setSelectedDebtIds(new Set());
      load();
    } catch { toast.error("Error al registrar pagos"); }
    finally { setBulkPayLoading(false); }
  };

  const pendingDebts = useMemo(() => debts.filter(d => d.status !== "paid"), [debts]);
  const totalPending = useMemo(() => pendingDebts.reduce((s, d) => s + Number(d.remaining_ars), 0), [pendingDebts]);

  const loadPurchases = async (supplierId: string) => {
    if (purchases[supplierId]) return;
    setLoadingPurchases(true);
    const { data } = await supabase
      .from("purchases")
      .select("id, product_name, quantity, total_ars, date")
      .eq("supplier_id", supplierId)
      .order("date", { ascending: false })
      .limit(10);
    setPurchases(prev => ({ ...prev, [supplierId]: (data || []) as PurchaseSummary[] }));
    setLoadingPurchases(false);
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ ...s }); setOpen(true); };

  const saveNote = async (id: string, note: string) => {
    await supabase.from("suppliers").update({ notes: note }).eq("id", id);
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, notes: note } : s));
    setEditingNote(null);
    toast.success("Nota guardada");
  };

  const handleSave = async () => {
    if (!form.name?.trim() || !activeOrg) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("suppliers")
          .update({ name: form.name, contact: form.contact, phone: form.phone, email: form.email, address: form.address, notes: form.notes, active: form.active })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Proveedor actualizado");
      } else {
        const { error } = await supabase.from("suppliers").insert({
          org_id: activeOrg.id,
          name: form.name,
          contact: form.contact || null,
          phone: form.phone || null,
          email: form.email || null,
          address: form.address || null,
          notes: form.notes || null,
          active: true,
        });
        if (error) throw error;
        toast.success("Proveedor agregado");
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Proveedor eliminado"); load(); }
  };

  const pendingBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    pendingDebts.forEach(d => {
      if (d.supplier_id) map[d.supplier_id] = (map[d.supplier_id] || 0) + Number(d.remaining_ars);
    });
    return map;
  }, [pendingDebts]);

  const filtered = useMemo(() => {
    const base = suppliers.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.contact || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.email || "").toLowerCase().includes(search.toLowerCase())
    );
    return [...base].sort((a, b) => {
      const { col, dir } = supplierSort;
      let cmp = 0;
      if (col === "name") cmp = a.name.localeCompare(b.name);
      else if (col === "pending") cmp = (pendingBySupplier[a.id] || 0) - (pendingBySupplier[b.id] || 0);
      else if (col === "created_at") cmp = a.created_at.localeCompare(b.created_at);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [suppliers, search, supplierSort, pendingBySupplier]);

  function exportSuppliersCSV() {
    const bom = '﻿';
    const header = ['Nombre', 'Contacto', 'Teléfono', 'Email', 'Dirección', 'Deuda pendiente (ARS)', 'Activo'];
    const rows = filtered.map(s => [
      s.name,
      s.contact || '',
      s.phone || '',
      s.email || '',
      s.address || '',
      String(pendingBySupplier[s.id] || 0),
      s.active ? 'Sí' : 'No',
    ]);
    const csv = bom + [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proveedores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast.success('CSV exportado');
  }

  function toggleSupplierSort(col: "name" | "pending" | "created_at") {
    setSupplierSort(prev => prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  const f = (k: keyof Supplier) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Truck}
        title="Proveedores"
        description={`${suppliers.filter(s => s.active).length} activos · ${formatARS(totalPending)} pendiente de pago`}
        badge={
          pendingDebts.length > 0
            ? { label: `${pendingDebts.length} deuda${pendingDebts.length > 1 ? "s" : ""} pendiente${pendingDebts.length > 1 ? "s" : ""}`, variant: "destructive" }
            : undefined
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {filtered.length > 0 && (
              <Button variant="outline" className="h-9 gap-2" onClick={exportSuppliersCSV} title="Exportar lista de proveedores a CSV">
                <FileSpreadsheet className="w-4 h-4" />CSV
              </Button>
            )}
            <Button variant="outline" className="h-9 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDebtOpen(true)}>
              <Plus className="w-4 h-4" />Nueva deuda
            </Button>
            <Button variant="outline" className="h-9 gap-2 border-primary/40 text-primary hover:bg-primary/10" onClick={() => { setPoSupplierId(undefined); setPoOpen(true); }} title="Generar orden de compra por stock bajo">
              <ShoppingCart className="w-4 h-4" /> Orden de compra
            </Button>
            <Button className="gradient-gold text-primary-foreground shadow-gold h-9" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo proveedor
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Proveedores activos" value={suppliers.filter(s => s.active).length} icon={Truck} color="primary"
          sub={`${suppliers.length} en total`} />
        <KPICard label="Deuda pendiente" value={formatARS(totalPending)} icon={DollarSign}
          color={pendingDebts.length > 0 ? "destructive" : "success"}
          sub={`${pendingDebts.length} deuda${pendingDebts.length !== 1 ? "s" : ""} abiertas`} />
        <KPICard label="Total compras" value={allPurchases.length} icon={ShoppingCart} color="blue"
          sub="órdenes históricas" />
        <KPICard label="Deudas pagadas" value={debts.filter(d => d.status === "paid").length} icon={CheckCircle2} color="success"
          sub={`${debts.length} en total`} />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 border border-border w-fit">
        {([
          { id: 'proveedores', label: 'Proveedores', icon: Store },
          { id: 'aging', label: 'Aging AP', icon: Clock },
          { id: 'pagos', label: 'Pagos', icon: CreditCard },
          { id: 'analytics', label: 'Analítica', icon: BarChart2 },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-card border border-border shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

        {activeTab === 'proveedores' && (<>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, contacto o email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1.5 shrink-0">
          {([
            { col: "name" as const, label: "Nombre" },
            { col: "pending" as const, label: "Deuda" },
            { col: "created_at" as const, label: "Alta" },
          ]).map(({ col, label }) => (
            <button
              key={col}
              onClick={() => toggleSupplierSort(col)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${supplierSort.col === col ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}
            >
              {label}
              {supplierSort.col === col
                ? supplierSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                : <ArrowUpDown className="w-3 h-3 opacity-50" />}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 pb-12">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Truck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {search ? "Sin resultados para tu búsqueda." : "Aún no hay proveedores. Agregá uno para vincularlos a tus compras."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filtered.map(s => (
            <div key={s.id} className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-card">
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{s.name}</span>
                    {!s.active && <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Inactivo</Badge>}
                    {pendingBySupplier[s.id] > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/20 text-destructive border border-destructive/30">
                        Debe {formatARS(pendingBySupplier[s.id])}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {s.contact && <span className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" />{s.contact}</span>}
                    {s.phone && (
                      <a href={`https://wa.me/${s.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                        className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors">
                        <Phone className="w-3 h-3" />{s.phone}
                      </a>
                    )}
                    {s.email && (
                      <a href={`mailto:${s.email}`}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
                        <Mail className="w-3 h-3" />{s.email}
                      </a>
                    )}
                    {s.address && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{s.address}</span>}
                  </div>
                  {/* Inline note display / edit */}
                  {editingNote?.id === s.id ? (
                    <div className="mt-2 space-y-1.5">
                      <Textarea
                        value={editingNote.value}
                        onChange={e => setEditingNote({ id: s.id, value: e.target.value })}
                        placeholder="Nota interna sobre el proveedor…"
                        className="text-xs h-16 resize-none bg-muted/40"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Escape') setEditingNote(null); }}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveNote(s.id, editingNote.value)} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-400/80 px-2 py-1 rounded bg-emerald-500/10 transition-colors">
                          <Check className="w-3 h-3" />Guardar
                        </button>
                        <button onClick={() => setEditingNote(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
                          <X className="w-3 h-3" />Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start gap-1.5 group/note">
                      {s.notes
                        ? <p className="text-xs text-muted-foreground/70 line-clamp-1 flex-1">{s.notes}</p>
                        : <p className="text-xs text-muted-foreground/40 italic flex-1 hidden group-hover/note:block">Sin nota</p>
                      }
                      <button onClick={() => setEditingNote({ id: s.id, value: s.notes || "" })}
                        className="p-0.5 rounded text-muted-foreground/40 hover:text-primary opacity-0 group-hover/note:opacity-100 transition-all shrink-0"
                        title="Editar nota">
                        <StickyNote className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      const newId = expandedId === s.id ? null : s.id;
                      setExpandedId(newId);
                      if (newId) loadPurchases(newId);
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    title="Ver compras"
                  >
                    {expandedId === s.id ? <ChevronUp className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => { setPoSupplierId(s.id); setPoOpen(true); }}
                    className="p-1.5 rounded-lg hover:bg-primary/10 text-primary/60 hover:text-primary transition-colors"
                    title="Generar orden de compra para este proveedor"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <ConfirmDialog
                    title="Eliminar proveedor"
                    description={`¿Eliminar "${s.name}"? Las compras vinculadas no se borrarán.`}
                    onConfirm={() => handleDelete(s.id)}
                    trigger={
                      <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    }
                  />
                </div>
              </div>

              {expandedId === s.id && (
                <div className="border-t border-border bg-muted/20 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ShoppingCart className="w-3 h-3" /> Últimas compras
                  </p>
                  {loadingPurchases ? (
                    <div className="h-8 bg-muted/40 rounded animate-pulse" />
                  ) : (purchases[s.id] || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">No hay compras vinculadas a este proveedor.</p>
                  ) : (
                    <div className="space-y-1 pb-12">
                      {(purchases[s.id] || []).map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{new Date(p.date).toLocaleDateString("es-AR")}</span>
                          <span className="flex-1 px-3 truncate">{p.product_name}</span>
                          <span className="text-muted-foreground">×{p.quantity}</span>
                          <span className="ml-3 font-medium">${p.total_ars?.toLocaleString("es-AR")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      </>)}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre *</label>
              <Input placeholder="Nombre del proveedor" value={form.name || ""} onChange={f("name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Contacto</label>
                <Input placeholder="Nombre de contacto" value={form.contact || ""} onChange={f("contact")} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
                <Input placeholder="+54 9 11…" value={form.phone || ""} onChange={f("phone")} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
              <Input type="email" placeholder="proveedor@empresa.com" value={form.email || ""} onChange={f("email")} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Dirección</label>
              <Input placeholder="Calle, ciudad, provincia" value={form.address || ""} onChange={f("address")} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
              <Textarea
                placeholder="Condiciones de pago, plazos, etc."
                value={form.notes || ""}
                onChange={f("notes")}
                className="h-20 resize-none"
              />
            </div>
            <Button
              className="w-full gradient-gold text-primary-foreground"
              disabled={!form.name?.trim() || saving}
              onClick={handleSave}
            >
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar proveedor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Aging AP Tab ── */}
      {activeTab === 'aging' && (<>
          <div className="space-y-4 pb-12">
            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-card border border-border/60 rounded-xl p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Pendiente total</p>
                <p className="text-xl font-bold font-display text-destructive">{formatARS(totalPending)}</p>
              </div>
              <div className="bg-card border border-border/60 rounded-xl p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Deudas activas</p>
                <p className="text-xl font-bold font-display">{pendingDebts.length}</p>
              </div>
              <div className="bg-card border border-border/60 rounded-xl p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Vencen esta semana</p>
                <p className={`text-xl font-bold font-display ${debts.filter(d => d.status !== 'paid' && d.due_date && new Date(d.due_date) < new Date(Date.now() + 7 * 86400000) && new Date(d.due_date) > new Date()).length > 0 ? 'text-yellow-400' : ''}`}>
                  {debts.filter(d => d.status !== 'paid' && d.due_date && new Date(d.due_date) < new Date(Date.now() + 7 * 86400000) && new Date(d.due_date) > new Date()).length}
                </p>
              </div>
            </div>

            {/* Aging de deudas */}
            {pendingDebts.length > 0 && (() => {
              const now = Date.now();
              const buckets = [
                { label: ">90 días", min: 90, color: "bg-red-500/80", textColor: "text-red-400" },
                { label: "61–90 días", min: 61, max: 90, color: "bg-orange-500/80", textColor: "text-orange-400" },
                { label: "31–60 días", min: 31, max: 60, color: "bg-yellow-500/80", textColor: "text-yellow-400" },
                { label: "1–30 días", min: 1, max: 30, color: "bg-amber-400/80", textColor: "text-amber-400" },
                { label: "Próx. 30d", min: -30, max: 0, color: "bg-blue-500/80", textColor: "text-blue-400" },
              ];
              const bucketed = buckets.map(b => {
                const items = pendingDebts.filter(d => {
                  if (!d.due_date) return false;
                  const days = Math.floor((now - new Date(d.due_date).getTime()) / 86400000);
                  const over = days >= (b.min ?? -Infinity);
                  const under = b.max === undefined ? true : days <= b.max;
                  return over && under;
                });
                return { ...b, count: items.length, total: items.reduce((s, d) => s + Number(d.remaining_ars), 0) };
              }).filter(b => b.count > 0);
              if (bucketed.length === 0) return null;
              const grandTotal = bucketed.reduce((s, b) => s + b.total, 0);
              return (
                <div className="bg-card border border-border/60 rounded-xl p-4">
                  <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Aging de deudas pendientes</h3>
                  <div className="space-y-2 pb-12">
                    {bucketed.map(b => {
                      const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
                      return (
                        <div key={b.label}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={`font-medium ${b.textColor}`}>{b.label}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-muted-foreground">{b.count} deuda{b.count !== 1 ? "s" : ""}</span>
                              <span className="font-semibold font-mono">{formatARS(b.total)}</span>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Bulk action bar */}
            {selectedDebtIds.size > 0 && (
              <div className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-2.5 mb-3">
                <span className="text-sm font-medium text-primary">{selectedDebtIds.size} seleccionada{selectedDebtIds.size !== 1 ? "s" : ""}</span>
                <Button size="sm" className="h-7 text-xs bg-emerald-500 text-white ml-auto" disabled={bulkPayLoading} onClick={bulkPayDebts}>
                  {bulkPayLoading ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  Marcar como pagadas (total)
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedDebtIds(new Set())}>Limpiar</Button>
              </div>
            )}

            {debts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Sin deudas registradas</p>
                <Button variant="outline" className="mt-4 gap-2" onClick={() => setDebtOpen(true)}>
                  <Plus className="w-4 h-4" />Registrar primera deuda
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pb-12">
                {debts.map(d => {
                  const overdue = d.status !== 'paid' && d.due_date && new Date(d.due_date) < new Date();
                  const sc = d.status === 'paid'
                    ? { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Pagada', icon: CheckCircle2 }
                    : d.status === 'partial'
                    ? { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Parcial', icon: Clock }
                    : { color: 'text-destructive', bg: 'bg-destructive/10', label: overdue ? 'Vencida' : 'Pendiente', icon: AlertCircle };
                  return (
                    <div key={d.id} className={`bg-card border rounded-xl p-4 space-y-2 ${overdue ? 'border-destructive/40' : 'border-border'}`}>
                      <div className="flex items-start justify-between gap-3">
                        {d.status !== 'paid' && (
                          <button onClick={() => toggleDebtSelect(d.id)} className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0">
                            {selectedDebtIds.has(d.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">{d.supplier_name}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.bg} ${sc.color}`}>
                              <sc.icon className="w-3 h-3" />{sc.label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{d.description}</p>
                          {d.due_date && (
                            <p className={`text-[10px] mt-0.5 ${overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                              Vence: {new Date(d.due_date).toLocaleDateString('es-AR')}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono font-bold text-sm">{formatARS(Number(d.remaining_ars))}</p>
                          {d.paid_ars > 0 && <p className="text-[10px] text-muted-foreground">{formatARS(Number(d.amount_ars))} total</p>}
                        </div>
                      </div>
                      {d.status !== 'paid' && (
                        <div className="flex gap-2 pt-1">
                          {payDebtId === d.id ? (
                            <div className="flex gap-2 flex-1">
                              <Input
                                type="number"
                                placeholder={`Máx ${formatARS(Number(d.remaining_ars))}`}
                                value={payAmount}
                                onChange={e => setPayAmount(e.target.value)}
                                className="h-8 text-xs bg-muted flex-1"
                              />
                              <Select value={payMethod} onValueChange={setPayMethod}>
                                <SelectTrigger className="h-8 text-xs bg-muted w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="efectivo">Efectivo</SelectItem>
                                  <SelectItem value="transferencia">Transferencia</SelectItem>
                                  <SelectItem value="cheque">Cheque</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button size="sm" className="h-8 text-xs px-3" onClick={handlePayDebt} disabled={savingDebt || !payAmount}>
                                {savingDebt ? "…" : "Pagar"}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setPayDebtId(null); setPayAmount(""); }}>×</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" onClick={() => { setPayDebtId(d.id); setPayAmount(""); }}>
                              <CreditCard className="w-3 h-3" />Registrar pago
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

      </>)}

      {/* ── Pagos Tab ── */}
      {activeTab === 'pagos' && (
        <div className="bg-card border border-border/60 rounded-xl p-8 text-center">
          <CreditCard className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Historial de pagos a proveedores — próximamente</p>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (() => {
        // Compute per-supplier analytics from allPurchases
        const supplierMap: Record<string, { name: string; count: number; totalARS: number; totalUSD: number; lastDate: string; products: Set<string> }> = {};
        allPurchases.forEach((p: any) => {
          const key = p.supplier_id || p.supplier_name || "Sin proveedor";
          const name = suppliers.find(s => s.id === p.supplier_id)?.name || p.supplier_name || "Sin proveedor";
          if (!supplierMap[key]) supplierMap[key] = { name, count: 0, totalARS: 0, totalUSD: 0, lastDate: "", products: new Set() };
          supplierMap[key].count++;
          supplierMap[key].totalARS += Number(p.total_ars || 0);
          supplierMap[key].totalUSD += Number(p.total_usd || 0);
          if (p.date > supplierMap[key].lastDate) supplierMap[key].lastDate = p.date;
          if (p.product_name) supplierMap[key].products.add(p.product_name);
        });
        const ranked = Object.entries(supplierMap)
          .map(([k, v]) => ({ key: k, ...v, productCount: v.products.size }))
          .sort((a, b) => b.totalARS - a.totalARS);
        const chartData = ranked.slice(0, 8).map(r => ({ name: r.name.length > 14 ? r.name.slice(0, 14) + "…" : r.name, totalARS: Math.round(r.totalARS / 1000) }));
        const totalSpend = ranked.reduce((s, r) => s + r.totalARS, 0);
        const totalOrders = allPurchases.length;
        const avgOrder = totalOrders > 0 ? totalSpend / totalOrders : 0;

        return (
          <div className="space-y-5 pb-12">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total compras", value: formatARS(totalSpend), sub: `${totalOrders} órdenes`, icon: ShoppingCart },
                { label: "Proveedores activos", value: ranked.length, sub: "con compras registradas", icon: Truck },
                { label: "Ticket promedio", value: formatARS(avgOrder), sub: "por orden de compra", icon: DollarSign },
                { label: "Proveedor top", value: ranked[0]?.name?.slice(0, 16) || "—", sub: ranked[0] ? formatARS(ranked[0].totalARS) : "", icon: TrendingUp },
              ].map(card => (
                <div key={card.label} className="bg-card border border-border/60 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <card.icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{card.label}</p>
                  </div>
                  <p className="text-base font-bold font-mono truncate">{card.value}</p>
                  {card.sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{card.sub}</p>}
                </div>
              ))}
            </div>

            {/* Bar chart */}
            {chartData.length > 0 && (
              <div className="bg-card border border-border/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  <BarChart2 className="w-3.5 h-3.5 inline mr-1.5" />Top 8 proveedores por gasto (ARS miles)
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 30 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v}k`} />
                    <Tooltip formatter={(v: number) => [formatARS(v * 1000), "Total"]} />
                    <Bar dataKey="totalARS" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? 'hsl(40,70%,50%)' : 'hsl(200,50%,40%)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Ranking table */}
            {ranked.length > 0 ? (
              <div className="bg-card border border-border/60 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Proveedor</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Órdenes</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Productos</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total ARS</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Última compra</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">% del gasto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {ranked.map((r, i) => {
                      const pct = totalSpend > 0 ? (r.totalARS / totalSpend) * 100 : 0;
                      return (
                        <tr key={r.key} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-mono w-5">#{i + 1}</span>
                              <span className="font-medium truncate max-w-[140px]">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{r.count}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground hidden sm:table-cell">{r.productCount}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatARS(r.totalARS)}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground hidden md:table-cell text-xs">
                            {r.lastDate ? new Date(r.lastDate + "T12:00:00").toLocaleDateString("es-AR") : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right hidden md:table-cell">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center">
                <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Sin compras registradas. Registrá compras en el módulo de Compras para ver analítica.</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* New Debt Dialog */}
      <Dialog open={debtOpen} onOpenChange={v => { setDebtOpen(v); if (!v) setDebtForm(DEBT_EMPTY); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva deuda con proveedor</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Proveedor</label>
              <Select value={debtForm.supplier_id} onValueChange={v => {
                const s = suppliers.find(s => s.id === v);
                setDebtForm(f => ({ ...f, supplier_id: v, supplier_name: s?.name || "" }));
              }}>
                <SelectTrigger className="bg-muted"><SelectValue placeholder="Seleccionar proveedor (opcional)" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!debtForm.supplier_id && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre del proveedor (manual)</label>
                <Input placeholder="Ej: Distribuidora Norte" value={debtForm.supplier_name} onChange={e => setDebtForm(f => ({ ...f, supplier_name: e.target.value }))} className="bg-muted" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Descripción *</label>
              <Input placeholder="Ej: Factura N° 0001 — mercadería mayo" value={debtForm.description} onChange={e => setDebtForm(f => ({ ...f, description: e.target.value }))} className="bg-muted" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Monto ARS *</label>
                <Input type="number" placeholder="0" value={debtForm.amount_ars} onChange={e => setDebtForm(f => ({ ...f, amount_ars: e.target.value }))} className="bg-muted" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vencimiento</label>
                <Input type="date" value={debtForm.due_date} onChange={e => setDebtForm(f => ({ ...f, due_date: e.target.value }))} className="bg-muted" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
              <Input placeholder="Condiciones, referencia, etc." value={debtForm.notes} onChange={e => setDebtForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDebtOpen(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground" disabled={!debtForm.description.trim() || !debtForm.amount_ars || savingDebt} onClick={handleCreateDebt}>
                {savingDebt ? "Guardando…" : "Registrar deuda"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Supplier PO Modal */}
      <SupplierPOModal
        open={poOpen}
        onClose={() => setPoOpen(false)}
        supplierId={poSupplierId}
      />
    </div>
  );
}
