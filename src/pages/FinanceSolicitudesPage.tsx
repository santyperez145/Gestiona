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
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  status: "pending" | "under_review" | "approved" | "rejected";
  attachments: string[];
  created_at: string;
  updated_at: string;
}

interface ExpenseRequestCounts {
  todos: number;
  pendiente: number;
  bajo_revision: number;
  aprobado: number;
  rechazado: number;
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
    title: string;
    amount: number;
    currency: "ARS" | "USD";
    category: string | null;
    cost_center: string | null;
    motive: string | null;
  }>({
    title: "",
    amount: 0,
    currency: "ARS",
    category: null,
    cost_center: null,
    motive: null,
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

  const handleCreate = async () => {
    if (!newRequest.title.trim() || newRequest.amount <= 0) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("finance_create_expense_request", {
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
      setNewRequest({ title: "", amount: 0, currency: "ARS", category: null, cost_center: null, motive: null });
    } finally {
      setLoading(false);
    }
  };

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

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

  const counts = useMemo<ExpenseRequestCounts>(() => {
    const c: ExpenseRequestCounts = { todos: requests.length, pendiente: 0, bajo_revision: 0, aprobado: 0, rechazado: 0 };
    for (const r of requests) {
      if (r.status === "pending") c.pendiente += 1;
      else if (r.status === "under_review") c.bajo_revision += 1;
      else if (r.status === "approved") c.aprobado += 1;
      else if (r.status === "rejected") c.rechazado += 1;
    }
    return c;
  }, [requests]);

  const VIEW_MAP: Record<string, string | null> = {
    todos: null,
    pendiente: "pending",
    "en revisión": "under_review",
    aprobado: "approved",
    rechazado: "rejected",
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
          {["todos", "pendiente", "en revisión", "aprobado", "rechazado"].map((v) => (
            <Button key={v} variant={inboxView === v ? "default" : "outline"} size="sm" onClick={() => setInboxView(v)}>{v}</Button>
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

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.todos}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Pendientes</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.pendiente}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">En revisión</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.bajo_revision}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Aprobadas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{counts.aprobado}</div></CardContent></Card>
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
                  <TableCell className="p-4 truncate font-medium">{s.title || "Sin título"}</TableCell>
                  <TableCell className="p-4 font-mono">{new Intl.NumberFormat("es-AR", { style: "currency", currency: s.currency || "ARS" }).format(s.amount || 0)}</TableCell>
                  <TableCell className="p-4 text-[10px] text-muted-foreground">{s.currency || "ARS"}</TableCell>
                  <TableCell className="p-4">{s.category || "—"}</TableCell>
                  <TableCell className="p-4">{s.cost_center || "—"}</TableCell>
                  <TableCell className="p-4"><Badge variant={s.status === "approved" ? "default" : s.status === "rejected" ? "destructive" : s.status === "pending" ? "secondary" : "warning"}>{s.status === "approved" ? "Aprobado" : s.status === "rejected" ? "Rechazado" : s.status === "pending" ? "Pendiente" : "En revisión"}</Badge></TableCell>
                  <TableCell className="p-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleApprove(s.id)} disabled={s.status !== "pending"}><CheckCircle2 className="mr-1 h-4 w-4" />Aprobar</Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setRejectingId(s.id); setRejectReason(""); }} disabled={s.status !== "pending"}><XCircle className="mr-1 h-4 w-4" />Rechazar</Button>
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
              <Label htmlFor="solicitud-title">Título <span className="text-destructive">*</span></Label>
              <Input id="solicitud-title" value={newRequest.title} onChange={(e) => setNewRequest({ ...newRequest, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="solicitud-amount">Monto <span className="text-destructive">*</span></Label>
                <Input id="solicitud-amount" type="number" step="0.01" min="0.01" value={newRequest.amount} onChange={(e) => setNewRequest({ ...newRequest, amount: Number(e.target.value) })} />
              </div>
              <div className="grid gap-2">
                <Label>Divisa</Label>
                <Select value={newRequest.currency} onValueChange={(value) => setNewRequest({ ...newRequest, currency: value as "ARS" | "USD" })}>
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
    </div>
  );
}