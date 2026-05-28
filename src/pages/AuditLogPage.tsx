import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Shield, Search, Filter, Download, RefreshCcw, Eye, AlertTriangle,
  Info, AlertCircle, ZapOff, CheckCircle2, User, Clock, Globe, Loader2,
  Activity, Users
} from "lucide-react";

/* ─────────────────────────── types ─────────────────────────── */
interface AuditLog {
  id: number;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  ip_address: string | null;
  severity: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditSummaryRow {
  entity_type: string;
  action: string;
  event_count: number;
  unique_users: number;
  last_event: string;
}

/* ─────────────────────────── configs ─────────────────────────── */
const SEVERITY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  debug:    { label: "Debug",    color: "bg-gray-100 text-gray-500",    icon: <Info className="w-3 h-3" /> },
  info:     { label: "Info",     color: "bg-blue-100 text-blue-700",    icon: <Info className="w-3 h-3" /> },
  warning:  { label: "Advertencia", color: "bg-yellow-100 text-yellow-700", icon: <AlertTriangle className="w-3 h-3" /> },
  error:    { label: "Error",    color: "bg-red-100 text-red-700",      icon: <AlertCircle className="w-3 h-3" /> },
  critical: { label: "Crítico",  color: "bg-red-200 text-red-900",      icon: <ZapOff className="w-3 h-3" /> },
};

const ACTION_COLOR: Record<string, string> = {
  create: "text-green-600", update: "text-blue-600", delete: "text-red-600",
  login: "text-purple-600", logout: "text-gray-500", export: "text-orange-600",
};

function getActionColor(action: string) {
  const verb = action.split(".")[1] ?? action.split("_")[0];
  return ACTION_COLOR[verb] ?? "text-gray-600";
}

const ENTITY_ICONS: Record<string, string> = {
  sale: "💰", product: "📦", expense: "💸", client: "👤", invoice: "🧾",
  user: "🔐", setting: "⚙️", import: "📥", export: "📤",
};

const TABS = ["Línea de tiempo", "Resumen", "Exportar"] as const;
type Tab = typeof TABS[number];

export default function AuditLogPage() {
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<Tab>("Línea de tiempo");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  /* filters */
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(new Date().toISOString().slice(0, 10));

  /* detail modal */
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    let q = supabase.from("audit_logs")
      .select("*", { count: "exact" })
      .eq("org_id", orgId)
      .gte("created_at", filterFrom)
      .lte("created_at", filterTo + "T23:59:59")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterSeverity !== "all") q = q.eq("severity", filterSeverity);
    if (filterEntity !== "all") q = q.eq("entity_type", filterEntity);
    if (search) q = q.or(`action.ilike.%${search}%,entity_label.ilike.%${search}%,user_email.ilike.%${search}%`);

    const { data, count, error } = await q;
    if (!error && data) {
      setLogs(data as AuditLog[]);
      setTotal(count ?? 0);
    }

    // Summary via RPC
    const { data: sumData } = await supabase.rpc("get_audit_summary", {
      p_org_id: orgId, p_from: filterFrom + "T00:00:00Z", p_to: filterTo + "T23:59:59Z",
    });
    if (sumData) setSummary(sumData as AuditSummaryRow[]);

    setLoading(false);
  }, [orgId, page, filterSeverity, filterEntity, search, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  /* unique entity types for filter */
  const entityTypes = Array.from(new Set(logs.map(l => l.entity_type)));

  /* CSV export */
  function exportCSV() {
    const headers = ["Fecha", "Email", "Acción", "Entidad", "Referencia", "Severidad", "IP"];
    const rows = logs.map(l => [
      new Date(l.created_at).toLocaleString("es-AR"),
      l.user_email ?? "", l.action, l.entity_type,
      l.entity_label ?? "", l.severity, l.ip_address ?? ""
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `audit_${filterFrom}_${filterTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-slate-600" /> Registro de Auditoría
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Traza inmutable de todas las acciones del sistema</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCcw className="w-4 h-4 mr-1" /> Actualizar</Button>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 mr-1" /> CSV</Button>
        </div>
      </div>

      {/* Stats chips */}
      <div className="flex gap-3 flex-wrap">
        {Object.entries(SEVERITY_CONFIG).map(([sev, cfg]) => {
          const count = logs.filter(l => l.severity === sev).length;
          if (count === 0) return null;
          return (
            <button key={sev} onClick={() => setFilterSeverity(filterSeverity === sev ? "all" : sev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterSeverity === sev ? cfg.color + " border-current" : "bg-white text-gray-600 hover:border-gray-300"}`}>
              {cfg.icon}{cfg.label} ({count})
            </button>
          );
        })}
        <span className="text-xs text-gray-400 self-center ml-auto">{total.toLocaleString("es-AR")} eventos totales</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap bg-white border rounded-xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Buscar acción, entidad, email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-64" />
        </div>
        <div className="flex gap-2">
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="w-40" />
          <span className="self-center text-gray-400">→</span>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="w-40" />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Severidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(SEVERITY_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterEntity} onValueChange={setFilterEntity}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Entidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {entityTypes.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterSeverity("all"); setFilterEntity("all"); }}><Filter className="w-4 h-4 mr-1" /> Limpiar</Button>
      </div>

      {loading ? <div className="text-center py-16 text-gray-400">Cargando…</div> : (
        <>
          {activeTab === "Línea de tiempo" && (
            <>
              <div className="space-y-2">
                {logs.map(l => {
                  const sev = SEVERITY_CONFIG[l.severity] ?? SEVERITY_CONFIG.info;
                  const icon = ENTITY_ICONS[l.entity_type.split(".")[0]] ?? "📋";
                  return (
                    <div key={l.id} className="bg-white border rounded-xl px-4 py-3 flex items-start gap-3 hover:shadow-sm transition-shadow cursor-pointer group"
                      onClick={() => setSelectedLog(l)}>
                      <span className="text-xl mt-0.5">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono text-sm font-medium ${getActionColor(l.action)}`}>{l.action}</span>
                          {l.entity_label && <span className="text-sm text-gray-600 truncate">— {l.entity_label}</span>}
                          <Badge className={`${sev.color} flex items-center gap-1 text-xs ml-auto`}>{sev.icon}{sev.label}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                          {l.user_email && <span className="flex items-center gap-1"><User className="w-3 h-3" />{l.user_email}</span>}
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(l.created_at).toLocaleString("es-AR")}</span>
                          {l.ip_address && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{l.ip_address}</span>}
                          {l.tags && l.tags.length > 0 && l.tags.map(tag => <span key={tag} className="bg-gray-100 px-1.5 py-0.5 rounded">{tag}</span>)}
                        </div>
                      </div>
                      <Eye className="w-4 h-4 text-gray-300 group-hover:text-blue-400 shrink-0 mt-1" />
                    </div>
                  );
                })}
                {logs.length === 0 && (
                  <div className="text-center py-16 text-gray-400">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Sin eventos en el período seleccionado</p>
                  </div>
                )}
              </div>

              {/* pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                  <span className="text-sm text-gray-500">Pág. {page + 1} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                </div>
              )}
            </>
          )}

          {activeTab === "Resumen" && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>{["Entidad","Acción","Total eventos","Usuarios únicos","Último evento"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {summary.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{ENTITY_ICONS[s.entity_type] ?? "📋"} {s.entity_type}</td>
                      <td className={`px-4 py-3 font-mono text-sm ${getActionColor(s.action)}`}>{s.action}</td>
                      <td className="px-4 py-3 font-semibold">{s.event_count.toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3 text-gray-600">{s.unique_users}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(s.last_event).toLocaleString("es-AR")}</td>
                    </tr>
                  ))}
                  {summary.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400">Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "Exportar" && (
            <div className="bg-white rounded-xl border p-8 max-w-md space-y-4">
              <h2 className="font-semibold text-gray-800">Exportar registros de auditoría</h2>
              <p className="text-sm text-gray-500">Descargá todos los eventos filtrados actualmente en formato CSV.</p>
              <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1 text-gray-600">
                <p>Período: <strong>{filterFrom} → {filterTo}</strong></p>
                <p>Eventos: <strong>{total.toLocaleString("es-AR")}</strong></p>
                <p>Severidad: <strong>{filterSeverity === "all" ? "Todas" : filterSeverity}</strong></p>
              </div>
              <Button onClick={exportCSV} className="w-full"><Download className="w-4 h-4 mr-2" /> Descargar CSV</Button>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        {selectedLog && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-base">
                <span className="text-xl">{ENTITY_ICONS[selectedLog.entity_type] ?? "📋"}</span>
                {selectedLog.action}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">Usuario</p>
                  <p className="font-medium">{selectedLog.user_email ?? "Sistema"}</p>
                  <p className="text-xs text-gray-400">{selectedLog.user_role}</p>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">Entidad</p>
                  <p className="font-medium">{selectedLog.entity_type}</p>
                  <p className="text-xs text-gray-400">{selectedLog.entity_label ?? selectedLog.entity_id}</p>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">Fecha y hora</p>
                  <p className="font-medium">{new Date(selectedLog.created_at).toLocaleString("es-AR")}</p>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">IP / Severidad</p>
                  <p className="font-medium">{selectedLog.ip_address ?? "—"}</p>
                  <Badge className={`${SEVERITY_CONFIG[selectedLog.severity]?.color} text-xs mt-1`}>{selectedLog.severity}</Badge>
                </div>
              </div>
              {selectedLog.diff && Object.keys(selectedLog.diff).length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Cambios detectados</p>
                  <div className="bg-gray-50 rounded p-3 space-y-1.5 font-mono text-xs">
                    {Object.entries(selectedLog.diff).map(([key, val]) => {
                      const v = val as { from: unknown; to: unknown };
                      return (
                        <div key={key} className="flex gap-2 items-start">
                          <span className="text-gray-500 shrink-0 w-24 truncate">{key}:</span>
                          <span className="text-red-500 line-through">{JSON.stringify(v.from)}</span>
                          <span className="text-gray-400">→</span>
                          <span className="text-green-600">{JSON.stringify(v.to)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Metadata</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-auto max-h-40">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
