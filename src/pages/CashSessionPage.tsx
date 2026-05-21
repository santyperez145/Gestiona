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
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Banknote, Lock, Unlock, Clock, TrendingUp, TrendingDown,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, RotateCcw,
  ArrowDownCircle, ArrowUpCircle, List, Printer, FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

// ── Export helpers ────────────────────────────────────────────────────────────
function printCashReport(
  session: CashSession,
  entries: CashEntry[],
  orgName: string,
) {
  const LABELS: Record<string, string> = {
    sale_in: "Venta", debt_payment: "Cobro deuda", manual_in: "Ingreso",
    expense_out: "Gasto", supplier_out: "Proveedor", manual_out: "Egreso",
    opening: "Apertura", closing: "Cierre",
  };
  const isOut = (t: string) => ["expense_out", "supplier_out", "manual_out"].includes(t);

  const totalIn = entries.filter(e => !isOut(e.entry_type) && e.entry_type !== "opening").reduce((s, e) => s + Number(e.amount_ars), 0);
  const totalOut = entries.filter(e => isOut(e.entry_type)).reduce((s, e) => s + Number(e.amount_ars), 0);

  // Group by payment method for in-entries
  const byMethod: Record<string, number> = {};
  entries.filter(e => !isOut(e.entry_type) && e.entry_type !== "opening").forEach(e => {
    const m = e.payment_method || "efectivo";
    byMethod[m] = (byMethod[m] || 0) + Number(e.amount_ars);
  });

  const diff = session.difference || 0;
  const diffColor = Math.abs(diff) < 100 ? "#16a34a" : diff > 0 ? "#d97706" : "#dc2626";

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Cierre de Caja — ${orgName}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 20px; font-size: 12px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 2px; } .sub { color: #666; font-size: 11px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
  .card-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; }
  .card-value { font-size: 16px; font-weight: 700; font-family: monospace; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
  .in { color: #16a34a; } .out { color: #dc2626; }
  .summary { border-top: 2px solid #e5e7eb; margin-top: 16px; padding-top: 12px; }
  .diff { font-weight: 700; color: ${diffColor}; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Cierre de Caja</h1>
<p class="sub">${orgName} · ${format(new Date(session.opened_at), "EEEE d 'de' MMMM yyyy", { locale: es })}</p>

<div class="grid">
  <div class="card"><div class="card-label">Apertura</div><div class="card-value">${formatARS(session.opening_amount)}</div></div>
  <div class="card"><div class="card-label">Efectivo esperado</div><div class="card-value">${formatARS(session.expected_cash || 0)}</div></div>
  <div class="card"><div class="card-label">Cierre declarado</div><div class="card-value">${formatARS(session.closing_amount || 0)}</div></div>
  <div class="card"><div class="card-label">Diferencia</div><div class="card-value diff">${diff >= 0 ? "+" : ""}${formatARS(diff)}</div></div>
</div>

<table>
  <thead><tr><th>Hora</th><th>Tipo</th><th>Descripción</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
  <tbody>
    ${entries.map(e => {
      const out = isOut(e.entry_type);
      return `<tr>
        <td>${format(new Date(e.created_at), "HH:mm")}</td>
        <td>${LABELS[e.entry_type] || e.entry_type}</td>
        <td>${e.description || "—"}</td>
        <td>${e.payment_method || "efectivo"}</td>
        <td style="text-align:right" class="${out ? "out" : "in"}">${out ? "−" : "+"}${formatARS(Number(e.amount_ars))}</td>
      </tr>`;
    }).join("")}
  </tbody>
</table>

<div class="summary">
  <table>
    <thead><tr><th colspan="2">Resumen por método de pago (ingresos)</th></tr></thead>
    <tbody>
      ${Object.entries(byMethod).map(([m, v]) => `<tr><td>${m}</td><td class="in" style="text-align:right">${formatARS(v)}</td></tr>`).join("")}
      <tr><td><strong>Total ingresos</strong></td><td class="in" style="text-align:right"><strong>${formatARS(totalIn)}</strong></td></tr>
      <tr><td><strong>Total egresos</strong></td><td class="out" style="text-align:right"><strong>−${formatARS(totalOut)}</strong></td></tr>
    </tbody>
  </table>
  ${session.notes ? `<p style="margin-top:12px;color:#6b7280;font-style:italic">Notas: ${session.notes}</p>` : ""}
</div>

<p style="margin-top:20px;font-size:10px;color:#9ca3af">Generado por Gestiona · ${new Date().toLocaleString("es-AR")}</p>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { toast.error("Permitir popups para imprimir"); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

function exportCashCSV(session: CashSession, entries: CashEntry[], orgName: string) {
  const LABELS: Record<string, string> = {
    sale_in: "Venta", debt_payment: "Cobro deuda", manual_in: "Ingreso",
    expense_out: "Gasto", supplier_out: "Proveedor", manual_out: "Egreso",
    opening: "Apertura", closing: "Cierre",
  };
  const rows = [
    ["Hora", "Tipo", "Descripción", "Método", "Monto ARS"],
    ...entries.map(e => [
      format(new Date(e.created_at), "HH:mm"),
      LABELS[e.entry_type] || e.entry_type,
      e.description || "",
      e.payment_method || "efectivo",
      String(Number(e.amount_ars)),
    ]),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `caja-${format(new Date(session.opened_at), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exportado");
}

interface CashEntry {
  id: string;
  entry_type: string;
  payment_method: string | null;
  amount_ars: number;
  description: string | null;
  created_at: string;
}

const ENTRY_TYPE_META: Record<string, { label: string; color: string; sign: string }> = {
  sale_in:      { label: "Venta",         color: "text-green-400",  sign: "+" },
  debt_payment: { label: "Cobro deuda",   color: "text-blue-400",   sign: "+" },
  manual_in:    { label: "Ingreso",       color: "text-emerald-400",sign: "+" },
  expense_out:  { label: "Gasto",         color: "text-red-400",    sign: "−" },
  supplier_out: { label: "Proveedor",     color: "text-orange-400", sign: "−" },
  manual_out:   { label: "Egreso",        color: "text-red-400",    sign: "−" },
  opening:      { label: "Apertura",      color: "text-muted-foreground", sign: "" },
  closing:      { label: "Cierre",        color: "text-muted-foreground", sign: "" },
};

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
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [showEntries, setShowEntries] = useState(false);
  // Historical session entries for printing closed sessions
  const [sessionEntriesMap, setSessionEntriesMap] = useState<Record<string, CashEntry[]>>({});

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

      // Load cash entries for active session
      const { data: entries } = await supabase
        .from("cash_entries")
        .select("id, entry_type, payment_method, amount_ars, description, created_at")
        .eq("session_id", current.id)
        .order("created_at", { ascending: false })
        .limit(100);
      setCashEntries((entries as CashEntry[]) || []);
    } else {
      setSessionSales([]);
      setCashEntries([]);
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
      <PageHeader
        icon={Banknote}
        title="Apertura & Cierre de Caja"
        description="Controlá cada turno de tu punto de venta"
        badge={
          openSession
            ? { label: `Abierta · ${sessionDuration < 60 ? `${sessionDuration}min` : `${Math.round(sessionDuration / 60)}h`}`, variant: "success" }
            : { label: "Cerrada", variant: "default" }
        }
      />

      {/* Status banner */}
      <div className={`rounded-[10px] border p-4 flex items-center gap-4 ${
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
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-5 space-y-4">
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
              <div key={s.l} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
                  <s.icon className="w-4 h-4 text-muted-foreground/40" />
                </div>
                <div className={`text-xl font-display font-bold ${s.color}`}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Breakdown by seller */}
          {(() => {
            const bySeller: Record<string, number> = {};
            sessionSales.forEach(s => {
              const k = s.seller_name || "Sin asignar";
              bySeller[k] = (bySeller[k] || 0) + Number(s.total_ars || 0);
            });
            const entries = Object.entries(bySeller).sort((a, b) => b[1] - a[1]);
            if (entries.length < 2) return null;
            return (
              <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ventas por vendedor</p>
                <div className="space-y-2">
                  {entries.map(([name, total]) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-semibold">{formatARS(total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Efectivo esperado */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Efectivo esperado en caja</p>
              <p className="text-xs text-muted-foreground">Monto inicial {formatARS(openSession.opening_amount)} + ventas en efectivo {formatARS(totalCash)}</p>
            </div>
            <span className="text-2xl font-display font-bold text-primary">{formatARS(expectedCash)}</span>
          </div>

          {/* Close form */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-5 space-y-4">
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

      {/* Cash entries for active session */}
      {openSession && (
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
            onClick={() => setShowEntries(v => !v)}
          >
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <List className="w-4 h-4 text-primary" />
              Movimientos del turno
              <Badge variant="secondary" className="ml-1 text-xs">{cashEntries.length}</Badge>
            </h2>
            <div className="flex items-center gap-2">
              {showEntries && openSession && (
                <Button
                  size="sm" variant="ghost" className="h-7 w-7 p-0"
                  title="Imprimir movimientos"
                  onClick={e => { e.stopPropagation(); printCashReport(openSession, cashEntries, activeOrg?.name || "Gestiona"); }}
                >
                  <Printer className="w-3.5 h-3.5" />
                </Button>
              )}
              {showEntries ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </button>
          {showEntries && (
            cashEntries.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Sin movimientos registrados aún. Los ingresos se registran automáticamente al vender.
              </div>
            ) : (
              <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
                {cashEntries.map(e => {
                  const meta = ENTRY_TYPE_META[e.entry_type] ?? { label: e.entry_type, color: "text-foreground", sign: "" };
                  const isOut = ["expense_out", "supplier_out", "manual_out"].includes(e.entry_type);
                  return (
                    <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${isOut ? "bg-red-500/10" : "bg-green-500/10"}`}>
                        {isOut
                          ? <ArrowUpCircle className="w-3.5 h-3.5 text-red-400" />
                          : <ArrowDownCircle className="w-3.5 h-3.5 text-green-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{e.description ?? meta.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {meta.label} · {e.payment_method ?? "efectivo"} · {format(new Date(e.created_at), "HH:mm", { locale: es })}
                        </p>
                      </div>
                      <span className={`text-sm font-mono font-semibold shrink-0 ${meta.color}`}>
                        {meta.sign}{formatARS(e.amount_ars)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {/* History */}
      <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
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
                    onClick={async () => {
                      const next = isOpen ? null : s.id;
                      setExpanded(next);
                      // Load entries for this session if not cached
                      if (next && !sessionEntriesMap[s.id]) {
                        const { data } = await supabase
                          .from("cash_entries")
                          .select("*")
                          .eq("session_id", s.id)
                          .order("created_at");
                        setSessionEntriesMap(prev => ({ ...prev, [s.id]: (data || []) as CashEntry[] }));
                      }
                    }}
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
                    <div className="border-t border-border bg-muted/10 px-5 py-4 space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        {[
                          { l: "Apertura", v: formatARS(s.opening_amount) },
                          { l: "Cierre declarado", v: formatARS(s.closing_amount || 0) },
                          { l: "Efectivo esperado", v: formatARS(s.expected_cash || 0) },
                          { l: "Diferencia", v: formatARS(diff), color: Math.abs(diff) < 100 ? "text-green-400" : diff > 0 ? "text-yellow-400" : "text-red-400" },
                        ].map((item) => (
                          <div key={item.l}>
                            <p className="text-muted-foreground">{item.l}</p>
                            <p className={`font-mono font-semibold mt-0.5 ${item.color || ""}`}>{item.v}</p>
                          </div>
                        ))}
                        {s.notes && (
                          <div className="col-span-2 md:col-span-4 text-muted-foreground italic">{s.notes}</div>
                        )}
                      </div>
                      {/* Export buttons */}
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                          onClick={() => printCashReport(s, sessionEntriesMap[s.id] || [], activeOrg?.name || "Gestiona")}
                        >
                          <Printer className="w-3 h-3" />Imprimir / PDF
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                          onClick={() => exportCashCSV(s, sessionEntriesMap[s.id] || [], activeOrg?.name || "Gestiona")}
                        >
                          <FileSpreadsheet className="w-3 h-3" />CSV
                        </Button>
                      </div>
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
