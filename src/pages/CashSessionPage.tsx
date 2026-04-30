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
import {
  Banknote, Lock, Unlock, Clock, TrendingUp, TrendingDown,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, RotateCcw,
} from "lucide-react";

interface CashSession {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_amount: number | null;
  expected_cash: number | null;
  difference: number | null;
  notes: string | null;
  status: "open" | "closed";
}

export default function CashSessionPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Open form
  const [openingAmount, setOpeningAmount] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");

  // Close form
  const [closingAmount, setClosingAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");

  // Session sales (for expected cash calculation)
  const [sessionSales, setSessionSales] = useState<any[]>([]);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("opened_at", { ascending: false })
      .limit(30);

    const all = (data || []) as CashSession[];
    setSessions(all);
    const current = all.find((s) => s.status === "open") || null;
    setOpenSession(current);

    // Load sales from this session (if open)
    if (current) {
      const { data: sales } = await supabase
        .from("sales")
        .select("total_ars, payment_method, date")
        .eq("org_id", activeOrg.id)
        .gte("date", current.opened_at);
      setSessionSales(sales || []);
    } else {
      setSessionSales([]);
    }
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  // Computed stats for open session
  const cashSales = sessionSales.filter((s) => s.payment_method === "efectivo" || !s.payment_method);
  const transferSales = sessionSales.filter((s) => s.payment_method === "transferencia");
  const otherSales = sessionSales.filter((s) => !["efectivo", "transferencia"].includes(s.payment_method || "efectivo"));
  const totalCash = cashSales.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalTransfer = transferSales.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalOther = otherSales.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalAll = sessionSales.reduce((s, v) => s + Number(v.total_ars), 0);
  const expectedCash = openSession ? Number(openSession.opening_amount) + totalCash : 0;
  const closingDiff = closingAmount !== "" ? Number(closingAmount) - expectedCash : null;

  const openCaja = async () => {
    if (!activeOrg || !user) return;
    if (openSession) { toast.error("Ya hay una caja abierta"); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("cash_sessions").insert({
        org_id: activeOrg.id,
        opened_by: user.id,
        opening_amount: Number(openingAmount) || 0,
        notes: openingNotes || null,
        status: "open",
      });
      if (error) throw error;
      toast.success("Caja abierta");
      setOpeningAmount("0"); setOpeningNotes("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const closeCaja = async () => {
    if (!activeOrg || !user || !openSession) return;
    if (!closingAmount.trim()) { toast.error("Ingresá el monto de cierre"); return; }
    setSubmitting(true);
    try {
      const closing = Number(closingAmount);
      const diff = closing - expectedCash;
      const { error } = await supabase.from("cash_sessions").update({
        closed_by: user.id,
        closed_at: new Date().toISOString(),
        closing_amount: closing,
        expected_cash: expectedCash,
        difference: diff,
        notes: closingNotes || openSession.notes,
        status: "closed",
      }).eq("id", openSession.id);
      if (error) throw error;
      toast.success("Caja cerrada correctamente");
      setClosingAmount(""); setClosingNotes("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const sessionDuration = openSession
    ? Math.round((Date.now() - new Date(openSession.opened_at).getTime()) / 60000)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Banknote className="w-6 h-6 text-primary" />Apertura & Cierre de Caja
        </h1>
        <p className="text-sm text-muted-foreground">Controlá cada turno de tu punto de venta</p>
      </div>

      {/* Status banner */}
      <div className={`rounded-2xl border p-4 flex items-center gap-4 ${
        openSession
          ? "bg-green-500/8 border-green-500/20"
          : "bg-muted/40 border-border"
      }`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          openSession ? "bg-green-500/15" : "bg-muted"
        }`}>
          {openSession
            ? <Unlock className="w-5 h-5 text-green-400" />
            : <Lock className="w-5 h-5 text-muted-foreground" />
          }
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">
            {openSession ? "Caja abierta" : "Caja cerrada"}
          </p>
          <p className="text-xs text-muted-foreground">
            {openSession
              ? `Abierta hace ${sessionDuration < 60 ? `${sessionDuration} min` : `${Math.round(sessionDuration / 60)}h ${sessionDuration % 60}m`} · ${sessionSales.length} ventas · ${formatARS(totalAll)}`
              : "No hay turno activo"
            }
          </p>
        </div>
        {openSession && (
          <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-xs">
            ACTIVA
          </Badge>
        )}
      </div>

      {/* OPEN SESSION */}
      {!openSession && !loading && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Unlock className="w-4 h-4 text-green-400" />Abrir caja</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Monto inicial en caja ($)</Label>
              <Input
                type="number" min="0" step="100"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                placeholder="0"
                className="bg-muted font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Efectivo físico que hay en la caja al iniciar el turno</p>
            </div>
            <div>
              <Label className="text-xs">Notas del turno</Label>
              <Input
                value={openingNotes}
                onChange={(e) => setOpeningNotes(e.target.value)}
                placeholder="Ej: turno mañana, encargada: Ana"
                className="bg-muted"
              />
            </div>
          </div>
          <Button onClick={openCaja} disabled={submitting} className="gradient-gold text-primary-foreground gap-2">
            <Unlock className="w-4 h-4" />{submitting ? "Abriendo..." : "Abrir caja"}
          </Button>
        </div>
      )}

      {/* CLOSE SESSION + LIVE STATS */}
      {openSession && (
        <div className="space-y-4">
          {/* Live stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: "Efectivo vendido", v: formatARS(totalCash), icon: Banknote, color: "text-green-400" },
              { l: "Transferencias", v: formatARS(totalTransfer), icon: TrendingUp, color: "text-blue-400" },
              { l: "Otros métodos", v: formatARS(totalOther), icon: TrendingUp, color: "text-purple-400" },
              { l: "Total del turno", v: formatARS(totalAll), icon: TrendingUp, color: "text-primary" },
            ].map((s) => (
              <div key={s.l} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
                  <s.icon className="w-4 h-4 text-muted-foreground/40" />
                </div>
                <div className={`text-xl font-display font-bold ${s.color}`}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Efectivo esperado */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Efectivo esperado en caja</p>
              <p className="text-xs text-muted-foreground">Monto inicial {formatARS(openSession.opening_amount)} + ventas en efectivo {formatARS(totalCash)}</p>
            </div>
            <span className="text-2xl font-display font-bold text-primary">{formatARS(expectedCash)}</span>
          </div>

          {/* Close form */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <h2 className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4 text-red-400" />Cerrar caja</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Efectivo contado al cierre ($)</Label>
                <Input
                  type="number" min="0" step="100"
                  value={closingAmount}
                  onChange={(e) => setClosingAmount(e.target.value)}
                  placeholder={formatARS(expectedCash)}
                  className="bg-muted font-mono"
                />
                {closingDiff !== null && (
                  <div className={`mt-1.5 flex items-center gap-1.5 text-xs font-semibold ${
                    Math.abs(closingDiff) < 100 ? "text-green-400" :
                    closingDiff > 0 ? "text-yellow-400" : "text-red-400"
                  }`}>
                    {closingDiff >= 0
                      ? <TrendingUp className="w-3.5 h-3.5" />
                      : <TrendingDown className="w-3.5 h-3.5" />
                    }
                    {Math.abs(closingDiff) < 100
                      ? "Cuadra perfectamente"
                      : closingDiff > 0
                      ? `Sobrante: ${formatARS(closingDiff)}`
                      : `Faltante: ${formatARS(Math.abs(closingDiff))}`
                    }
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Observaciones del cierre</Label>
                <Input
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="Ej: diferencia por vuelto, sin novedades..."
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={closeCaja}
                disabled={submitting || !closingAmount.trim()}
                variant="destructive"
                className="gap-2"
              >
                <Lock className="w-4 h-4" />{submitting ? "Cerrando..." : "Cerrar caja"}
              </Button>
              <Button variant="outline" onClick={load} className="gap-2">
                <RotateCcw className="w-4 h-4" />Actualizar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Historial de turnos</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : sessions.filter((s) => s.status === "closed").length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aún no hay turnos cerrados</div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.filter((s) => s.status === "closed").map((s) => {
              const diff = s.difference || 0;
              const isOpen = expanded === s.id;
              return (
                <div key={s.id}>
                  <button
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors text-left"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      Math.abs(diff) < 100 ? "bg-green-500/15" :
                      diff > 0 ? "bg-yellow-500/15" : "bg-red-500/15"
                    }`}>
                      {Math.abs(diff) < 100
                        ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                        : <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {new Date(s.opened_at).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(s.opened_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                        {" → "}
                        {s.closed_at ? new Date(s.closed_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-mono font-semibold">{formatARS(s.closing_amount || 0)}</p>
                      {Math.abs(diff) >= 100 && (
                        <p className={`text-xs font-mono ${diff > 0 ? "text-yellow-400" : "text-red-400"}`}>
                          {diff > 0 ? "+" : ""}{formatARS(diff)}
                        </p>
                      )}
                    </div>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-border bg-muted/10 px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      {[
                        { l: "Apertura", v: formatARS(s.opening_amount) },
                        { l: "Cierre declarado", v: formatARS(s.closing_amount || 0) },
                        { l: "Efectivo esperado", v: formatARS(s.expected_cash || 0) },
                        { l: "Diferencia", v: formatARS(diff), color: Math.abs(diff) < 100 ? "text-green-400" : diff > 0 ? "text-yellow-400" : "text-red-400" },
                      ].map((item) => (
                        <div key={item.l}>
                          <p className="text-muted-foreground">{item.l}</p>
                          <p className={`font-mono font-semibold mt-0.5 ${(item as any).color || ""}`}>{item.v}</p>
                        </div>
                      ))}
                      {s.notes && (
                        <div className="col-span-2 md:col-span-4 text-muted-foreground italic">{s.notes}</div>
                      )}
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
