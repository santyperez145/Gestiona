import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────
interface BankAccount {
  id: string;
  org_id: string;
  bank_name: string;
  bank_cbu: string;
  bank_alias: string;
  bank_holder: string;
  is_primary: boolean;
  status: "active" | "inactive" | "error";
  connection_type: "direct" | "oauth" | "csv";
  last_connection: string | null;
  created_at: string;
}

interface BankStatement {
  id: string;
  org_id: string;
  bank_account_id: string | null;
  statement_date: string;
  file_name: string;
  file_size: number | null;
  sha256_hash: string;
  status: "pending" | "processed" | "imported" | "error";
  import_attempts: number;
  last_import_at: string | null;
  created_at: string;
}

interface BankMatch {
  id: string;
  org_id: string;
  bank_transaction_id: string | null;
  ecommerce_transaction_id: string | null;
  match_type: "exact" | "partial" | "approximate";
  bank_amount: number;
  bank_date: string;
  ecommerce_amount: number | null;
  ecommerce_date: string | null;
  confidence_score: number;
  match_status: "pending" | "confirmed" | "rejected";
  notes: string | null;
  created_at: string;
}

interface BankReconciliation {
  id: string;
  org_id: string;
  statement_date: string;
  statement_end_date: string | null;
  total_bank_amount: number;
  total_ecommerce_amount: number;
  difference: number;
  matched_count: number;
  unmatched_bank_count: number;
  unmatched_ecommerce_count: number;
  status: "pending" | "confirmed" | "error";
  reconciled_at: string | null;
  notes: string | null;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateStr;
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "pending": return "yellow";
    case "processed": case "confirmed": case "imported": return "green";
    case "error": case "rejected": return "red";
    default: return "gray";
  }
}

/** Estados y métodos técnicos del banco en lenguaje del comercio. */
function statusLabel(status: string): string {
  return {
    pending: "Pendiente",
    processed: "Procesado",
    imported: "Importado",
    confirmed: "Confirmado",
    rejected: "Rechazado",
    error: "Error",
    active: "Activa",
    inactive: "Inactiva",
  }[status] ?? status;
}

function matchTypeLabel(type: string): string {
  return {
    exact: "Exacto",
    partial: "Parcial",
    approximate: "Aproximado",
  }[type] ?? type;
}

function connectionTypeLabel(type: string): string {
  return {
    direct: "Directa",
    oauth: "OAuth",
    csv: "CSV",
  }[type] ?? type;
}

function confidenceColor(score: number): string {
  if (score >= 90) return "text-green-600";
  if (score >= 70) return "text-yellow-600";
  return "text-red-600";
}

// ── Component ──────────────────────────────────────────────────
export default function FinanceBankReconciliationPage() {
  const [activeTab, setActiveTab] = useState<"accounts" | "statements" | "matches" | "reconciliations">("accounts");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [matches, setMatches] = useState<BankMatch[]>([]);
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [showNewStatement, setShowNewStatement] = useState(false);
  const [showNewReconciliation, setShowNewReconciliation] = useState(false);

  const sb = supabase as any;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: accountsData }, { data: statementsData }, { data: matchesData }, { data: reconciliationsData }] = await Promise.all([
        sb.from("bank_accounts").select("*").order("created_at", { ascending: false }),
        sb.from("bank_statements").select("*").order("created_at", { ascending: false }),
        sb.from("bank_matches").select("*").order("created_at", { ascending: false }),
        sb.from("bank_reconciliation").select("*").order("created_at", { ascending: false }),
      ]);
      setAccounts((accountsData ?? []) as BankAccount[]);
      setStatements((statementsData ?? []) as BankStatement[]);
      setMatches((matchesData ?? []) as BankMatch[]);
      setReconciliations((reconciliationsData ?? []) as BankReconciliation[]);
    } catch (err: any) {
      setError(err.message ?? "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, [sb]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filteredStatements = useMemo(() => {
    let result = statements;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.file_name.toLowerCase().includes(q) || s.sha256_hash.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter((s) => s.status === statusFilter);
    if (dateFrom) result = result.filter((s) => s.statement_date >= dateFrom);
    if (dateTo) result = result.filter((s) => s.statement_date <= dateTo);
    return result;
  }, [statements, searchQuery, statusFilter, dateFrom, dateTo]);

  const filteredMatches = useMemo(() => {
    let result = matches;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => (m.notes ?? "").toLowerCase().includes(q) || m.bank_transaction_id?.toLowerCase().includes(q) || m.ecommerce_transaction_id?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter((m) => m.match_status === statusFilter);
    return result;
  }, [matches, searchQuery, statusFilter]);

  const filteredReconciliations = useMemo(() => {
    let result = reconciliations;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.notes?.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter((r) => r.status === statusFilter);
    return result;
  }, [reconciliations, searchQuery, statusFilter]);

  const handleImportStatement = async (file: File) => {
    setError(null);
    try {
      const sha256 = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(sha256)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error: insertError } = await sb.from("bank_statements").insert({
        org_id: "", bank_account_id: accounts[0]?.id ?? null, statement_date: new Date().toISOString().split("T")[0],
        file_name: file.name, file_size: file.size, sha256_hash: hash, status: "pending",
      });
      if (insertError) throw insertError;
      await fetchData();
      setShowNewStatement(false);
    } catch (err: any) {
      setError(err.message ?? "Error al importar estado");
    }
  };

  const handleConfirmMatch = async (matchId: string) => {
    try {
      const { error } = await sb.from("bank_matches").update({ match_status: "confirmed" }).eq("id", matchId);
      if (error) throw error;
      await fetchData();
    } catch (err: any) { setError(err.message ?? "Error al confirmar match"); }
  };

  const handleRejectMatch = async (matchId: string) => {
    try {
      const { error } = await sb.from("bank_matches").update({ match_status: "rejected" }).eq("id", matchId);
      if (error) throw error;
      await fetchData();
    } catch (err: any) { setError(err.message ?? "Error al rechazar match"); }
  };

  const handleConfirmReconciliation = async (reconId: string) => {
    try {
      const { error } = await sb.from("bank_reconciliation").update({ status: "confirmed", reconciled_at: new Date().toISOString() }).eq("id", reconId);
      if (error) throw error;
      await fetchData();
    } catch (err: any) { setError(err.message ?? "Error al confirmar conciliación"); }
  };

  const kpis = useMemo(() => ({
    totalBank: reconciliations.reduce((s, r) => s + (r.total_bank_amount ?? 0), 0),
    totalEcommerce: reconciliations.reduce((s, r) => s + (r.total_ecommerce_amount ?? 0), 0),
    totalDifference: reconciliations.reduce((s, r) => s + (r.difference ?? 0), 0),
    confirmedCount: reconciliations.filter((r) => r.status === "confirmed").length,
    pendingCount: reconciliations.filter((r) => r.status === "pending").length,
    totalStatements: statements.length,
    processedStatements: statements.filter((s) => s.status === "processed").length,
    totalMatches: matches.length,
    confirmedMatches: matches.filter((m) => m.match_status === "confirmed").length,
  }), [reconciliations, statements, matches]);

  if (loading && !accounts.length && !statements.length) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Cargando conciliación bancaria...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conciliación bancaria</h1>
          <p className="text-sm text-muted-foreground">Match bancario, exportación contable y estado de cuenta</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refrescar
          </Button>
          <Button onClick={() => setShowNewStatement(true)}>
            <FileText className="mr-2 h-4 w-4" />
            Importar estado
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto mt-2">
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total bancario</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(kpis.totalBank)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total ecommerce</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(kpis.totalEcommerce)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Diferencia</CardTitle></CardHeader><CardContent><div className={cn("text-2xl font-bold", kpis.totalDifference !== 0 ? "text-red-600" : "text-green-600")}>{formatCurrency(kpis.totalDifference)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Matches confirmados</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.confirmedMatches} / {kpis.totalMatches}</div></CardContent></Card>
      </div>

      <div className="flex gap-2 border-b">
        {[{ id: "accounts", label: "Cuentas", icon: Banknote }, { id: "statements", label: "Estados", icon: FileText }, { id: "matches", label: "Matches", icon: CheckCircle2 }, { id: "reconciliations", label: "Conciliaciones", icon: TrendingUp }].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={cn("relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors", activeTab === tab.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="processed">Procesado</SelectItem>
            <SelectItem value="confirmed">Confirmado</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="Desde" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="Hasta" />
        <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}>Limpiar</Button>
      </div>

      {activeTab === "accounts" && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Banco</TableHead>
                <TableHead>CBU</TableHead>
                <TableHead>Alias</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Última conexión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No hay cuentas bancarias registradas</TableCell></TableRow>
              ) : (
                accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.bank_name}</TableCell>
                    <TableCell className="font-mono text-xs">{account.bank_cbu}</TableCell>
                    <TableCell>{account.bank_alias || "—"}</TableCell>
                    <TableCell>{account.bank_holder}</TableCell>
                    <TableCell><Badge variant="outline">{account.connection_type}</Badge></TableCell>
                    <TableCell><Badge variant={account.status === "active" ? "default" : "secondary"}>{account.status}</Badge></TableCell>
                    <TableCell>{formatDate(account.last_connection)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "statements" && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Archivo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Tamaño</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStatements.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hay estados bancarios importados</TableCell></TableRow>
              ) : (
                filteredStatements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-medium">{statement.file_name}</TableCell>
                    <TableCell>{formatDate(statement.statement_date)}</TableCell>
                    <TableCell>{statement.file_size ? `${(statement.file_size / 1024).toFixed(1)} KB` : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{statement.sha256_hash.slice(0, 16)}...</TableCell>
                    <TableCell><Badge variant={statusBadge(statement.status) as any}>{statement.status}</Badge></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === "matches" && (
        <div className="space-y-4">
          {filteredMatches.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">No hay matches de conciliación</div>
          ) : (
            filteredMatches.map((match) => (
              <Card key={match.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{match.match_type}</Badge>
                        <Badge variant={statusBadge(match.match_status) as any}>{match.match_status}</Badge>
                        <span className={cn("text-sm font-medium", confidenceColor(match.confidence_score))}>{match.confidence_score}% confianza</span>
                      </div>
                      <div className="text-sm text-muted-foreground">Banco: {formatCurrency(match.bank_amount)} · {formatDate(match.bank_date)}</div>
                      <div className="text-sm text-muted-foreground">Ecommerce: {match.ecommerce_amount ? `${formatCurrency(match.ecommerce_amount)} · ${formatDate(match.ecommerce_date)}` : "—"}</div>
                      {match.notes && <div className="text-sm">{match.notes}</div>}
                    </div>
                    <div className="flex gap-2">
                      {match.match_status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handleConfirmMatch(match.id)}><CheckCircle2 className="mr-1 h-4 w-4" />Confirmar</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleRejectMatch(match.id)}><XCircle className="mr-1 h-4 w-4" />Rechazar</Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "reconciliations" && (
        <div className="space-y-4">
          {filteredReconciliations.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">No hay conciliaciones realizadas</div>
          ) : (
            filteredReconciliations.map((recon) => (
              <Card key={recon.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{formatDate(recon.statement_date)}</Badge>
                        <Badge variant={statusBadge(recon.status) as any}>{recon.status}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div><span className="text-muted-foreground">Banco:</span> <span className="font-medium">{formatCurrency(recon.total_bank_amount)}</span></div>
                        <div><span className="text-muted-foreground">Ecommerce:</span> <span className="font-medium">{formatCurrency(recon.total_ecommerce_amount)}</span></div>
                        <div><span className="text-muted-foreground">Diferencia:</span> <span className={cn("font-medium", recon.difference !== 0 ? "text-red-600" : "text-green-600")}>{formatCurrency(recon.difference)}</span></div>
                      </div>
                      <div className="text-xs text-muted-foreground">Matches: {recon.matched_count} · Sin match banco: {recon.unmatched_bank_count} · Sin match ecommerce: {recon.unmatched_ecommerce_count}</div>
                    </div>
                    <div className="flex gap-2">
                      {recon.status === "pending" && (
                        <Button size="sm" onClick={() => handleConfirmReconciliation(recon.id)}><CheckCircle2 className="mr-1 h-4 w-4" />Confirmar</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <Dialog open={showNewStatement} onOpenChange={setShowNewStatement}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar estado bancario</DialogTitle>
            <DialogDescription>Seleccione el archivo CSV o PDF del banco a conciliar.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="statement-file">Archivo</Label>
              <Input id="statement-file" type="file" accept=".csv,.pdf,.xlsx" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImportStatement(file); }} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="statement-account">Cuenta bancaria</Label>
              <select id="statement-account" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Seleccionar cuenta</option>
                {accounts.map((acc) => (<option key={acc.id} value={acc.id}>{acc.bank_name} - {acc.bank_alias || acc.bank_cbu}</option>))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewStatement(false)}>Cancelar</Button>
            <Button onClick={() => setShowNewStatement(false)}>Importar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewReconciliation} onOpenChange={setShowNewReconciliation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva conciliación</DialogTitle>
            <DialogDescription>Inicie una nueva conciliación bancaria manual.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="recon-date">Fecha de estado</Label>
              <Input id="recon-date" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recon-end-date">Fecha fin</Label>
              <Input id="recon-end-date" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recon-notes">Notas</Label>
              <Textarea id="recon-notes" placeholder="Observaciones..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewReconciliation(false)}>Cancelar</Button>
            <Button onClick={() => setShowNewReconciliation(false)}>Crear conciliación</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}