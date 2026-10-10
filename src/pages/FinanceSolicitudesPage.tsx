import { useEffect, useMemo, useState } from "react";
import { useOrg } from "@/lib/orgContext";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ApprovalPolicyPanel from "@/components/finance/ApprovalPolicyPanel";

import { topicOrg, useTopicEvent } from "@/lib/orgRealtime";
const DOCUMENT_TYPES = ["supplier_invoice", "receipt", "purchase_order", "other"] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];

interface ExpenseRequest {
  id: string;
  org_id: string;
  title: string;
  amount: number;
  currency: string;
  category: string | null;
  cost_center: string | null;
  motive: string | null;
  status: "pending" | "under_review" | "approved" | "rejected" | "paid" | "cancelled";
  attachments: string[];
  created_at: string;
  updated_at: string;
  request_kind: "expense" | "reimbursement" | "advance";
  beneficiary_name: string | null;
  payout_provider_label: string | null;
  payout_destination_type: string | null;
  payout_identifier_masked: string | null;
  payment_reference: string | null;
  payment_method: string | null;
}

interface ExpenseRequestCounts {
  todos: number;
  pendiente: number;
  bajo_revision: number;
  aprobado: number;
  rechazado: number;
  pagado: number;
}

export default function FinanceSolicitudesPage() {
  usePageTitle("Solicitudes · Finance");
  const { activeOrg } = useOrg();
  const { online } = useNetworkStatus();

  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inboxView, setInboxView] = useState("todos");
  const [inboxQuery, setInboxQuery] = useState("");

  // Estado para crear nueva solicitud
  const [openCreate, setOpenCreate] = useState(false);
  const [newRequest, setNewRequest] = useState<{
    request_kind: "expense" | "reimbursement" | "advance";
    title: string;
    amount: number;
    currency: "ARS" | "USD";
    category: string | null;
    cost_center: string | null;
    motive: string | null;
    beneficiary_name: string;
    provider_label: string;
    destination_type: "email" | "cbu" | "cvu" | "alias" | "wallet_handle";
    identifier: string;
    due_date: string;
  }>({
    request_kind: "expense",
    title: "",
    amount: 0,
    currency: "ARS",
    category: null,
    cost_center: null,
    motive: null,
    beneficiary_name: "",
    provider_label: "",
    destination_type: "alias",
    identifier: "",
    due_date: new Date().toISOString().slice(0, 10),
  });

  const loadRequests = async () => {
    if (!activeOrg?.id) return;
    setLoadError(null);
    try {
      const { data, error } = await (supabase as any)
        .from("finance_expense_requests")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRequests((data ?? []) as ExpenseRequest[]);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setLoadError(`No se pudieron cargar las solicitudes: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [activeOrg?.id]);

  // Realtime: la bandeja se refresca sola cuando alguien aprueba/revisa desde
  // otra pestaña o dispositivo (paridad Mendel: bandeja viva, no stale).
  useTopicEvent(topicOrg(activeOrg?.id), "solicitud", () => { void loadRequests(); });

  const handleCreate = async () => {
    if (!newRequest.title.trim() || newRequest.amount <= 0) return;
    setLoading(true);
    try {
      const { data, error } = newRequest.request_kind === "reimbursement"
        ? await (supabase as any).rpc("finance_create_reimbursement_request", {
            p_org_id: activeOrg!.id, p_title: newRequest.title, p_amount: newRequest.amount,
            p_currency: newRequest.currency, p_category: newRequest.category,
            p_cost_center: newRequest.cost_center, p_motive: newRequest.motive,
            p_beneficiary_name: newRequest.beneficiary_name,
            p_provider_label: newRequest.provider_label,
            p_destination_type: newRequest.destination_type,
            p_identifier: newRequest.identifier,
          })
        : newRequest.request_kind === "advance"
        ? await (supabase as any).rpc("finance_create_advance_request", {
            p_org_id: activeOrg!.id, p_title: newRequest.title, p_amount: newRequest.amount,
            p_currency: newRequest.currency, p_category: newRequest.category,
            p_cost_center: newRequest.cost_center, p_motive: newRequest.motive,
            p_beneficiary_name: newRequest.beneficiary_name,
            p_provider_label: newRequest.provider_label,
            p_destination_type: newRequest.destination_type,
            p_identifier: newRequest.identifier, p_due_date: newRequest.due_date,
          })
        : await (supabase as any).rpc("finance_create_expense_request", {
            p_org_id: activeOrg!.id,
            p_title: newRequest.title,
            p_amount: newRequest.amount,
            p_currency: newRequest.currency,
            p_category: newRequest.category,
            p_cost_center: newRequest.cost_center,
            p_motive: newRequest.motive,
          });
      if (error) throw error;
      setNotice(`Solicitud creada: ${data?.id ?? "ok"}`);
      setOpenCreate(false);
      setNewRequest({ request_kind: "expense", title: "", amount: 0, currency: "ARS", category: null, cost_center: null, motive: null, beneficiary_name: "", provider_label: "", destination_type: "alias", identifier: "", due_date: new Date().toISOString().slice(0, 10) });
    } finally {
      setLoading(false);
    }
  };

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  // Cancelar: libera el compromiso de presupuesto al instante (F5.2b). A
  // diferencia del rechazo, aplica a pendientes y ya aprobadas con traza.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const handleConfirmCancel = async () => {
    if (!cancellingId) return;
    setCancelBusy(true);
    try {
      const { error } = await (supabase as any).rpc("finance_cancel_expense_request", {
        p_request_id: cancellingId,
        p_reason: cancelReason.trim() || null,
      });
      if (error) throw error;
      setNotice("Solicitud cancelada: el compromiso de presupuesto quedó liberado");
      setCancellingId(null);
      setCancelReason("");
      void loadRequests();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setLoadError(`No se pudo cancelar la solicitud: ${msg}`);
    } finally {
      setCancelBusy(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      const { error } = await (supabase as any).rpc("finance_approve_expense_request", { p_request_id: requestId });
      if (error) throw error;
      setNotice("Solicitud aprobada; presupuesto comprometido");
      void loadRequests();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setLoadError(`No se pudo aprobar la solicitud: ${msg}`);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingId) return;
    setRejectBusy(true);
    try {
      const { error } = await (supabase as any).rpc("finance_reject_expense_request", {
        p_request_id: rejectingId,
        p_reason: rejectReason.trim() || null,
      });
      if (error) throw error;
      setNotice("Solicitud rechazada");
      setRejectingId(null);
      setRejectReason("");
      void loadRequests();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setLoadError(`No se pudo rechazar la solicitud: ${msg}`);
    } finally {
      setRejectBusy(false);
    }
  };

  // Registrar pago: la solicitud aprobada se vuelve un gasto real en `expenses`
  // (P&L honesto). La autoridad es la RPC; el reintento es seguro (idempotente).
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [settlingRequest, setSettlingRequest] = useState<ExpenseRequest | null>(null);
  const [settlementDetails, setSettlementDetails] = useState<Record<string, string | null> | null>(null);
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementMethod, setSettlementMethod] = useState("transferencia");
  const [advanceManaging, setAdvanceManaging] = useState<ExpenseRequest | null>(null);
  const [advanceSummary, setAdvanceSummary] = useState<Record<string, string | number> | null>(null);
  const [advanceAction, setAdvanceAction] = useState<"expense" | "return">("expense");
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [advanceDescription, setAdvanceDescription] = useState("");
  const [advanceEvidence, setAdvanceEvidence] = useState("");

  const handleMarkPaid = async (request: ExpenseRequest) => {
    if (request.request_kind === "reimbursement" || request.request_kind === "advance") {
      setMarkingPaidId(request.id);
      try {
        const { data, error } = request.request_kind === "advance"
          ? await (supabase as any).rpc("finance_advance_settlement_details", { p_request_id: request.id })
          : await (supabase as any).rpc("finance_reimbursement_settlement_details", { p_request_id: request.id });
        if (error) throw error;
        setSettlingRequest(request);
        setSettlementDetails(data as Record<string, string | null>);
        setSettlementReference("");
      } catch (cause) {
        setLoadError(`No se pudo abrir el destino: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally { setMarkingPaidId(null); }
      return;
    }
    const requestId = request.id;
    setMarkingPaidId(requestId);
    try {
      const { error } = await (supabase as any).rpc("finance_mark_expense_paid", { p_request_id: requestId });
      if (error) throw error;
      setNotice("Pago registrado: el gasto entró al registro contable");
      void loadRequests();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setLoadError(`No se pudo registrar el pago: ${msg}`);
    } finally {
      setMarkingPaidId(null);
    }
  };

  const handleSettleReimbursement = async () => {
    if (!settlingRequest || settlementReference.trim().length < 3) return;
    setMarkingPaidId(settlingRequest.id);
    try {
      const { error } = settlingRequest.request_kind === "advance"
        ? await (supabase as any).rpc("finance_disburse_advance", {
            p_request_id: settlingRequest.id, p_payment_reference: settlementReference.trim(), p_payment_method: settlementMethod,
          })
        : await (supabase as any).rpc("finance_settle_reimbursement", {
            p_request_id: settlingRequest.id, p_payment_reference: settlementReference.trim(), p_payment_method: settlementMethod,
          });
      if (error) throw error;
      setNotice(settlingRequest.request_kind === "advance" ? "Anticipo desembolsado y abierto para rendición" : "Reembolso liquidado con referencia y registrado en Finance");
      setSettlingRequest(null);
      void loadRequests();
    } catch (cause) {
      setLoadError(`No se pudo liquidar el reembolso: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setMarkingPaidId(null); }
  };

  const openAdvanceManagement = async (request: ExpenseRequest) => {
    setMarkingPaidId(request.id);
    try {
      const { data, error } = await (supabase as any).rpc("finance_advance_summary", { p_request_id: request.id });
      if (error) throw error;
      setAdvanceSummary(data as Record<string, string | number>);
      setAdvanceManaging(request);
      setAdvanceAmount(0); setAdvanceDescription(""); setAdvanceEvidence("");
    } catch (cause) {
      setLoadError(`No se pudo abrir el anticipo: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setMarkingPaidId(null); }
  };

  const handleAdvanceAction = async () => {
    if (!advanceManaging || advanceAmount <= 0 || advanceEvidence.trim().length < 3) return;
    setMarkingPaidId(advanceManaging.id);
    try {
      const { error } = advanceAction === "expense"
        ? await (supabase as any).rpc("finance_render_advance_expense", {
            p_request_id: advanceManaging.id, p_amount: advanceAmount,
            p_description: advanceDescription.trim(), p_category: advanceManaging.category,
            p_evidence_reference: advanceEvidence.trim(), p_date: new Date().toISOString().slice(0, 10),
          })
        : await (supabase as any).rpc("finance_return_advance_balance", {
            p_request_id: advanceManaging.id, p_amount: advanceAmount,
            p_return_reference: advanceEvidence.trim(),
          });
      if (error) throw error;
      setNotice(advanceAction === "expense" ? "Comprobante rendido y contabilizado" : "Devolución registrada en el ledger");
      setAdvanceManaging(null); void loadRequests();
    } catch (cause) {
      setLoadError(`No se pudo registrar el movimiento: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setMarkingPaidId(null); }
  };

  const counts = useMemo<ExpenseRequestCounts>(() => {
    const c: ExpenseRequestCounts = { todos: requests.length, pendiente: 0, bajo_revision: 0, aprobado: 0, rechazado: 0, pagado: 0 };
    for (const r of requests) {
      if (r.status === "pending") c.pendiente += 1;
      else if (r.status === "under_review") c.bajo_revision += 1;
      else if (r.status === "approved") c.aprobado += 1;
      else if (r.status === "rejected") c.rechazado += 1;
      else if (r.status === "paid") c.pagado += 1;
    }
    return c;
  }, [requests]);

  const VIEW_MAP: Record<string, string | null> = {
    todos: null,
    pendiente: "pending",
    "en revisión": "under_review",
    aprobado: "approved",
    rechazado: "rejected",
    pagado: "paid",
  };

  const filtered = useMemo(() => {
    let result = requests;
    if (inboxQuery) {
      const q = inboxQuery.toLowerCase();
      result = result.filter((r) => r.title.toLowerCase().includes(q) || r.category?.toLowerCase().includes(q));
    }
    const targetStatus = VIEW_MAP[inboxView];
    if (targetStatus) {
      result = result.filter((r) => r.status === targetStatus);
    }
    return result;
  }, [requests, inboxQuery, inboxView]);

  const isOnline = online !== false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Solicitudes de gasto</h1>
          <p className="text-sm text-muted-foreground">Solicitud → política → presupuesto → aprobación</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadRequests()} disabled={!isOnline || loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Actualizar
          </Button>
          <Button onClick={() => setOpenCreate(true)}>Crear solicitud</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar solicitudes..." value={inboxQuery} onChange={(e) => setInboxQuery(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1">
          {["todos", "pendiente", "en revisión", "aprobado", "pagado", "rechazado"].map((v) => (
            <Button key={v} variant={inboxView === v ? "default" : "outline"} size="sm" onClick={() => setInboxView(v)} className="capitalize">{v}</Button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{loadError}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void loadRequests()}>Reintentar</Button>
            <Button variant="ghost" size="sm" onClick={() => setLoadError(null)}><XCircle className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Notice banner */}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{notice}</span>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto mt-2" onClick={() => setNotice(null)}><XCircle className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Política de aprobación (F5.2): quién aprueba según monto/categoría */}
      {activeOrg?.id && <ApprovalPolicyPanel />}

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.todos}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Pendientes</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.pendiente}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">En revisión</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.bajo_revision}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Aprobadas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.aprobado}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Pagadas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.pagado}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Rechazadas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.rechazado}</div></CardContent></Card>
      </div>

      {/* Table */}
      <section className="border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/20">
              <tr>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Título</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Monto</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Moneda</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Categoría</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Centro de costo</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Estado</th>
                <th className="p-4 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /><p className="mt-2 text-sm text-muted-foreground">Cargando solicitudes...</p></TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="p-8 text-center text-muted-foreground">No hay solicitudes para mostrar</TableCell></TableRow>
              )}
              {!loading && filtered.map((s) => (
                <TableRow key={s.id} className="transition-colors hover:bg-muted/10">
                  <TableCell className="p-4"><div className="font-medium">{s.title || "Sin título"}</div>{s.request_kind !== "expense" && <div className="mt-1 text-xs text-muted-foreground">{s.request_kind === "advance" ? "Anticipo" : "Reembolso"} · {s.beneficiary_name} · {s.payout_provider_label} {s.payout_identifier_masked}</div>}</TableCell>
                  <TableCell className="p-4 font-mono">{new Intl.NumberFormat("es-AR", { style: "currency", currency: s.currency || "ARS" }).format(s.amount || 0)}</TableCell>
                  <TableCell className="p-4 text-[10px] text-muted-foreground">{s.currency || "ARS"}</TableCell>
                  <TableCell className="p-4">{s.category || "—"}</TableCell>
                  <TableCell className="p-4">{s.cost_center || "—"}</TableCell>
                  <TableCell className="p-4"><Badge variant={s.status === "approved" ? "default" : s.status === "rejected" ? "destructive" : s.status === "pending" ? "secondary" : s.status === "paid" ? "success" : s.status === "cancelled" ? "outline" : "warning"}>{s.status === "approved" ? "Aprobado" : s.status === "rejected" ? "Rechazado" : s.status === "pending" ? "Pendiente" : s.status === "paid" ? "Pagado" : s.status === "cancelled" ? "Cancelado" : "En revisión"}</Badge></TableCell>
                  <TableCell className="p-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleApprove(s.id)} disabled={s.status !== "pending"}><CheckCircle2 className="mr-1 h-4 w-4" />Aprobar</Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setRejectingId(s.id); setRejectReason(""); }} disabled={s.status !== "pending"}><XCircle className="mr-1 h-4 w-4" />Rechazar</Button>
                      <Button variant="ghost" size="sm" className="text-emerald-600" onClick={() => void handleMarkPaid(s)} disabled={s.status !== "approved" || markingPaidId === s.id}><Wallet className="mr-1 h-4 w-4" />{s.request_kind === "advance" ? "Desembolsar" : s.request_kind === "reimbursement" ? "Liquidar" : "Registrar pago"}</Button>
                      {s.request_kind === "advance" && s.status === "paid" && <Button variant="ghost" size="sm" onClick={() => void openAdvanceManagement(s)} disabled={markingPaidId === s.id}>Rendir</Button>}
                      <Button variant="ghost" size="sm" onClick={() => { setCancellingId(s.id); setCancelReason(""); }} disabled={s.status !== "pending" && s.status !== "approved"}><Ban className="mr-1 h-4 w-4" />Cancelar</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </section>

      {/* Modal crear solicitud */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva solicitud de gasto</DialogTitle>
            <DialogDescription>Completá título, monto y categoría. La aprobación comprometerá el presupuesto.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Tipo de solicitud</Label>
              <Select value={newRequest.request_kind} onValueChange={(value) => setNewRequest({ ...newRequest, request_kind: value as "expense" | "reimbursement" | "advance", currency: value === "advance" ? "ARS" : newRequest.currency })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="expense">Gasto</SelectItem><SelectItem value="reimbursement">Reembolso</SelectItem><SelectItem value="advance">Anticipo a rendir</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="solicitud-title">Título <span className="text-destructive">*</span></Label>
              <Input id="solicitud-title" value={newRequest.title} onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })} />
            </div>
            {newRequest.request_kind !== "expense" && <div className="space-y-4 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-4"><div className="grid gap-2"><Label htmlFor="reimbursement-beneficiary">Beneficiario</Label><Input id="reimbursement-beneficiary" value={newRequest.beneficiary_name} onChange={e => setNewRequest({ ...newRequest, beneficiary_name: e.target.value })} /></div><div className="grid gap-2"><Label htmlFor="reimbursement-provider">Banco o billetera</Label><Input id="reimbursement-provider" value={newRequest.provider_label} onChange={e => setNewRequest({ ...newRequest, provider_label: e.target.value })} placeholder="Mercado Pago, banco..." /></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="grid gap-2"><Label>Tipo de destino</Label><Select value={newRequest.destination_type} onValueChange={value => setNewRequest({ ...newRequest, destination_type: value as typeof newRequest.destination_type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="alias">Alias</SelectItem><SelectItem value="cbu">CBU</SelectItem><SelectItem value="cvu">CVU</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="wallet_handle">Usuario de billetera</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="reimbursement-identifier">Cuenta de destino</Label><Input id="reimbursement-identifier" value={newRequest.identifier} onChange={e => setNewRequest({ ...newRequest, identifier: e.target.value })} autoComplete="off" /></div></div>
              {newRequest.request_kind === "advance" && <div className="grid gap-2"><Label htmlFor="advance-due-date">Fecha límite de rendición</Label><Input id="advance-due-date" type="date" min={new Date().toISOString().slice(0, 10)} value={newRequest.due_date} onChange={e => setNewRequest({ ...newRequest, due_date: e.target.value })} /></div>}
              <p className="text-xs text-muted-foreground">La cuenta se cifra y sólo se revela al responsable que ejecuta un pago aprobado.</p>
            </div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="solicitud-amount">Monto <span className="text-destructive">*</span></Label>
                <Input id="solicitud-amount" type="number" step="0.01" min="0.01" value={newRequest.amount} onChange={(e) => setNewRequest({ ...newRequest, amount: Number(e.target.value) })} />
              </div>
              <div className="grid gap-2">
                <Label>Divisa</Label>
                <Select value={newRequest.currency} disabled={newRequest.request_kind === "advance"} onValueChange={(value) => setNewRequest({ ...newRequest, currency: value as "ARS" | "USD" })}>
                  <SelectTrigger id="solicitud-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS (Peso argentino)</SelectItem>
                    <SelectItem value="USD">USD (Dólar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="solicitud-category">Categoría</Label>
                <Input id="solicitud-category" value={newRequest.category || ""} onChange={(e) => setNewRequest({ ...newRequest, category: e.target.value || null })} placeholder="Ej. proveedores, nómina" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="solicitud-cost-center">Centro de costo</Label>
                <Input id="solicitud-cost-center" value={newRequest.cost_center || ""} onChange={(e) => setNewRequest({ ...newRequest, cost_center: e.target.value || null })} placeholder="Ej. marketing" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="solicitud-motivo">Motivo</Label>
              <Textarea id="solicitud-motivo" value={newRequest.motive || ""} onChange={(e) => setNewRequest({ ...newRequest, motive: e.target.value })} placeholder="Por qué se solicita este gasto" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newRequest.title.trim() || newRequest.amount <= 0 || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Crear solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(settlingRequest)} onOpenChange={open => { if (!open && !markingPaidId) setSettlingRequest(null); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{settlingRequest?.request_kind === "advance" ? "Desembolsar anticipo" : "Liquidar reembolso"}</DialogTitle><DialogDescription>Transferí al destino aprobado y registrá la referencia externa. Aprobar no equivale a pagar.</DialogDescription></DialogHeader>
          {settlementDetails && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm"><p className="font-medium">{settlementDetails.beneficiary_name}</p><p className="text-muted-foreground">{settlementDetails.provider_label}</p><p className="mt-2 break-all font-mono text-xs">{settlementDetails.identifier}</p></div>}
          <div className="grid gap-2"><Label htmlFor="reimbursement-method">Medio</Label><Select value={settlementMethod} onValueChange={setSettlementMethod}><SelectTrigger id="reimbursement-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="transferencia">Transferencia</SelectItem><SelectItem value="mercadopago">Mercado Pago</SelectItem><SelectItem value="billetera">Otra billetera</SelectItem></SelectContent></Select></div>
          <div className="grid gap-2"><Label htmlFor="reimbursement-reference">Referencia o comprobante</Label><Input id="reimbursement-reference" value={settlementReference} onChange={e => setSettlementReference(e.target.value)} maxLength={160} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setSettlingRequest(null)} disabled={Boolean(markingPaidId)}>Cancelar</Button><Button onClick={() => void handleSettleReimbursement()} disabled={Boolean(markingPaidId) || settlementReference.trim().length < 3}>{markingPaidId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar pago</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(advanceManaging)} onOpenChange={open => { if (!open && !markingPaidId) setAdvanceManaging(null); }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Rendición del anticipo</DialogTitle><DialogDescription>Aplicá comprobantes o registrá fondos devueltos. El saldo debe llegar a cero para cerrar.</DialogDescription></DialogHeader>
          {advanceSummary && <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3 text-sm"><div><span className="text-xs text-muted-foreground">Entregado</span><p className="font-medium">$ {Number(advanceSummary.disbursed_amount).toLocaleString("es-AR")}</p></div><div><span className="text-xs text-muted-foreground">Rendido</span><p className="font-medium">$ {Number(advanceSummary.rendered_amount).toLocaleString("es-AR")}</p></div><div><span className="text-xs text-muted-foreground">Pendiente</span><p className="font-medium">$ {Number(advanceSummary.remaining_amount).toLocaleString("es-AR")}</p></div></div>}
          <div className="grid gap-2"><Label>Movimiento</Label><Select value={advanceAction} onValueChange={value => setAdvanceAction(value as "expense" | "return")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expense">Rendir comprobante</SelectItem><SelectItem value="return">Devolver sobrante</SelectItem></SelectContent></Select></div>
          <div className="grid gap-2"><Label htmlFor="advance-amount">Importe</Label><Input id="advance-amount" type="number" min="0.01" step="0.01" max={Number(advanceSummary?.remaining_amount ?? 0)} value={advanceAmount || ""} onChange={e => setAdvanceAmount(Number(e.target.value))} /></div>
          {advanceAction === "expense" && <div className="grid gap-2"><Label htmlFor="advance-description">Descripción del gasto</Label><Input id="advance-description" value={advanceDescription} onChange={e => setAdvanceDescription(e.target.value)} /></div>}
          <div className="grid gap-2"><Label htmlFor="advance-evidence">Referencia del comprobante</Label><Input id="advance-evidence" value={advanceEvidence} onChange={e => setAdvanceEvidence(e.target.value)} maxLength={160} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setAdvanceManaging(null)} disabled={Boolean(markingPaidId)}>Cancelar</Button><Button onClick={() => void handleAdvanceAction()} disabled={Boolean(markingPaidId) || advanceAmount <= 0 || advanceEvidence.trim().length < 3 || (advanceAction === "expense" && advanceDescription.trim().length < 3)}>Registrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal confirmar rechazo con motivo */}
      <Dialog open={Boolean(rejectingId)} onOpenChange={(open) => { if (!open) setRejectingId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar solicitud de gasto</DialogTitle>
            <DialogDescription>
              Indicá el motivo del rechazo. El solicitante recibirá una notificación con esta explicación.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="reject-reason">Motivo del rechazo (opcional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ej: Presupuesto agotado para este trimestre / falta factura proforma"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)} disabled={rejectBusy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmReject} disabled={rejectBusy}>
              {rejectBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal confirmar cancelación (F5.2b): libera compromiso con traza */}
      <Dialog open={Boolean(cancellingId)} onOpenChange={(open) => { if (!open) setCancellingId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar solicitud de gasto</DialogTitle>
            <DialogDescription>
              La solicitud queda cancelada con traza. Si estaba aprobada, el saldo comprometido se libera en el presupuesto al instante.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="cancel-reason">Motivo de la cancelación (opcional)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ej: El proveedor bajó el precio / se canceló el proyecto"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancellingId(null)} disabled={cancelBusy}>
              Volver
            </Button>
            <Button onClick={handleConfirmCancel} disabled={cancelBusy}>
              {cancelBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
