import { useState, useEffect, useRef, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Trash2, Search, FileText, Download, Send,
  CheckCircle2, XCircle, Clock, Eye, Copy, X, ChevronDown, ChevronUp, Link2, Loader2,
  DollarSign, Mail, CopyPlus, Bookmark, BookOpen, Sparkles, User, Package, Zap, ArrowUpDown,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { formatARS, addSaleDB } from "@/lib/supabaseStore";
import { usePageTitle } from "@/hooks/usePageTitle";

type QuoteItem = { description: string; qty: number; unitPrice: number; total: number };
type Quote = {
  id: string;
  quote_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items: QuoteItem[];
  subtotal: number;
  discount_amount: number;
  total: number;
  status: string;
  valid_until: string | null;
  notes: string;
  created_at: string;
};
type CustomerSuggestion = { id: string; name: string; email: string | null; phone: string | null; company: string | null };
type ProductSuggestion = { id: string; name: string; sale_price_ars: number; stock: number; category: string };
type QuoteTemplate = { name: string; items: QuoteItem[]; notes?: string };

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:    { label: "Borrador",  color: "text-muted-foreground bg-muted/30 border-border" },
  sent:     { label: "Enviado",   color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  accepted: { label: "Aceptado", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  rejected: { label: "Rechazado",color: "text-destructive bg-destructive/10 border-destructive/20" },
  expired:  { label: "Vencido",  color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  draft:    <Clock className="w-3 h-3" />,
  sent:     <Send className="w-3 h-3" />,
  accepted: <CheckCircle2 className="w-3 h-3" />,
  rejected: <XCircle className="w-3 h-3" />,
  expired:  <Clock className="w-3 h-3" />,
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${c.color}`}>
      {STATUS_ICON[status]}{c.label}
    </span>
  );
}

// ─── Customer autocomplete ────────────────────────────────────────────────────
function CustomerSearch({
  value, onChange, onSelect, orgId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: CustomerSuggestion) => void;
  orgId: string;
}) {
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (!q.trim() || q.length < 2) { setSuggestions([]); setOpen(false); return; }
    clearTimeout(timer.current!);
    timer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, email, phone, company")
        .eq("org_id", orgId)
        .ilike("name", `%${q}%`)
        .limit(6);
      if (data && data.length > 0) {
        setSuggestions(data as CustomerSuggestion[]);
        setOpen(true);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    }, 200);
  }, [orgId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Nombre del cliente…"
          value={value}
          className="pl-8"
          onChange={e => { onChange(e.target.value); search(e.target.value); }}
          onFocus={() => value.length >= 2 && suggestions.length > 0 && setOpen(true)}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(c => (
            <button
              key={c.id}
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
              onClick={() => { onSelect(c); setOpen(false); setSuggestions([]); }}
            >
              <div className="flex items-center gap-2">
                <User className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{c.name}</span>
                {c.company && <span className="text-xs text-muted-foreground">· {c.company}</span>}
              </div>
              <div className="flex gap-3 mt-0.5 pl-5">
                {c.email && <span className="text-[10px] text-muted-foreground">{c.email}</span>}
                {c.phone && <span className="text-[10px] text-muted-foreground">{c.phone}</span>}
              </div>
            </button>
          ))}
          <div className="px-3 py-1.5 bg-muted/20 text-[10px] text-muted-foreground">
            ↑↓ navegar · Enter seleccionar · Esc cerrar
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Product search for item rows ─────────────────────────────────────────────
function ProductSearch({
  value, onChange, onSelect, orgId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (p: ProductSuggestion) => void;
  orgId: string;
}) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (!q.trim() || q.length < 2) { setSuggestions([]); setOpen(false); return; }
    clearTimeout(timer.current!);
    timer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, sale_price_ars, stock, category")
        .eq("org_id", orgId)
        .ilike("name", `%${q}%`)
        .limit(6);
      if (data && data.length > 0) {
        setSuggestions(data as ProductSuggestion[]);
        setOpen(true);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    }, 200);
  }, [orgId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1">
      <Input
        className="h-8 text-xs w-full"
        placeholder="Producto o descripción…"
        value={value}
        onChange={e => { onChange(e.target.value); search(e.target.value); }}
        onFocus={() => value.length >= 2 && suggestions.length > 0 && setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
              onClick={() => { onSelect(p); setOpen(false); setSuggestions([]); }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Package className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">{p.name}</span>
                </div>
                <span className="text-xs font-bold text-primary shrink-0">{formatARS(p.sale_price_ars)}</span>
              </div>
              <div className="flex gap-3 mt-0.5 pl-4">
                <span className="text-[10px] text-muted-foreground">{p.category}</span>
                <span className={`text-[10px] font-medium ${p.stock <= 0 ? "text-destructive" : p.stock <= 3 ? "text-orange-400" : "text-emerald-400"}`}>
                  stock: {p.stock}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────
async function generatePDF(quote: Quote, orgName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210, PH = 297;

  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, PW, 35, "F");
  doc.setTextColor(212, 168, 67);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(orgName, 15, 15);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text("PRESUPUESTO", 15, 25);
  doc.setFontSize(10);
  doc.text(quote.quote_number, PW - 15, 15, { align: "right" });
  doc.setFontSize(9);
  doc.text(`Fecha: ${new Date(quote.created_at).toLocaleDateString("es-AR")}`, PW - 15, 22, { align: "right" });
  if (quote.valid_until) doc.text(`Válido hasta: ${new Date(quote.valid_until).toLocaleDateString("es-AR")}`, PW - 15, 29, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PARA:", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.text(quote.customer_name, 15, 57);
  if (quote.customer_email) doc.text(quote.customer_email, 15, 63);
  if (quote.customer_phone) doc.text(quote.customer_phone, 15, 69);

  const rows = quote.items.map(item => [
    item.description,
    item.qty.toString(),
    formatARS(item.unitPrice),
    formatARS(item.total),
  ]);

  autoTable(doc, {
    startY: 78,
    head: [["Descripción", "Cant.", "Precio unit.", "Total"]],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 35, halign: "right" }, 3: { cellWidth: 35, halign: "right" } },
    styles: { fontSize: 9 },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const RIGHT = PW - 15;
  const COL = PW - 70;

  doc.setFontSize(9);
  if (quote.discount_amount > 0) {
    doc.text("Subtotal:", COL, finalY, { align: "right" });
    doc.text(formatARS(quote.subtotal), RIGHT, finalY, { align: "right" });
    doc.text("Descuento:", COL, finalY + 6, { align: "right" });
    doc.setTextColor(180, 40, 40);
    doc.text(`-${formatARS(quote.discount_amount)}`, RIGHT, finalY + 6, { align: "right" });
    doc.setTextColor(30, 30, 30);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL:", COL, finalY + (quote.discount_amount > 0 ? 14 : 6), { align: "right" });
  doc.text(formatARS(quote.total), RIGHT, finalY + (quote.discount_amount > 0 ? 14 : 6), { align: "right" });

  if (quote.notes) {
    const notesY = finalY + 28;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text("Notas:", 15, notesY);
    const lines = doc.splitTextToSize(quote.notes, PW - 30);
    doc.text(lines, 15, notesY + 5);
  }

  doc.save(`presupuesto_${quote.quote_number}.pdf`);
}

async function generateRemito(quote: Quote, orgName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210;

  doc.setFillColor(20, 83, 45);
  doc.rect(0, 0, PW, 35, "F");
  doc.setTextColor(134, 239, 172);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(orgName, 15, 15);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text("REMITO DE ENTREGA", 15, 25);
  doc.setFontSize(10);
  doc.text(`Ref: ${quote.quote_number}`, PW - 15, 15, { align: "right" });
  doc.setFontSize(9);
  doc.text(`Fecha: ${new Date().toLocaleDateString("es-AR")}`, PW - 15, 22, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("ENTREGAR A:", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.text(quote.customer_name, 15, 57);
  if (quote.customer_phone) doc.text(quote.customer_phone, 15, 63);

  const rows = quote.items.map(item => [
    item.qty.toString(),
    item.description,
    "□ Recibido",
  ]);

  autoTable(doc, {
    startY: 73,
    head: [["Cant.", "Descripción", "Confirmación"]],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [20, 83, 45], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 15, halign: "center" }, 1: { cellWidth: 130 }, 2: { cellWidth: 35, halign: "center" } },
    styles: { fontSize: 9, cellPadding: 5 },
  });

  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("Firma recepción: __________________________________", 15, finalY);
  doc.text(`Aclaración: __________________________  DNI: ______________`, 15, finalY + 12);
  doc.text(`Fecha de recepción: ______________`, 15, finalY + 24);

  doc.save(`remito_${quote.quote_number}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Default valid_until (+15 days) ──────────────────────────────────────────
function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

export default function PresupuestosPage() {
  usePageTitle("Presupuestos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewByCustomer, setViewByCustomer] = useState(false);
  const [quoteSort, setQuoteSort] = useState<{ col: "date" | "total" | "customer"; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });

  // Form state
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([{ description: "", qty: 1, unitPrice: 0, total: 0 }]);
  const [discountAmount, setDiscountAmount] = useState("0");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [orgName, setOrgName] = useState("Mi Negocio");
  const [mpLinks, setMpLinks] = useState<Record<string, string>>({});
  const [mpLoading, setMpLoading] = useState<string | null>(null);
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});
  const [payLinkLoading, setPayLinkLoading] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState<string | null>(null);

  const [showBulkReminder, setShowBulkReminder] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = useCallback(() => {
    if (!activeOrg) return;
    const raw = localStorage.getItem(`gestiona_quote_templates_${activeOrg.id}`);
    setTemplates(raw ? JSON.parse(raw) : []);
  }, [activeOrg]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const saveTemplate = () => {
    if (!templateName.trim() || !activeOrg) return;
    setSavingTemplate(true);
    const tpl: QuoteTemplate = {
      name: templateName.trim(),
      items: items.filter(it => it.description.trim()),
      notes,
    };
    const next = [...templates.filter(t => t.name !== tpl.name), tpl];
    localStorage.setItem(`gestiona_quote_templates_${activeOrg.id}`, JSON.stringify(next));
    setTemplates(next);
    setTemplateName("");
    setSavingTemplate(false);
    toast.success(`Plantilla "${tpl.name}" guardada`);
  };

  const loadTemplate = (tpl: QuoteTemplate) => {
    setItems(tpl.items.length > 0 ? tpl.items : [{ description: "", qty: 1, unitPrice: 0, total: 0 }]);
    if (tpl.notes) setNotes(tpl.notes);
    setShowTemplates(false);
    toast.success(`Plantilla "${tpl.name}" cargada`);
  };

  const deleteTemplate = (name: string) => {
    if (!activeOrg) return;
    const next = templates.filter(t => t.name !== name);
    localStorage.setItem(`gestiona_quote_templates_${activeOrg.id}`, JSON.stringify(next));
    setTemplates(next);
    toast.success("Plantilla eliminada");
  };

  const generatePayLink = async (q: Quote) => {
    if (payLinks[q.id]) { navigator.clipboard.writeText(payLinks[q.id]); toast.success("Link copiado"); return; }
    setPayLinkLoading(q.id);
    try {
      const { data, error } = await supabase
        .from("payment_links")
        .insert({
          org_id: activeOrg!.id,
          quote_id: q.id,
          quote_number: q.quote_number,
          customer_name: q.customer_name,
          customer_phone: q.customer_phone || null,
          items: q.items,
          total_ars: q.total,
          mp_link: mpLinks[q.id] || null,
          notes: q.notes || null,
          expires_at: q.valid_until || null,
        })
        .select("id")
        .single();
      if (error || !data) throw error || new Error("Error creating payment link");
      const url = `${window.location.origin}/pagar/${data.id}`;
      setPayLinks(prev => ({ ...prev, [q.id]: url }));
      navigator.clipboard.writeText(url);
      toast.success("Link de pago copiado — compartilo por WhatsApp");
    } catch {
      toast.error("Error al generar link de pago");
    } finally {
      setPayLinkLoading(null);
    }
  };

  const sendQuoteEmail = async (q: Quote) => {
    if (!q.customer_email) { toast.error("El presupuesto no tiene email de cliente"); return; }
    setEmailLoading(q.id);
    try {
      const { error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          to: q.customer_email,
          subject: `Presupuesto ${q.quote_number} — ${orgName}`,
          invoiceNumber: q.quote_number,
          customerName: q.customer_name,
          orgName,
          totalARS: q.total,
          dueDate: q.valid_until || null,
          notes: [
            q.items.map(it => `• ${it.qty}× ${it.description} — ${formatARS(it.total)}`).join("\n"),
            q.notes ? `\nNotas: ${q.notes}` : "",
          ].join(""),
        },
      });
      if (error) throw error;
      toast.success(`Presupuesto enviado a ${q.customer_email}`);
      if (q.status === "draft") updateStatus(q.id, "sent");
    } catch {
      toast.error("Error al enviar el email");
    } finally {
      setEmailLoading(null);
    }
  };

  const generateMpLink = async (q: Quote) => {
    if (mpLinks[q.id]) { navigator.clipboard.writeText(mpLinks[q.id]); toast.success("Link copiado"); return; }
    setMpLoading(q.id);
    const { data, error } = await supabase.functions.invoke("mercadopago-link", {
      body: { orgId: activeOrg?.id, title: `Presupuesto ${q.quote_number} — ${q.customer_name}`, total: q.total },
    });
    setMpLoading(null);
    if (error || data?.error) { toast.error(data?.error || "Error al generar link MP"); return; }
    setMpLinks(prev => ({ ...prev, [q.id]: data.url }));
    navigator.clipboard.writeText(data.url);
    toast.success("Link de pago MercadoPago copiado");
  };

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setQuotes((data as unknown as Quote[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (activeOrg) {
      supabase.from("organizations").select("name").eq("id", activeOrg.id).maybeSingle()
        .then(({ data }) => { if (data?.name) setOrgName(data.name); });
    }
  }, [activeOrg]);

  const updateItem = (i: number, field: keyof QuoteItem, val: string | number) => {
    setItems(prev => {
      const next = [...prev];
      (next[i] as Record<string, unknown>)[field] = val;
      next[i].total = Number(next[i].qty) * Number(next[i].unitPrice);
      return next;
    });
  };

  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const total = subtotal - (parseFloat(discountAmount) || 0);

  const resetForm = () => {
    setCustName(""); setCustEmail(""); setCustPhone("");
    setItems([{ description: "", qty: 1, unitPrice: 0, total: 0 }]);
    setDiscountAmount("0"); setValidUntil(defaultValidUntil()); setNotes("");
    setAutoSend(false); setShowTemplates(false); setTemplateName("");
  };

  const handleSave = async () => {
    if (!custName.trim() || !activeOrg || !user) return;
    if (items.every(it => !it.description.trim())) {
      toast.error("Agregá al menos un ítem con descripción");
      return;
    }
    setSaving(true);
    try {
      const { data: numData } = await supabase.rpc("next_quote_number", { p_org_id: activeOrg.id });
      const quoteNumber = numData || `PRE-${Date.now()}`;

      const { data: newQuote, error } = await supabase.from("quotes").insert({
        org_id: activeOrg.id,
        quote_number: quoteNumber,
        customer_name: custName,
        customer_email: custEmail || null,
        customer_phone: custPhone || null,
        items: items.filter(it => it.description.trim()),
        subtotal,
        discount_amount: parseFloat(discountAmount) || 0,
        total: Math.max(0, total),
        status: "draft",
        valid_until: validUntil || null,
        notes: notes || null,
        created_by: user.id,
      }).select().single();
      if (error) throw error;

      toast.success(`Presupuesto ${quoteNumber} creado`);
      setOpen(false);
      resetForm();
      load();

      // Auto-send por email si está activado y hay email
      if (autoSend && custEmail && newQuote) {
        const q = newQuote as unknown as Quote;
        await sendQuoteEmail(q);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Estado actualizado: ${STATUS_CONFIG[status]?.label}`); load(); }
  };

  const [duplicating, setDuplicating] = useState<string | null>(null);

  const duplicateQuote = async (q: Quote) => {
    if (!activeOrg || !user) return;
    setDuplicating(q.id);
    try {
      const { data: numData } = await supabase.rpc("next_quote_number", { p_org_id: activeOrg.id });
      const quoteNumber = numData || `PRE-${Date.now()}`;
      const { error } = await supabase.from("quotes").insert({
        org_id: activeOrg.id,
        quote_number: quoteNumber,
        customer_name: q.customer_name,
        customer_email: q.customer_email || null,
        customer_phone: q.customer_phone || null,
        items: q.items,
        subtotal: q.subtotal,
        discount_amount: q.discount_amount || 0,
        total: q.total,
        status: "draft",
        valid_until: defaultValidUntil(),
        notes: q.notes || null,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success(`Presupuesto duplicado: ${quoteNumber}`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Error al duplicar");
    } finally {
      setDuplicating(null);
    }
  };

  const [converting, setConverting] = useState<string | null>(null);
  const [convertModal, setConvertModal] = useState<{ quote: Quote; method: string } | null>(null);

  const confirmConvert = async () => {
    if (!convertModal || !activeOrg || !user) return;
    const { quote: q, method } = convertModal;
    setConverting(q.id);
    setConvertModal(null);
    try {
      await addSaleDB({
        id: crypto.randomUUID(),
        user_id: user.id,
        org_id: activeOrg.id,
        product_name: q.items.map(it => it.description).join(", ").slice(0, 120),
        quantity: q.items.reduce((s, it) => s + it.qty, 0) || 1,
        unit_price_ars: q.total,
        total_ars: q.total,
        profit_ars: 0,
        profit_usd: 0,
        customer_name: q.customer_name || null,
        date: new Date().toISOString(),
        paid: true,
        payment_method: method,
        quote_id: q.id,
        source: "presupuesto",
      });
      await updateStatus(q.id, "accepted");
      toast.success(`Venta de ${formatARS(q.total)} registrada`);
    } catch (e: any) {
      toast.error(e.message || "Error al convertir");
    } finally {
      setConverting(null);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Presupuesto eliminado"); load(); }
  };

  const copyWhatsApp = (q: Quote) => {
    const lines = [
      `*Presupuesto ${q.quote_number}*`,
      `Cliente: ${q.customer_name}`,
      `Fecha: ${new Date(q.created_at).toLocaleDateString("es-AR")}`,
      q.valid_until ? `Válido hasta: ${new Date(q.valid_until).toLocaleDateString("es-AR")}` : "",
      "",
      "*Ítems:*",
      ...q.items.map(it => `• ${it.description} × ${it.qty} = ${formatARS(it.total)}`),
      "",
      q.discount_amount > 0 ? `Descuento: -${formatARS(q.discount_amount)}` : "",
      `*TOTAL: ${formatARS(q.total)}*`,
      q.notes ? `\nNotas: ${q.notes}` : "",
    ].filter(l => l !== null && l !== undefined);
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copiado para WhatsApp");
  };

  const now30 = new Date(); now30.setDate(now30.getDate() - 30);
  const expiredQuotes = quotes.filter(q =>
    (q.status === "draft" || q.status === "sent") &&
    new Date(q.created_at) < now30
  );

  const filtered = (() => {
    const base = quotes.filter(q => {
      let matchStatus: boolean;
      if (filterStatus === "all") matchStatus = true;
      else if (filterStatus === "expired_pending") matchStatus = expiredQuotes.some(e => e.id === q.id);
      else matchStatus = q.status === filterStatus;
      const matchSearch = q.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        q.quote_number.toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSearch;
    });
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (quoteSort.col === "date") cmp = a.created_at.localeCompare(b.created_at);
      else if (quoteSort.col === "total") cmp = a.total - b.total;
      else if (quoteSort.col === "customer") cmp = a.customer_name.localeCompare(b.customer_name);
      return quoteSort.dir === "asc" ? cmp : -cmp;
    });
  })();

  const stats = {
    total: quotes.length,
    accepted: quotes.filter(q => q.status === "accepted").length,
    totalValue: quotes.filter(q => q.status === "accepted").reduce((s, q) => s + q.total, 0),
    pending: quotes.filter(q => q.status === "sent").length,
    expired: expiredQuotes.length,
    conversionRate: quotes.length > 0
      ? Math.round(quotes.filter(q => q.status === "accepted").length / quotes.length * 100)
      : 0,
  };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        icon={FileText}
        title="Presupuestos"
        description={`${quotes.length} presupuestos · ${stats.accepted} aceptados · ${stats.conversionRate}% conversión`}
        badge={
          stats.pending > 0
            ? { label: `${stats.pending} en espera`, variant: "warning" }
            : stats.accepted > 0
            ? { label: `${stats.accepted} aceptados`, variant: "success" }
            : undefined
        }
        actions={
          <Button className="gradient-gold text-primary-foreground shadow-gold h-9" onClick={() => { resetForm(); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo presupuesto
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Total generados" value={stats.total} icon={FileText} color="primary" />
        <KPICard label="Aceptados" value={stats.accepted} icon={CheckCircle2} color="success"
          sub={stats.total > 0 ? `${stats.conversionRate}% conversión` : undefined} />
        <KPICard label="En espera" value={stats.pending} icon={Clock}
          color={stats.pending > 0 ? "warning" : "primary"} sub="enviados al cliente" />
        <KPICard label="Valor ganado" value={formatARS(stats.totalValue)} icon={DollarSign} color="success" sub="de presupuestos aceptados" />
      </div>

      {/* Expired / pending sent banner */}
      {(stats.expired > 0 || stats.pending > 0) && (
        <div className="bg-orange-500/5 border border-orange-500/30 rounded-xl p-3 flex items-center gap-3">
          <Clock className="w-4 h-4 text-orange-400 shrink-0" />
          <p className="text-sm text-orange-400 flex-1">
            {stats.expired > 0 && (
              <><span className="font-semibold">{stats.expired} presupuesto{stats.expired !== 1 ? "s" : ""}</span> sin respuesta +30 días. </>
            )}
            {stats.pending > 0 && (
              <><span className="font-semibold">{stats.pending} enviado{stats.pending !== 1 ? "s" : ""}</span> esperando respuesta.</>
            )}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {stats.expired > 0 && (
              <button
                className="text-xs px-3 py-1.5 rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
                onClick={() => setFilterStatus("expired_pending")}
              >
                Ver +30d ({stats.expired})
              </button>
            )}
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors flex items-center gap-1"
              onClick={() => setShowBulkReminder(v => !v)}
            >
              <Send className="w-3 h-3" />Recordatorio masivo
            </button>
          </div>
        </div>
      )}

      {/* Bulk WhatsApp reminder panel */}
      {showBulkReminder && (() => {
        const sentQuotes = quotes.filter(q => q.status === "sent");
        const daysAgo = (dateStr: string) => Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
        return (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                <Send className="w-4 h-4" />Recordatorio masivo por WhatsApp
                <span className="text-xs font-normal text-muted-foreground">({sentQuotes.length} presupuestos enviados)</span>
              </h3>
              <button onClick={() => setShowBulkReminder(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {sentQuotes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No hay presupuestos en estado "Enviado".</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {sentQuotes.map(q => {
                  const days = daysAgo(q.created_at);
                  const phone = (q.customer_phone || "").replace(/[^0-9]/g, "");
                  const msg = encodeURIComponent(
                    `Hola ${q.customer_name.split(" ")[0]}! Te escribo para hacer seguimiento del presupuesto *${q.quote_number}* que te enviamos hace ${days} día${days !== 1 ? "s" : ""} por *${formatARS(q.total)}*.\n¿Tuviste oportunidad de revisarlo? Quedamos a disposición para cualquier consulta. 😊`
                  );
                  return (
                    <div key={q.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 border border-border/40">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{q.customer_name} · #{q.quote_number}</p>
                        <p className="text-[10px] text-muted-foreground">{formatARS(q.total)} · hace {days} días</p>
                      </div>
                      {phone ? (
                        <a
                          href={`https://wa.me/${phone}?text=${msg}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors shrink-0 font-medium"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground shrink-0">Sin teléfono</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente o número…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-xs">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
            <SelectItem value="expired_pending">⚠ Sin respuesta +30d</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setViewByCustomer(v => !v)}
          className={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-all shrink-0 ${viewByCustomer ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground hover:text-foreground'}`}
          title="Agrupar por cliente"
        >
          👤 Por cliente
        </button>
        {/* Sort buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
          {(["date", "total", "customer"] as const).map(col => {
            const labels: Record<string, string> = { date: "Fecha", total: "Monto", customer: "Cliente" };
            const active = quoteSort.col === col;
            return (
              <button key={col} onClick={() => setQuoteSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "date" ? "desc" : "asc" })}
                className={`text-xs px-2 py-1.5 rounded-md border transition-colors flex items-center gap-0.5 ${active ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}>
                {labels[col]}
                {active && (quoteSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </button>
            );
          })}
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => {
          const bom = '﻿';
          const headers = ['Número', 'Cliente', 'Email', 'Teléfono', 'Total ARS', 'Estado', 'Válido hasta', 'Fecha creación', 'Notas'];
          const rows = filtered.map(q => [
            q.quote_number,
            q.customer_name,
            q.customer_email || '',
            q.customer_phone || '',
            Number(q.total).toFixed(2),
            STATUS_CONFIG[q.status]?.label || q.status,
            q.valid_until ? new Date(q.valid_until).toLocaleDateString('es-AR') : '',
            new Date(q.created_at).toLocaleDateString('es-AR'),
            q.notes || '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          const csv = bom + [headers.join(','), ...rows].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
          a.download = `presupuestos-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          toast.success('Presupuestos exportados');
        }}>
          <Download className="w-3.5 h-3.5 mr-1.5" />CSV
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 pb-12">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">{search || filterStatus !== "all" ? "Sin resultados." : "Aún no hay presupuestos."}</p>
        </div>
      ) : viewByCustomer ? (
        <div className="space-y-3 pb-12">
          {(() => {
            const byCustomer: Record<string, { total: number; accepted: number; pending: number; quotes: typeof filtered }> = {};
            filtered.forEach(q => {
              const key = q.customer_name || '(Sin cliente)';
              if (!byCustomer[key]) byCustomer[key] = { total: 0, accepted: 0, pending: 0, quotes: [] };
              byCustomer[key].total += Number(q.total);
              if (q.status === 'accepted') byCustomer[key].accepted++;
              else if (q.status === 'sent' || q.status === 'draft') byCustomer[key].pending++;
              byCustomer[key].quotes.push(q);
            });
            return Object.entries(byCustomer)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([customer, data]) => (
                <div key={customer} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
                    <div>
                      <span className="font-semibold text-sm">{customer}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{data.quotes.length} presupuesto{data.quotes.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {data.accepted > 0 && <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{data.accepted} aceptado{data.accepted !== 1 ? 's' : ''}</span>}
                      {data.pending > 0 && <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">{data.pending} pendiente{data.pending !== 1 ? 's' : ''}</span>}
                      <span className="font-bold text-sm text-primary">{formatARS(data.total)}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {data.quotes.map(q => {
                      const cfg = STATUS_CONFIG[q.status] || { label: q.status, color: 'bg-muted text-muted-foreground' };
                      return (
                        <div key={q.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs text-muted-foreground">#{q.quote_number}</span>
                          <span className="text-xs text-muted-foreground flex-1">{q.valid_until ? `Válido hasta ${new Date(q.valid_until).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}` : ''}</span>
                          <span className="font-semibold text-sm">{formatARS(Number(q.total))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
          })()}
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filtered.map(q => {
            const today = new Date().toISOString().slice(0, 10);
            const daysUntilExpiry = q.valid_until
              ? Math.ceil((new Date(q.valid_until).getTime() - new Date(today).getTime()) / 86400000)
              : null;
            const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 3
              && q.status !== "accepted" && q.status !== "rejected";
            const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0
              && q.status !== "accepted" && q.status !== "rejected";
            return (
            <div key={q.id} className={`bg-card border rounded-[10px] overflow-hidden shadow-card ${isExpiringSoon ? "border-yellow-500/40" : isExpired ? "border-destructive/30" : "border-border/60"}`}>
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">{q.quote_number}</span>
                    <StatusBadge status={q.status} />
                    {isExpiringSoon && (
                      <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 rounded-full px-2 py-0.5">
                        Vence en {daysUntilExpiry === 0 ? "hoy" : `${daysUntilExpiry}d`}
                      </span>
                    )}
                    {isExpired && (
                      <span className="text-[10px] font-semibold text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
                        Vencido hace {Math.abs(daysUntilExpiry!)}d
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-sm mt-0.5">{q.customer_name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">{new Date(q.created_at).toLocaleDateString("es-AR")}</span>
                    {q.valid_until && <span className="text-xs text-muted-foreground">válido hasta {new Date(q.valid_until).toLocaleDateString("es-AR")}</span>}
                    <span className="text-sm font-bold text-primary">{formatARS(q.total)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                  >
                    {expandedId === q.id ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => generatePDF(q, orgName)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Descargar PDF presupuesto">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => generateRemito(q, orgName)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Remito de entrega">
                    <FileText className="w-4 h-4" />
                  </button>
                  {q.customer_email && (
                    <button
                      onClick={() => sendQuoteEmail(q)}
                      disabled={emailLoading === q.id}
                      className="p-1.5 rounded-lg hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400 transition-colors disabled:opacity-50"
                      title={`Enviar por email a ${q.customer_email}`}
                    >
                      {emailLoading === q.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Mail className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => copyWhatsApp(q)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Copiar para WhatsApp">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => duplicateQuote(q)} disabled={duplicating === q.id} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50" title="Duplicar presupuesto">
                    {duplicating === q.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CopyPlus className="w-4 h-4" />}
                  </button>
                  <ConfirmDialog
                    title="Eliminar presupuesto"
                    description="Esta acción no se puede deshacer."
                    onConfirm={() => handleDelete(q.id)}
                    trigger={
                      <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    }
                  />
                </div>
              </div>

              {expandedId === q.id && (
                <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Ítems</p>
                    <div className="space-y-1 pb-12">
                      {q.items.map((it, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex-1">{it.description}</span>
                          <span className="text-muted-foreground mx-3">×{it.qty}</span>
                          <span className="font-medium">{formatARS(it.total)}</span>
                        </div>
                      ))}
                    </div>
                    {q.discount_amount > 0 && (
                      <div className="flex justify-between text-xs mt-1 text-muted-foreground">
                        <span>Descuento</span>
                        <span>-{formatARS(q.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold mt-1.5 pt-1.5 border-t border-border/50">
                      <span>Total</span>
                      <span className="text-primary">{formatARS(q.total)}</span>
                    </div>
                  </div>
                  {q.notes && <p className="text-xs text-muted-foreground italic">{q.notes}</p>}
                  <div className="flex flex-wrap gap-2">
                    {q.status === "draft" && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => updateStatus(q.id, "sent")}>
                        <Send className="w-3 h-3 mr-1" /> Marcar enviado
                      </Button>
                    )}
                    {q.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-400 border-emerald-500/30" onClick={() => updateStatus(q.id, "accepted")}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Aceptado
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => updateStatus(q.id, "rejected")}>
                          <XCircle className="w-3 h-3 mr-1" /> Rechazado
                        </Button>
                      </>
                    )}
                    {(q.status === "draft" || q.status === "sent" || q.status === "accepted") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 gap-1"
                        onClick={() => setConvertModal({ quote: q, method: "transferencia" })}
                        disabled={converting === q.id}
                      >
                        {converting === q.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <CheckCircle2 className="w-3 h-3" />
                        }
                        Convertir en venta
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10 gap-1"
                      onClick={() => generateMpLink(q)}
                      disabled={mpLoading === q.id}
                    >
                      {mpLoading === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {mpLinks[q.id] ? "Copiar link MP" : "Link MP"}
                    </Button>
                    {q.customer_phone && mpLinks[q.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-green-500/40 text-green-400 hover:bg-green-500/10 gap-1"
                        onClick={() => window.open(`https://wa.me/${q.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${q.customer_name.split(" ")[0]}! Te comparto el link para pagar tu presupuesto ${q.quote_number} (${formatARS(q.total)}): ${mpLinks[q.id]}`)}`, "_blank")}
                      >
                        <Send className="w-3 h-3" />WhatsApp
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10 gap-1"
                      onClick={() => generatePayLink(q)}
                      disabled={payLinkLoading === q.id}
                    >
                      {payLinkLoading === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {payLinks[q.id] ? "Copiar link pago" : "Link pago"}
                    </Button>
                    {q.customer_phone && payLinks[q.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-green-500/40 text-green-400 hover:bg-green-500/10 gap-1"
                        onClick={() => window.open(`https://wa.me/${q.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${q.customer_name.split(" ")[0]}! 🛍️ Tu presupuesto ${q.quote_number} por ${formatARS(q.total)}.\n\nPodés pagar con tarjeta, transferencia o efectivo desde este link:\n${payLinks[q.id]}`)}`, "_blank")}
                      >
                        <Send className="w-3 h-3" />Enviar
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Convert to sale modal */}
      <Dialog open={!!convertModal} onOpenChange={(v) => { if (!v) setConvertModal(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convertir en venta</DialogTitle>
          </DialogHeader>
          {convertModal && (
            <div className="space-y-4 pt-1">
              <div className="bg-muted/30 rounded-xl p-3 space-y-1 text-sm">
                <p className="font-semibold">{convertModal.quote.customer_name}</p>
                <p className="text-muted-foreground text-xs">{convertModal.quote.quote_number} · {convertModal.quote.items.length} ítem{convertModal.quote.items.length !== 1 ? "s" : ""}</p>
                <p className="text-primary font-bold text-base">{formatARS(convertModal.quote.total)}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Método de cobro</label>
                <Select
                  value={convertModal.method}
                  onValueChange={(v) => setConvertModal(prev => prev ? { ...prev, method: v } : null)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="tarjeta_debito">Tarjeta débito</SelectItem>
                    <SelectItem value="tarjeta_credito">Tarjeta crédito</SelectItem>
                    <SelectItem value="mercadopago">MercadoPago</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-9" onClick={() => setConvertModal(null)}>Cancelar</Button>
                <Button className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmConvert}>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Registrar venta
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Create dialog ────────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Nuevo presupuesto
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">

            {/* ── Plantillas ── */}
            {activeOrg && (
              <div className="bg-muted/20 border border-border/50 rounded-xl overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowTemplates(v => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    Plantillas guardadas {templates.length > 0 && <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{templates.length}</span>}
                  </span>
                  {showTemplates ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showTemplates && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/50">
                    {templates.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 text-center">
                        No hay plantillas. Completá los ítems y guardá una.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {templates.map(tpl => (
                          <div key={tpl.name} className="flex items-center gap-1 bg-card border border-border rounded-lg overflow-hidden">
                            <button
                              type="button"
                              className="px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                              onClick={() => loadTemplate(tpl)}
                            >
                              <span className="font-medium">{tpl.name}</span>
                              <span className="text-muted-foreground ml-1">({tpl.items.length} ítems)</span>
                            </button>
                            <button
                              type="button"
                              className="px-1.5 py-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              onClick={() => deleteTemplate(tpl.name)}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder="Nombre de la nueva plantilla…"
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveTemplate(); } }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={!templateName.trim() || savingTemplate}
                        onClick={saveTemplate}
                      >
                        <Bookmark className="w-3 h-3" /> Guardar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Cliente ── */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block uppercase tracking-wider">Cliente</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  {activeOrg ? (
                    <CustomerSearch
                      value={custName}
                      onChange={setCustName}
                      onSelect={c => {
                        setCustName(c.name);
                        setCustEmail(c.email || "");
                        setCustPhone(c.phone || "");
                      }}
                      orgId={activeOrg.id}
                    />
                  ) : (
                    <Input placeholder="Nombre del cliente" value={custName} onChange={e => setCustName(e.target.value)} />
                  )}
                </div>
                <div>
                  <Input type="email" placeholder="cliente@email.com" value={custEmail} onChange={e => setCustEmail(e.target.value)} />
                </div>
                <div>
                  <Input placeholder="+54 9 11…" value={custPhone} onChange={e => setCustPhone(e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Ítems ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ítems</label>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setItems(p => [...p, { description: "", qty: 1, unitPrice: 0, total: 0 }])}>
                  <Plus className="w-3 h-3 mr-1" /> Ítem
                </Button>
              </div>
              <div className="space-y-2 pb-12">
                {items.map((it, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    {activeOrg ? (
                      <ProductSearch
                        value={it.description}
                        onChange={v => updateItem(i, "description", v)}
                        onSelect={p => {
                          setItems(prev => {
                            const next = [...prev];
                            next[i] = { ...next[i], description: p.name, unitPrice: p.sale_price_ars, total: Number(next[i].qty) * p.sale_price_ars };
                            return next;
                          });
                        }}
                        orgId={activeOrg.id}
                      />
                    ) : (
                      <Input
                        className="flex-1 h-8 text-xs"
                        placeholder="Descripción del ítem…"
                        value={it.description}
                        onChange={e => updateItem(i, "description", e.target.value)}
                      />
                    )}
                    <Input
                      className="w-14 h-8 text-xs text-center"
                      type="number"
                      min="1"
                      value={it.qty}
                      onChange={e => updateItem(i, "qty", Number(e.target.value))}
                    />
                    <Input
                      className="w-28 h-8 text-xs"
                      type="number"
                      placeholder="Precio"
                      value={it.unitPrice || ""}
                      onChange={e => updateItem(i, "unitPrice", Number(e.target.value))}
                    />
                    <div className="w-24 h-8 flex items-center text-xs text-muted-foreground px-2 bg-muted/30 rounded-md border border-border">
                      {formatARS(it.total)}
                    </div>
                    {items.length > 1 && (
                      <button onClick={() => setItems(p => p.filter((_, j) => j !== i))} className="text-muted-foreground/60 hover:text-destructive mt-2">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Totales ── */}
            <div className="flex justify-end gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Descuento:</span>
                <Input className="w-28 h-7 text-xs text-right" type="number" min="0" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs">Total:</span>
                <span className="font-bold text-primary text-base">{formatARS(Math.max(0, total))}</span>
              </div>
            </div>

            {/* ── Vencimiento + Notas ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Válido hasta</label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-8 text-xs" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Por defecto +15 días</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
                <Textarea placeholder="Condiciones, aclaraciones…" value={notes} onChange={e => setNotes(e.target.value)} className="h-16 resize-none text-xs" />
              </div>
            </div>

            {/* ── Guardar plantilla + Auto-send ── */}
            <div className="bg-muted/20 border border-border/40 rounded-xl px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <label className="text-xs font-medium">Automatización</label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer group select-none">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 rounded accent-primary"
                  checked={autoSend}
                  onChange={e => setAutoSend(e.target.checked)}
                  disabled={!custEmail}
                />
                <span className={`text-xs ${custEmail ? "text-foreground" : "text-muted-foreground"}`}>
                  {custEmail ? `Enviar por email a ${custEmail}` : "Ingresá un email para auto-enviar"}
                </span>
              </label>
            </div>

            {/* ── Submit ── */}
            <Button
              className="w-full gradient-gold text-primary-foreground"
              disabled={!custName.trim() || saving}
              onClick={handleSave}
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
              ) : (
                <>{autoSend && custEmail ? <><Send className="w-4 h-4 mr-2" />Crear y enviar</> : "Crear presupuesto"}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
