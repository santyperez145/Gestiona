import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Receipt, Plus, Trash2, FileDown, CheckCircle2, Clock, XCircle,
  Send, Eye, ChevronDown, ChevronUp, DollarSign, FileText,
} from "lucide-react";

interface InvoiceItem { id?: string; description: string; quantity: number; unit_price: number; total: number }
interface Invoice {
  id: string; number: string; customer_name: string; customer_email: string | null;
  customer_address: string | null; customer_tax_id: string | null;
  issue_date: string; due_date: string | null; status: string; notes: string | null;
  currency: string; subtotal: number; tax_pct: number; tax_amount: number; total: number;
  paid_at: string | null; created_at: string;
  invoice_items?: InvoiceItem[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft:    { label: "Borrador",  color: "bg-muted text-muted-foreground border-border",              icon: FileText },
  sent:     { label: "Enviada",   color: "bg-blue-500/15 text-blue-400 border-blue-500/20",           icon: Send },
  paid:     { label: "Pagada",    color: "bg-green-500/15 text-green-400 border-green-500/20",        icon: CheckCircle2 },
  overdue:  { label: "Vencida",   color: "bg-red-500/15 text-red-400 border-red-500/20",              icon: XCircle },
  canceled: { label: "Cancelada", color: "bg-muted text-muted-foreground/50 border-border/50",        icon: XCircle },
};

const EMPTY_FORM = {
  customer_name: "", customer_email: "", customer_address: "", customer_tax_id: "",
  due_date: "", notes: "", tax_pct: "21",
};

function emptyItem(): InvoiceItem { return { description: "", quantity: 1, unit_price: 0, total: 0 }; }

function generatePDF(inv: Invoice, orgName: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, W, 80, "F");
  doc.setTextColor(212, 168, 67);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(orgName.toUpperCase(), 40, 38);
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 220);
  doc.text("FACTURA / COMPROBANTE", 40, 58);
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(`N° ${inv.number}`, W - 40, 38, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 200);
  doc.text(`Fecha: ${new Date(inv.issue_date).toLocaleDateString("es-AR")}`, W - 40, 56, { align: "right" });

  // Customer box
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", 40, 105);
  doc.setFont("helvetica", "normal");
  doc.text(inv.customer_name, 40, 118);
  if (inv.customer_tax_id) doc.text(`CUIT/DNI: ${inv.customer_tax_id}`, 40, 130);
  if (inv.customer_email) doc.text(inv.customer_email, 40, inv.customer_tax_id ? 142 : 130);
  if (inv.customer_address) doc.text(inv.customer_address, 40, 155);

  if (inv.due_date) {
    doc.setFont("helvetica", "bold");
    doc.text("VENCIMIENTO", W / 2, 105);
    doc.setFont("helvetica", "normal");
    doc.text(new Date(inv.due_date).toLocaleDateString("es-AR"), W / 2, 118);
  }

  // Items table
  const items = inv.invoice_items || [];
  autoTable(doc, {
    startY: 175,
    head: [["Descripción", "Cant.", "Precio unit.", "Total"]],
    body: items.map((it) => [
      it.description,
      String(it.quantity),
      formatARS(it.unit_price),
      formatARS(it.total),
    ]),
    theme: "grid",
    headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 45, halign: "right" }, 2: { cellWidth: 90, halign: "right" }, 3: { cellWidth: 90, halign: "right" } },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 16;
  const right = W - 40;

  const summaryRow = (label: string, value: string, bold = false, gold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 9);
    doc.setTextColor(gold ? 26 : 60, gold ? 26 : 60, gold ? 46 : 60);
    if (gold) { doc.setFillColor(212, 168, 67); doc.rect(W / 2, finalY - 4, W / 2 - 40, 18, "F"); }
    doc.text(label, W / 2 + 8, finalY + 9);
    doc.text(value, right, finalY + 9, { align: "right" });
    return finalY + 20;
  };

  let y = finalY;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Subtotal: ${formatARS(inv.subtotal)}`, W / 2 + 8, y + 9);
  doc.text(formatARS(inv.subtotal), right, y + 9, { align: "right" });
  y += 20;
  if (inv.tax_pct > 0) {
    doc.text(`IVA (${inv.tax_pct}%):`, W / 2 + 8, y + 9);
    doc.text(formatARS(inv.tax_amount), right, y + 9, { align: "right" });
    y += 20;
  }
  doc.setFillColor(212, 168, 67);
  doc.rect(W / 2, y - 2, W / 2 - 40, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(26, 26, 46);
  doc.text("TOTAL:", W / 2 + 8, y + 13);
  doc.text(formatARS(inv.total), right, y + 13, { align: "right" });

  // Notes
  if (inv.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Notas: ${inv.notes}`, 40, y + 40);
  }

  // Footer
  const fY = doc.internal.pageSize.getHeight() - 24;
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text("Documento generado automáticamente — Gestiona SaaS", W / 2, fY, { align: "center" });

  doc.save(`factura-${inv.number}.pdf`);
  toast.success("PDF generado");
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);

  const canManage = activeRole === "owner" || activeRole === "admin";

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select("*, invoice_items(*)")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setInvoices((data || []) as Invoice[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const recalcItems = (newItems: InvoiceItem[]) =>
    newItems.map((it) => ({ ...it, total: it.quantity * it.unit_price }));

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const taxAmt = subtotal * (Number(form.tax_pct) / 100);
  const total = subtotal + taxAmt;

  const nextNumber = async () => {
    if (!activeOrg) return "FAC-0001";
    const { data } = await supabase
      .from("invoice_sequences")
      .select("last_number")
      .eq("org_id", activeOrg.id)
      .single();
    const n = (data?.last_number || 0) + 1;
    await supabase.from("invoice_sequences").upsert({ org_id: activeOrg.id, last_number: n });
    return `FAC-${String(n).padStart(4, "0")}`;
  };

  const handleSave = async () => {
    if (!activeOrg || !user) return;
    if (!form.customer_name.trim()) { toast.error("Nombre del cliente requerido"); return; }
    if (items.every((it) => !it.description.trim())) { toast.error("Agregá al menos un ítem"); return; }
    setSaving(true);
    try {
      const number = await nextNumber();
      const { data: inv, error } = await supabase.from("invoices").insert({
        org_id: activeOrg.id,
        number,
        customer_name: form.customer_name,
        customer_email: form.customer_email || null,
        customer_address: form.customer_address || null,
        customer_tax_id: form.customer_tax_id || null,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: form.due_date || null,
        notes: form.notes || null,
        status: "draft",
        currency: "ARS",
        subtotal,
        tax_pct: Number(form.tax_pct),
        tax_amount: taxAmt,
        total,
        created_by: user.id,
      }).select().single();

      if (error) throw error;

      const validItems = items.filter((it) => it.description.trim());
      await supabase.from("invoice_items").insert(
        validItems.map((it) => ({
          invoice_id: inv!.id,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total: it.quantity * it.unit_price,
        }))
      );

      toast.success(`Factura ${number} creada`);
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      setItems([emptyItem()]);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const extra = status === "paid" ? { paid_at: new Date().toISOString() } : {};
    await supabase.from("invoices").update({ status, ...extra }).eq("id", id);
    load();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("¿Eliminar factura?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    toast.success("Factura eliminada");
    load();
  };

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0),
    pending: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.total), 0),
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">Facturas</h1>
            <p className="text-sm text-muted-foreground">Creá y gestioná comprobantes para tus clientes</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm(!showForm)} className="gradient-gold text-primary-foreground">
            <Plus className="w-4 h-4 mr-2" />Nueva factura
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Facturas totales", v: stats.total, icon: FileText, color: "" },
          { l: "Cobrado", v: formatARS(stats.paid), icon: CheckCircle2, color: "text-green-400" },
          { l: "Pendiente cobro", v: formatARS(stats.pending), icon: Clock, color: "text-blue-400" },
          { l: "Vencidas", v: stats.overdue, icon: XCircle, color: "text-red-400" },
        ].map((s) => (
          <div key={s.l} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
              <s.icon className="w-4 h-4 text-primary" />
            </div>
            <div className={`text-xl font-display font-bold ${s.color}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
          <h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" />Nueva factura</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Cliente *</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Nombre o razón social" />
            </div>
            <div>
              <Label className="text-xs">CUIT / DNI</Label>
              <Input value={form.customer_tax_id} onChange={(e) => setForm({ ...form, customer_tax_id: e.target.value })} placeholder="20-12345678-9" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} placeholder="cliente@email.com" />
            </div>
            <div>
              <Label className="text-xs">Dirección</Label>
              <Input value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} placeholder="Calle 123, CABA" />
            </div>
            <div>
              <Label className="text-xs">Vencimiento</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">IVA %</Label>
              <Input type="number" min={0} max={100} value={form.tax_pct} onChange={(e) => setForm({ ...form, tax_pct: e.target.value })} />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Ítems</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setItems([...items, emptyItem()])}>
                <Plus className="w-3 h-3 mr-1" />Agregar ítem
              </Button>
            </div>
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase px-1">
                <div className="col-span-6">Descripción</div>
                <div className="col-span-2 text-right">Cant.</div>
                <div className="col-span-2 text-right">Precio unit.</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-6 h-8 text-xs"
                    placeholder="Descripción del producto/servicio"
                    value={it.description}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, description: e.target.value };
                      setItems(recalcItems(n));
                    }}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs text-right"
                    type="number" min={1} step={1}
                    value={it.quantity}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, quantity: Number(e.target.value) };
                      setItems(recalcItems(n));
                    }}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs text-right"
                    type="number" min={0} step={100}
                    value={it.unit_price}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, unit_price: Number(e.target.value) };
                      setItems(recalcItems(n));
                    }}
                  />
                  <div className="col-span-1 text-right text-xs font-mono text-muted-foreground">
                    {formatARS(it.quantity * it.unit_price)}
                  </div>
                  <Button size="icon" variant="ghost" className="col-span-1 h-7 w-7" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="space-y-1 text-sm min-w-[220px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatARS(subtotal)}</span>
              </div>
              {Number(form.tax_pct) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IVA ({form.tax_pct}%)</span>
                  <span className="font-mono">{formatARS(taxAmt)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 font-bold text-primary">
                <span>Total</span>
                <span className="font-mono">{formatARS(total)}</span>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Condiciones de pago, observaciones..." />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground">
              {saving ? "Guardando..." : "Crear factura"}
            </Button>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Facturas ({invoices.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando...</div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Aún no hay facturas. Creá tu primera.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invoices.map((inv) => {
              const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
              const Icon = sc.icon;
              const isOpen = expanded === inv.id;
              return (
                <div key={inv.id}>
                  <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors">
                    <button className="flex-1 flex items-center gap-3 min-w-0 text-left" onClick={() => setExpanded(isOpen ? null : inv.id)}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{inv.number}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${sc.color}`}>
                            <Icon className="w-3 h-3" />{sc.label}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{inv.customer_name}</p>
                        <p className="text-xs text-muted-foreground/60">{new Date(inv.issue_date).toLocaleDateString("es-AR")}</p>
                      </div>
                    </button>
                    <div className="text-right shrink-0">
                      <div className="font-semibold font-mono text-sm">{formatARS(Number(inv.total))}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Descargar PDF"
                        onClick={() => generatePDF({ ...inv, invoice_items: inv.invoice_items || [] }, activeOrg?.name || "Gestiona")}
                      >
                        <FileDown className="w-4 h-4" />
                      </Button>
                      {canManage && inv.status === "draft" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Marcar como enviada"
                          onClick={() => updateStatus(inv.id, "sent")}
                        >
                          <Send className="w-4 h-4 text-blue-400" />
                        </Button>
                      )}
                      {canManage && inv.status === "sent" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Marcar como pagada"
                          onClick={() => updateStatus(inv.id, "paid")}
                        >
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        </Button>
                      )}
                      {canManage && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteInvoice(inv.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border bg-muted/10 px-5 py-4 space-y-3">
                      {inv.customer_email && <p className="text-xs text-muted-foreground">Email: {inv.customer_email}</p>}
                      {inv.customer_tax_id && <p className="text-xs text-muted-foreground">CUIT/DNI: {inv.customer_tax_id}</p>}
                      {inv.due_date && <p className="text-xs text-muted-foreground">Vence: {new Date(inv.due_date).toLocaleDateString("es-AR")}</p>}
                      {inv.invoice_items && inv.invoice_items.length > 0 && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground uppercase tracking-wide border-b border-border">
                              <th className="text-left py-1">Descripción</th>
                              <th className="text-right py-1">Cant.</th>
                              <th className="text-right py-1">Precio unit.</th>
                              <th className="text-right py-1">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.invoice_items.map((it, i) => (
                              <tr key={i} className="border-b border-border/40">
                                <td className="py-1.5">{it.description}</td>
                                <td className="text-right">{it.quantity}</td>
                                <td className="text-right font-mono">{formatARS(it.unit_price)}</td>
                                <td className="text-right font-mono">{formatARS(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="flex justify-end gap-4 text-xs font-mono pt-1">
                        <span className="text-muted-foreground">Subtotal: {formatARS(Number(inv.subtotal))}</span>
                        {Number(inv.tax_pct) > 0 && <span className="text-muted-foreground">IVA: {formatARS(Number(inv.tax_amount))}</span>}
                        <span className="font-bold text-primary">Total: {formatARS(Number(inv.total))}</span>
                      </div>
                      {inv.notes && <p className="text-xs text-muted-foreground italic">Notas: {inv.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
