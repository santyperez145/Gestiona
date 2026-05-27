import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  FileText, CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw,
  Settings, BarChart3, Plus, Search, Download, Eye, QrCode, Shield,
  Building2, Zap, TrendingUp, ChevronDown, ChevronUp
} from "lucide-react";

// AFIP tipo comprobante names
const TIPO_CBTE: Record<number, string> = {
  1:  "Factura A", 2: "Nota Déb. A", 3: "Nota Créd. A",
  6:  "Factura B", 7: "Nota Déb. B", 8: "Nota Créd. B",
  11: "Factura C", 12: "Nota Déb. C", 13: "Nota Créd. C",
  51: "Factura M", 81: "Tique Factura A", 82: "Tique Factura B",
};

const ALICUOTAS = [0, 2.5, 5, 10.5, 21, 27];

const STATUS_COLORS: Record<string, string> = {
  authorized: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  rejected:   "bg-red-500/15 text-red-400 border-red-500/20",
  pending:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  cancelled:  "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-emerald-400", A: "text-green-400", B: "text-blue-400",
  C: "text-yellow-400", D: "text-orange-400", F: "text-red-400",
};

// Mock comprobantes for demo
const MOCK_CBTES = [
  { id: "1", tipo_cbte: 6, punto_venta: 1, nro_cbte: 42, fecha_cbte: "2026-05-26", nro_doc: "20304050607", imp_total: 48400, cae: "74234567890123", status: "authorized", imp_neto: 40000, imp_iva: 8400 },
  { id: "2", tipo_cbte: 6, punto_venta: 1, nro_cbte: 43, fecha_cbte: "2026-05-26", nro_doc: "27111222333", imp_total: 12100, cae: "74234567890124", status: "authorized", imp_neto: 10000, imp_iva: 2100 },
  { id: "3", tipo_cbte: 11, punto_venta: 1, nro_cbte: 12, fecha_cbte: "2026-05-27", nro_doc: "0", imp_total: 7260, cae: null, status: "pending", imp_neto: 6000, imp_iva: 1260 },
  { id: "4", tipo_cbte: 1, punto_venta: 1, nro_cbte: 8, fecha_cbte: "2026-05-25", nro_doc: "30123456789", imp_total: 242000, cae: "74234567890120", status: "authorized", imp_neto: 200000, imp_iva: 42000 },
  { id: "5", tipo_cbte: 6, punto_venta: 1, nro_cbte: 44, fecha_cbte: "2026-05-27", nro_doc: "20987654321", imp_total: 5500, cae: null, status: "rejected", imp_neto: 4545.45, imp_iva: 954.55 },
];

const MOCK_STATS = [
  { day: "2026-05-27", total: 5, authorized: 3, rejected: 1, pending: 1, total_amount: 315260 },
  { day: "2026-05-26", total: 12, authorized: 11, rejected: 0, pending: 1, total_amount: 890500 },
  { day: "2026-05-25", total: 9, authorized: 9, rejected: 0, pending: 0, total_amount: 545000 },
  { day: "2026-05-24", total: 7, authorized: 6, rejected: 1, pending: 0, total_amount: 420000 },
  { day: "2026-05-23", total: 14, authorized: 13, rejected: 0, pending: 1, total_amount: 1100000 },
];

function StatCard({ icon: Icon, label, value, sub, color = "text-primary" }: any) {
  return (
    <div className="bg-card border border-border/40 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold font-display">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AFIPPage() {
  const { orgId } = useOrganization();
  const { user } = useAuth();
  const [tab, setTab] = useState<"comprobantes" | "config" | "stats" | "padron">("comprobantes");
  const [config, setConfig] = useState<any>(null);
  const [cbtes, setCbtes] = useState<any[]>(MOCK_CBTES);
  const [stats, setStats] = useState<any[]>(MOCK_STATS);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [padronCuit, setPadronCuit] = useState("");
  const [padronResult, setPadronResult] = useState<any>(null);
  const [padronLoading, setPadronLoading] = useState(false);
  const [configForm, setConfigForm] = useState({
    cuit: "", razon_social: "", punto_venta: "1",
    ambiente: "homologacion", is_active: false,
  });
  const [newCbte, setNewCbte] = useState({
    tipo_cbte: "6", nro_doc: "", imp_neto: "", alicuota: "21",
  });

  useEffect(() => {
    if (!orgId) return;
    supabase.from("afip_config").select("*").eq("org_id", orgId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setConfig(data);
          setConfigForm({ cuit: data.cuit, razon_social: data.razon_social, punto_venta: String(data.punto_venta), ambiente: data.ambiente, is_active: data.is_active });
        }
      });
  }, [orgId]);

  const saveConfig = async () => {
    if (!orgId) return;
    setLoading(true);
    const row = { org_id: orgId, cuit: configForm.cuit, razon_social: configForm.razon_social, punto_venta: Number(configForm.punto_venta), ambiente: configForm.ambiente, is_active: configForm.is_active };
    const { error } = await supabase.from("afip_config").upsert(row, { onConflict: "org_id" });
    setLoading(false);
    if (error) { toast.error("Error al guardar config"); return; }
    toast.success("Configuración AFIP guardada");
    setConfig(row);
  };

  const emitirComprobante = () => {
    const iva = (parseFloat(newCbte.imp_neto) * parseFloat(newCbte.alicuota)) / 100;
    const total = parseFloat(newCbte.imp_neto) + iva;
    const nuevo = {
      id: Date.now().toString(),
      tipo_cbte: Number(newCbte.tipo_cbte),
      punto_venta: Number(configForm.punto_venta) || 1,
      nro_cbte: cbtes.filter(c => c.tipo_cbte === Number(newCbte.tipo_cbte)).length + 45,
      fecha_cbte: new Date().toISOString().slice(0, 10),
      nro_doc: newCbte.nro_doc || "0",
      imp_neto: parseFloat(newCbte.imp_neto),
      imp_iva: iva,
      imp_total: total,
      cae: null,
      status: "pending",
    };
    setCbtes(prev => [nuevo, ...prev]);
    setShowNewDialog(false);
    setNewCbte({ tipo_cbte: "6", nro_doc: "", imp_neto: "", alicuota: "21" });
    // Simulate AFIP authorization after 2s
    setTimeout(() => {
      setCbtes(prev => prev.map(c => c.id === nuevo.id
        ? { ...c, cae: "74" + Math.random().toString().slice(2, 16), status: "authorized" }
        : c));
      toast.success("CAE obtenido correctamente");
    }, 2000);
    toast.info("Enviando a AFIP...");
  };

  const consultarPadron = async () => {
    if (!padronCuit || padronCuit.length < 11) { toast.error("CUIT inválido"); return; }
    setPadronLoading(true);
    // Mock padron response
    await new Promise(r => setTimeout(r, 1000));
    setPadronResult({
      cuit: padronCuit,
      razon_social: "EMPRESA DE PRUEBA SRL",
      tipo_persona: "JURIDICA",
      estado: "ACTIVO",
      actividades: [{ codigo: 4711, descripcion: "Venta al por menor en supermercados y minimercados" }],
      categorias_iva: [{ descripcion: "Responsable Inscripto" }],
    });
    setPadronLoading(false);
  };

  const filtered = cbtes.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.nro_doc.includes(q) || TIPO_CBTE[c.tipo_cbte]?.toLowerCase().includes(q) || (c.cae || "").includes(q);
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalsToday = cbtes.reduce((acc, c) => {
    acc.total++;
    acc[c.status] = (acc[c.status] || 0) + 1;
    if (c.status === "authorized") acc.amount += c.imp_total;
    return acc;
  }, { total: 0, authorized: 0, rejected: 0, pending: 0, amount: 0 } as any);

  const TABS = [
    { id: "comprobantes", label: "Comprobantes" },
    { id: "config", label: "Configuración" },
    { id: "stats", label: "Estadísticas" },
    { id: "padron", label: "Consulta Padrón" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-blue-400" />
            </div>
            <h1 className="text-2xl font-display font-bold">AFIP / Facturación Electrónica</h1>
          </div>
          <p className="text-sm text-muted-foreground">Emisión de comprobantes electrónicos — conexión con AFIP WSFE</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={config?.is_active ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"}>
            {config?.is_active ? "● Activo" : "○ Inactivo"} — {config?.ambiente || "homologacion"}
          </Badge>
          <Button size="sm" onClick={() => setShowNewDialog(true)} className="gap-1.5 gradient-gold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" /> Emitir Comprobante
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total hoy" value={totalsToday.total} sub="comprobantes" />
        <StatCard icon={CheckCircle2} label="Autorizados" value={totalsToday.authorized} color="text-emerald-400" sub={`${totalsToday.total ? Math.round((totalsToday.authorized / totalsToday.total) * 100) : 0}% tasa`} />
        <StatCard icon={XCircle} label="Rechazados" value={totalsToday.rejected} color="text-red-400" />
        <StatCard icon={TrendingUp} label="Facturado" value={`$${(totalsToday.amount / 1000).toFixed(0)}K`} color="text-primary" sub="autorizados" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Comprobantes tab ─── */}
      {tab === "comprobantes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Buscar por CUIT, CAE, tipo..." className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {[null, "authorized", "pending", "rejected"].map(s => (
                <button key={s ?? "all"} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${statusFilter === s ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground hover:border-border"}`}>
                  {s === null ? "Todos" : s === "authorized" ? "Autorizados" : s === "pending" ? "Pendientes" : "Rechazados"}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Tipo", "Nro", "Fecha", "CUIT/Doc", "Neto", "IVA", "Total", "CAE", "Estado", ""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <>
                      <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium text-xs">{TIPO_CBTE[c.tipo_cbte] || `Tipo ${c.tipo_cbte}`}</td>
                        <td className="px-4 py-3 font-mono text-xs">{String(c.punto_venta).padStart(4, "0")}-{String(c.nro_cbte).padStart(8, "0")}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c.fecha_cbte}</td>
                        <td className="px-4 py-3 font-mono text-xs">{c.nro_doc === "0" ? "Cons. Final" : c.nro_doc}</td>
                        <td className="px-4 py-3 text-xs">${c.imp_neto.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">${c.imp_iva.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-semibold text-xs">${c.imp_total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.cae ? c.cae.slice(0, 8) + "…" : "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${STATUS_COLORS[c.status]}`}>
                            {c.status === "authorized" ? "✓ Autorizado" : c.status === "rejected" ? "✗ Rechazado" : c.status === "pending" ? "⏳ Pendiente" : "Cancelado"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                            {expandedId === c.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                      {expandedId === c.id && (
                        <tr key={c.id + "-exp"} className="bg-muted/10 border-b border-border/20">
                          <td colSpan={10} className="px-6 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              <div><span className="text-muted-foreground">CAE completo</span><p className="font-mono mt-0.5">{c.cae || "—"}</p></div>
                              <div><span className="text-muted-foreground">Imp. Neto</span><p className="mt-0.5">${c.imp_neto.toLocaleString("es-AR")}</p></div>
                              <div><span className="text-muted-foreground">IVA (21%)</span><p className="mt-0.5">${c.imp_iva.toLocaleString("es-AR")}</p></div>
                              <div className="flex gap-2 items-end">
                                {c.cae && <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><QrCode className="w-3 h-3" />QR</Button>}
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"><Download className="w-3 h-3" />PDF</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">No hay comprobantes</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Config tab ─── */}
      {tab === "config" && (
        <div className="max-w-xl space-y-5">
          <div className="bg-card border border-border/40 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Datos del Contribuyente</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">CUIT (sin guiones)</label>
                <Input value={configForm.cuit} onChange={e => setConfigForm(p => ({ ...p, cuit: e.target.value }))} placeholder="20304050607" className="h-9" maxLength={11} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Razón Social</label>
                <Input value={configForm.razon_social} onChange={e => setConfigForm(p => ({ ...p, razon_social: e.target.value }))} placeholder="MI EMPRESA SRL" className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Punto de Venta</label>
                  <Input type="number" value={configForm.punto_venta} onChange={e => setConfigForm(p => ({ ...p, punto_venta: e.target.value }))} className="h-9" min={1} max={9999} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Ambiente</label>
                  <select value={configForm.ambiente} onChange={e => setConfigForm(p => ({ ...p, ambiente: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="homologacion">Homologación (testing)</option>
                    <option value="produccion">Producción</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <div className="flex items-center gap-2">
                <button onClick={() => setConfigForm(p => ({ ...p, is_active: !p.is_active }))}
                  className={`w-10 h-5 rounded-full transition-all ${configForm.is_active ? "bg-emerald-500" : "bg-muted"}`}>
                  <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${configForm.is_active ? "translate-x-5" : "translate-x-0"}`} />
                </button>
                <span className="text-sm">{configForm.is_active ? "Activo" : "Inactivo"}</span>
              </div>
              <Button onClick={saveConfig} disabled={loading} className="gradient-gold text-primary-foreground">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Guardar Configuración"}
              </Button>
            </div>
          </div>

          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-yellow-400">Certificados WSFE</p>
                <p>Para producción necesitás subir tu certificado (.pem) y clave privada (.key) generados en el portal AFIP. En homologación se usa el certificado de prueba automáticamente.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Stats tab ─── */}
      {tab === "stats" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Estadísticas por día (últimos 30 días)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Día", "Total", "Autorizados", "Rechazados", "Pendientes", "Tasa Auth.", "Monto Total"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map(s => (
                    <tr key={s.day} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs font-mono">{s.day}</td>
                      <td className="px-4 py-3 text-xs font-semibold">{s.total}</td>
                      <td className="px-4 py-3 text-xs text-emerald-400">{s.authorized}</td>
                      <td className="px-4 py-3 text-xs text-red-400">{s.rejected}</td>
                      <td className="px-4 py-3 text-xs text-yellow-400">{s.pending}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full max-w-[60px]">
                            <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${s.total ? (s.authorized / s.total) * 100 : 0}%` }} />
                          </div>
                          <span>{s.total ? Math.round((s.authorized / s.total) * 100) : 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold">${(s.total_amount / 1000).toFixed(1)}K</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Padron tab ─── */}
      {tab === "padron" && (
        <div className="max-w-lg space-y-4">
          <div className="bg-card border border-border/40 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Search className="w-4 h-4 text-primary" />Consulta Padrón AFIP</h3>
            <p className="text-xs text-muted-foreground">Consultá datos de contribuyentes por CUIT vía ws_sr_padron_a5.</p>
            <div className="flex gap-2">
              <Input value={padronCuit} onChange={e => setPadronCuit(e.target.value.replace(/\D/g, ""))} placeholder="CUIT sin guiones (ej: 20304050607)" className="h-9 flex-1 font-mono" maxLength={11} />
              <Button onClick={consultarPadron} disabled={padronLoading} className="gap-1.5 gradient-gold text-primary-foreground">
                {padronLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Consultar
              </Button>
            </div>
            {padronResult && (
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-xs text-muted-foreground block">CUIT</span><span className="font-mono">{padronResult.cuit}</span></div>
                  <div><span className="text-xs text-muted-foreground block">Estado</span><Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-xs">{padronResult.estado}</Badge></div>
                  <div className="col-span-2"><span className="text-xs text-muted-foreground block">Razón Social</span><span className="font-semibold">{padronResult.razon_social}</span></div>
                  <div><span className="text-xs text-muted-foreground block">Tipo Persona</span><span>{padronResult.tipo_persona}</span></div>
                  <div><span className="text-xs text-muted-foreground block">Categoría IVA</span><span>{padronResult.categorias_iva[0]?.descripcion}</span></div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Actividades</span>
                  {padronResult.actividades.map((a: any, i: number) => (
                    <p key={i} className="text-xs">{a.codigo} — {a.descripcion}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── New Comprobante dialog ─── */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />Emitir Comprobante</h3>
              <button onClick={() => setShowNewDialog(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de Comprobante</label>
                <select value={newCbte.tipo_cbte} onChange={e => setNewCbte(p => ({ ...p, tipo_cbte: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {Object.entries(TIPO_CBTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">CUIT / DNI del receptor</label>
                <Input value={newCbte.nro_doc} onChange={e => setNewCbte(p => ({ ...p, nro_doc: e.target.value }))} placeholder="0 = Consumidor Final" className="h-9 font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Imp. Neto (ARS)</label>
                  <Input type="number" value={newCbte.imp_neto} onChange={e => setNewCbte(p => ({ ...p, imp_neto: e.target.value }))} placeholder="0.00" className="h-9" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Alícuota IVA %</label>
                  <select value={newCbte.alicuota} onChange={e => setNewCbte(p => ({ ...p, alicuota: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {ALICUOTAS.map(a => <option key={a} value={a}>{a}%</option>)}
                  </select>
                </div>
              </div>
              {newCbte.imp_neto && (
                <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Neto</span><span>${parseFloat(newCbte.imp_neto).toLocaleString("es-AR")}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">IVA {newCbte.alicuota}%</span><span>${(parseFloat(newCbte.imp_neto) * parseFloat(newCbte.alicuota) / 100).toLocaleString("es-AR")}</span></div>
                  <div className="flex justify-between font-semibold border-t border-border/40 pt-1"><span>Total</span><span>${(parseFloat(newCbte.imp_neto) * (1 + parseFloat(newCbte.alicuota) / 100)).toLocaleString("es-AR")}</span></div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancelar</Button>
              <Button onClick={emitirComprobante} disabled={!newCbte.imp_neto} className="gradient-gold text-primary-foreground gap-1.5">
                <Zap className="w-3.5 h-3.5" />Emitir y solicitar CAE
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
