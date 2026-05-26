import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Gift, Plus, Search, Copy, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

interface GiftCard {
  id: string;
  code: string;
  initial_balance: number;
  current_balance: number;
  status: string;
  issued_to_name: string | null;
  issued_to_email: string | null;
  sale_price: number | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
}

interface GCTransaction {
  id: string;
  gift_card_id: string;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:   { label: "Activa",    color: "bg-emerald-500/15 text-emerald-400" },
  used:     { label: "Agotada",   color: "bg-muted/50 text-muted-foreground" },
  expired:  { label: "Vencida",   color: "bg-destructive/15 text-destructive" },
  cancelled:{ label: "Cancelada", color: "bg-muted/40 text-muted-foreground" },
  pending:  { label: "Pendiente", color: "bg-yellow-500/15 text-yellow-400" },
};

const TXN_LABEL: Record<string, { label: string; sign: string; color: string }> = {
  redeem:  { label: "Canje",       sign: "-", color: "text-destructive" },
  load:    { label: "Carga",       sign: "+", color: "text-emerald-400" },
  refund:  { label: "Devolución",  sign: "+", color: "text-emerald-400" },
  expire:  { label: "Vencimiento", sign: "-", color: "text-muted-foreground" },
};

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}

export default function GiftCardsPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [cards, setCards] = useState<GiftCard[]>([]);
  const [transactions, setTransactions] = useState<GCTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [issueOpen, setIssueOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupCard, setLookupCard] = useState<GiftCard | null>(null);

  const [issueForm, setIssueForm] = useState({
    code: "", initial_balance: "", sale_price: "", issued_to_name: "", issued_to_email: "",
    expiry_date: "", notes: "", qty: "1",
  });
  const [redeemForm, setRedeemForm] = useState({ amount: "", notes: "" });
  const [loadForm, setLoadForm] = useState({ amount: "", notes: "" });
  const [loadOpen, setLoadOpen] = useState(false);

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [cardsRes, txnRes] = await Promise.all([
      supabase.from("gift_cards").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("gift_card_transactions").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(300),
    ]);
    setCards((cardsRes.data || []) as GiftCard[]);
    setTransactions((txnRes.data || []) as GCTransaction[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function issueCard() {
    if (!issueForm.initial_balance) { toast.error("Balance inicial requerido"); return; }
    const qty = Math.min(20, Math.max(1, Number(issueForm.qty) || 1));
    const payload = (i: number) => ({
      org_id: orgId,
      code: qty > 1 ? "" : (issueForm.code.trim() || ""),
      initial_balance: Number(issueForm.initial_balance),
      sale_price: issueForm.sale_price ? Number(issueForm.sale_price) : null,
      issued_to_name: issueForm.issued_to_name || null,
      issued_to_email: issueForm.issued_to_email || null,
      expiry_date: issueForm.expiry_date || null,
      notes: issueForm.notes || null,
      status: "active",
    });
    for (let i = 0; i < qty; i++) {
      const { error } = await supabase.from("gift_cards").insert(payload(i));
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`${qty} tarjeta(s) emitida(s)`);
    setIssueOpen(false);
    setIssueForm({ code: "", initial_balance: "", sale_price: "", issued_to_name: "", issued_to_email: "", expiry_date: "", notes: "", qty: "1" });
    loadData();
  }

  async function redeemCard() {
    if (!selectedCard || !redeemForm.amount) { toast.error("Monto requerido"); return; }
    const amount = Number(redeemForm.amount);
    if (amount > selectedCard.current_balance) { toast.error("Monto mayor al saldo disponible"); return; }
    const { error } = await supabase.from("gift_card_transactions").insert({
      org_id: orgId, gift_card_id: selectedCard.id,
      transaction_type: "redeem", amount,
      balance_before: 0, balance_after: 0, // computed by trigger
      notes: redeemForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Canje de ${fmt(amount)} aplicado`);
    setRedeemOpen(false); setSelectedCard(null); setLookupCard(null); setLookupCode("");
    setRedeemForm({ amount: "", notes: "" });
    loadData();
  }

  async function loadBalance() {
    if (!selectedCard || !loadForm.amount) return;
    const { error } = await supabase.from("gift_card_transactions").insert({
      org_id: orgId, gift_card_id: selectedCard.id,
      transaction_type: "load", amount: Number(loadForm.amount),
      balance_before: 0, balance_after: 0,
      notes: loadForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Saldo cargado`);
    setLoadOpen(false); setSelectedCard(null);
    setLoadForm({ amount: "", notes: "" });
    loadData();
  }

  async function cancelCard(id: string) {
    await supabase.from("gift_cards").update({ status: "cancelled" }).eq("id", id);
    toast.success("Tarjeta cancelada");
    loadData();
  }

  async function lookupByCode() {
    if (!lookupCode.trim()) return;
    const { data } = await supabase.from("gift_cards").select("*").eq("org_id", orgId).ilike("code", lookupCode.trim()).maybeSingle();
    if (!data) { toast.error("Tarjeta no encontrada"); setLookupCard(null); return; }
    setLookupCard(data as GiftCard);
    setSelectedCard(data as GiftCard);
  }

  const filtered = cards.filter(c => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search && !c.code.toLowerCase().includes(search.toLowerCase()) && !(c.issued_to_name?.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const totalIssuedValue = cards.reduce((s, c) => s + c.initial_balance, 0);
  const totalOutstanding = cards.filter(c => c.status === "active").reduce((s, c) => s + c.current_balance, 0);
  const totalRedeemed = transactions.filter(t => t.transaction_type === "redeem").reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gift className="w-6 h-6 text-primary" /> Gift Cards
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Emití, administrá y canjeá tarjetas de regalo. Saldo actualizado en tiempo real.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setLookupCode(""); setLookupCard(null); setRedeemOpen(true); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Canjear
          </Button>
          <Button onClick={() => setIssueOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Emitir tarjeta
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Tarjetas activas", value: cards.filter(c => c.status === "active").length },
          { label: "Valor emitido", value: fmt(totalIssuedValue) },
          { label: "Saldo pendiente", value: fmt(totalOutstanding) },
          { label: "Total canjeado", value: fmt(totalRedeemed) },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
            <p className="text-xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar código o nombre..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Gift className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sin tarjetas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(card => {
            const sc = STATUS_CONFIG[card.status];
            const cardTxns = transactions.filter(t => t.gift_card_id === card.id);
            const isExpanded = expanded === card.id;
            const usedPct = card.initial_balance > 0 ? ((card.initial_balance - card.current_balance) / card.initial_balance) * 100 : 0;

            return (
              <div key={card.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpanded(isExpanded ? null : card.id)}>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono font-bold text-sm tracking-widest">{card.code}</code>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                    </div>
                    {card.issued_to_name && <p className="text-xs text-muted-foreground mt-0.5">{card.issued_to_name}</p>}
                  </div>

                  <div className="text-right shrink-0 min-w-[100px]">
                    <p className="font-bold text-sm">{fmt(card.current_balance)}</p>
                    <div className="h-1 rounded-full bg-muted mt-1 overflow-hidden w-full">
                      <div className="h-full rounded-full bg-primary/50" style={{ width: `${100 - usedPct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">de {fmt(card.initial_balance)}</p>
                  </div>

                  <div className="flex gap-1 shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { navigator.clipboard.writeText(card.code); toast.success("Código copiado"); }}
                      className="p-1.5 text-muted-foreground hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
                    {card.status === "active" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSelectedCard(card); setRedeemForm({ amount: "", notes: "" }); setRedeemOpen(true); }}>Canjear</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSelectedCard(card); setLoadOpen(true); }}>Cargar</Button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && cardTxns.length > 0 && (
                  <div className="border-t border-border/30 px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Historial</p>
                    <div className="space-y-1">
                      {cardTxns.map(t => {
                        const tc = TXN_LABEL[t.transaction_type];
                        return (
                          <div key={t.id} className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">{tc.label}</span>
                            <span className={`font-mono font-semibold ${tc.color}`}>{tc.sign}{fmt(t.amount)}</span>
                            <span className="text-muted-foreground/50 ml-auto">{new Date(t.created_at).toLocaleDateString("es-AR")}</span>
                            <span className="font-mono text-muted-foreground">→ {fmt(t.balance_after)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Issue dialog */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Emitir gift card(s)</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Balance inicial *</Label>
                <Input type="number" min="0" value={issueForm.initial_balance} onChange={e => setIssueForm(p => ({ ...p, initial_balance: e.target.value }))} placeholder="$5000" autoFocus />
              </div>
              <div><Label>Precio de venta</Label>
                <Input type="number" min="0" value={issueForm.sale_price} onChange={e => setIssueForm(p => ({ ...p, sale_price: e.target.value }))} placeholder="$4500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Código (auto si vacío)</Label>
                <Input value={issueForm.code} onChange={e => setIssueForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="XXXX-XXXX-..." className="font-mono" />
              </div>
              <div><Label>Cantidad</Label>
                <Input type="number" min="1" max="20" value={issueForm.qty} onChange={e => setIssueForm(p => ({ ...p, qty: e.target.value }))} />
              </div>
            </div>
            <div><Label>Destinatario</Label>
              <Input value={issueForm.issued_to_name} onChange={e => setIssueForm(p => ({ ...p, issued_to_name: e.target.value }))} placeholder="Nombre del destinatario..." />
            </div>
            <div><Label>Email</Label>
              <Input type="email" value={issueForm.issued_to_email} onChange={e => setIssueForm(p => ({ ...p, issued_to_email: e.target.value }))} placeholder="cliente@email.com" />
            </div>
            <div><Label>Fecha de vencimiento</Label>
              <Input type="date" value={issueForm.expiry_date} onChange={e => setIssueForm(p => ({ ...p, expiry_date: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancelar</Button>
            <Button onClick={issueCard}>Emitir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redeem dialog */}
      <Dialog open={redeemOpen} onOpenChange={v => { setRedeemOpen(v); if (!v) { setLookupCard(null); setSelectedCard(null); setLookupCode(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Canjear gift card</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {!lookupCard ? (
              <>
                <div><Label>Código de la tarjeta</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={lookupCode} onChange={e => setLookupCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-..." className="font-mono" autoFocus />
                    <Button onClick={lookupByCode} type="button">Buscar</Button>
                  </div>
                </div>
                {lookupCard === null && lookupCode && <p className="text-xs text-muted-foreground">Ingresá el código y buscá para continuar.</p>}
              </>
            ) : (
              <>
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="font-mono font-bold text-sm">{lookupCard.code}</p>
                  <p className="text-sm mt-0.5">Saldo disponible: <strong className="text-emerald-400">{fmt(lookupCard.current_balance)}</strong></p>
                  {lookupCard.issued_to_name && <p className="text-xs text-muted-foreground">{lookupCard.issued_to_name}</p>}
                </div>
                <div><Label>Monto a canjear *</Label>
                  <Input type="number" min="0" max={lookupCard.current_balance} value={redeemForm.amount}
                    onChange={e => setRedeemForm(p => ({ ...p, amount: e.target.value }))} placeholder={`Máx. ${fmt(lookupCard.current_balance)}`} autoFocus />
                </div>
                <div><Label>Notas</Label>
                  <Input value={redeemForm.notes} onChange={e => setRedeemForm(p => ({ ...p, notes: e.target.value }))} placeholder="Referencia de venta..." />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRedeemOpen(false); setLookupCard(null); setSelectedCard(null); setLookupCode(""); }}>Cancelar</Button>
            {lookupCard && <Button onClick={redeemCard} disabled={!redeemForm.amount}>Canjear</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load balance dialog */}
      <Dialog open={loadOpen} onOpenChange={v => { setLoadOpen(v); if (!v) setSelectedCard(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cargar saldo — {selectedCard?.code}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Monto a cargar *</Label>
              <Input type="number" min="0" value={loadForm.amount} onChange={e => setLoadForm(p => ({ ...p, amount: e.target.value }))} autoFocus />
            </div>
            <div><Label>Notas</Label>
              <Input value={loadForm.notes} onChange={e => setLoadForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadOpen(false)}>Cancelar</Button>
            <Button onClick={loadBalance}>Cargar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
