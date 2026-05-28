import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  FolderOpen, Plus, FileText, Download, Eye, Archive,
  Search, Tag, Clock, AlertTriangle, ExternalLink, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface DocCategory {
  id: string;
  name: string;
  color: string;
  active: boolean;
}

interface Document {
  id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  doc_type: string;
  file_url: string | null;
  file_name: string | null;
  file_size_kb: number | null;
  version: string;
  status: string;
  access_level: string;
  tags: string[] | null;
  expiry_date: string | null;
  signed_by: string | null;
  uploaded_by_name: string | null;
  view_count: number;
  download_count: number;
  notes: string | null;
  created_at: string;
  document_categories?: { name: string; color: string } | null;
}

const DOC_TYPE_CONFIG: Record<string, { label: string; icon: string }> = {
  contract:    { label: "Contrato",     icon: "📝" },
  invoice:     { label: "Factura",      icon: "🧾" },
  report:      { label: "Informe",      icon: "📊" },
  manual:      { label: "Manual",       icon: "📖" },
  procedure:   { label: "Procedimiento",icon: "📋" },
  certificate: { label: "Certificado",  icon: "🏆" },
  legal:       { label: "Legal",        icon: "⚖️" },
  financial:   { label: "Financiero",   icon: "💰" },
  hr:          { label: "RRHH",         icon: "👥" },
  other:       { label: "Otro",         icon: "📄" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:    { label: "Borrador",  color: "bg-gray-100 text-gray-700" },
  active:   { label: "Activo",    color: "bg-green-100 text-green-800" },
  archived: { label: "Archivado", color: "bg-orange-100 text-orange-800" },
  expired:  { label: "Vencido",   color: "bg-red-100 text-red-800" },
};

const EMPTY_DOC = {
  category_id: "", title: "", description: "", doc_type: "general" as string,
  file_url: "", file_name: "", version: "1.0", status: "active" as string,
  access_level: "org" as string, tags_raw: "", expiry_date: "",
  signed_by: "", uploaded_by_name: "", notes: ""
};

export default function DocumentManagementPage() {
  usePageTitle("Gestión Documental");
  const { orgId } = useOrganization();

  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [documents, setDocuments]   = useState<Document[]>([]);
  const [loading, setLoading]       = useState(true);
  const [seeding, setSeeding]       = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [catFilter, setCatFilter]   = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const [docOpen, setDocOpen]   = useState(false);
  const [docForm, setDocForm]   = useState({ ...EMPTY_DOC });
  const [savingDoc, setSavingDoc] = useState(false);
  const [editDoc, setEditDoc]   = useState<Document | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [catRes, docRes] = await Promise.allSettled([
      supabase.from("document_categories").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("documents").select("*, document_categories(name, color)").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    if (catRes.status === "fulfilled" && catRes.value.data) setCategories(catRes.value.data as DocCategory[]);
    if (docRes.status === "fulfilled" && docRes.value.data) setDocuments(docRes.value.data as Document[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function seedCategories() {
    if (!orgId) return;
    setSeeding(true);
    const { error } = await supabase.rpc("seed_document_categories", { p_org_id: orgId });
    setSeeding(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Categorías de documentos cargadas");
    load();
  }

  async function saveDocument() {
    if (!orgId || !docForm.title.trim()) return toast.error("Ingresá el título del documento");
    setSavingDoc(true);

    const tags = docForm.tags_raw.split(",").map(t => t.trim()).filter(Boolean);
    const payload = {
      org_id: orgId,
      category_id: docForm.category_id || null,
      title: docForm.title.trim(),
      description: docForm.description || null,
      doc_type: docForm.doc_type,
      file_url: docForm.file_url || null,
      file_name: docForm.file_name || null,
      version: docForm.version,
      status: docForm.status,
      access_level: docForm.access_level,
      tags: tags.length > 0 ? tags : null,
      expiry_date: docForm.expiry_date || null,
      signed_by: docForm.signed_by || null,
      uploaded_by_name: docForm.uploaded_by_name || null,
      notes: docForm.notes || null,
    };

    let error;
    if (editDoc) {
      ({ error } = await supabase.from("documents").update(payload).eq("id", editDoc.id));
    } else {
      ({ error } = await supabase.from("documents").insert(payload));
    }

    setSavingDoc(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editDoc ? "Documento actualizado" : "Documento registrado");
    setDocOpen(false);
    setEditDoc(null);
    setDocForm({ ...EMPTY_DOC });
    load();
  }

  async function archiveDocument(id: string) {
    const { error } = await supabase.from("documents").update({ status: "archived" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Documento archivado");
    load();
  }

  async function logView(doc: Document) {
    await supabase.from("document_access_log").insert({
      document_id: doc.id, org_id: orgId!, action: "view", user_name: "Usuario"
    });
    await supabase.from("documents").update({ view_count: doc.view_count + 1 }).eq("id", doc.id);
  }

  const isExpiringSoon = (dateStr: string | null) => {
    if (!dateStr) return false;
    const days = (new Date(dateStr).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= 0;
  };

  const isExpired = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const filtered = documents.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (catFilter !== "all" && d.category_id !== catFilter) return false;
    if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase()) && !d.description?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const expiringSoon = documents.filter(d => isExpiringSoon(d.expiry_date) && d.status === "active").length;
  const totalActive  = documents.filter(d => d.status === "active").length;
  const totalViews   = documents.reduce((s, d) => s + d.view_count, 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderOpen}
        title="Gestión Documental"
        description="Repositorio centralizado de documentos con control de versiones"
        actions={
          <>
            {categories.length === 0 && (
              <Button variant="outline" onClick={seedCategories} disabled={seeding}>
                {seeding ? "Cargando..." : "Cargar categorías"}
              </Button>
            )}
            <Dialog open={docOpen} onOpenChange={open => { setDocOpen(open); if (!open) { setEditDoc(null); setDocForm({ ...EMPTY_DOC }); } }}>
              <DialogTrigger asChild>
                <Button onClick={() => { setEditDoc(null); setDocForm({ ...EMPTY_DOC }); }}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo documento
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editDoc ? "Editar documento" : "Registrar documento"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Título *</Label>
                  <Input value={docForm.title} onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} placeholder="Nombre del documento" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Categoría</Label>
                    <Select value={docForm.category_id} onValueChange={v => setDocForm(f => ({ ...f, category_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Tipo</Label>
                    <Select value={docForm.doc_type} onValueChange={v => setDocForm(f => ({ ...f, doc_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(DOC_TYPE_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Estado</Label>
                    <Select value={docForm.status} onValueChange={v => setDocForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Borrador</SelectItem>
                        <SelectItem value="active">Activo</SelectItem>
                        <SelectItem value="archived">Archivado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Versión</Label>
                    <Input value={docForm.version} onChange={e => setDocForm(f => ({ ...f, version: e.target.value }))} placeholder="1.0" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>URL del archivo</Label>
                  <Input value={docForm.file_url} onChange={e => setDocForm(f => ({ ...f, file_url: e.target.value }))} placeholder="https://drive.google.com/..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Firmado por</Label>
                    <Input value={docForm.signed_by} onChange={e => setDocForm(f => ({ ...f, signed_by: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Vencimiento</Label>
                    <Input type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Subido por</Label>
                    <Input value={docForm.uploaded_by_name} onChange={e => setDocForm(f => ({ ...f, uploaded_by_name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Acceso</Label>
                    <Select value={docForm.access_level} onValueChange={v => setDocForm(f => ({ ...f, access_level: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="org">Toda la org</SelectItem>
                        <SelectItem value="admin">Solo admin</SelectItem>
                        <SelectItem value="public">Público</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Etiquetas (separadas por coma)</Label>
                  <Input value={docForm.tags_raw} onChange={e => setDocForm(f => ({ ...f, tags_raw: e.target.value }))} placeholder="contrato, cliente, 2026..." />
                </div>
                <div className="space-y-1">
                  <Label>Descripción / Notas</Label>
                  <Textarea value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                </div>
                <Button className="w-full" onClick={saveDocument} disabled={savingDoc}>
                  {savingDoc ? "Guardando..." : editDoc ? "Guardar cambios" : "Registrar documento"}
                </Button>
              </div>
            </DialogContent>
            </Dialog>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total documentos" value={documents.length} icon={FileText} color="primary" />
        <KPICard label="Activos" value={totalActive} icon={FolderOpen} color="success" />
        <KPICard label="Por vencer" value={expiringSoon} icon={AlertTriangle} color="warning" />
        <KPICard label="Vistas totales" value={totalViews} icon={Eye} color="blue" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar por título o descripción..." className="pl-9 h-8" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(DOC_TYPE_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCatFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${catFilter === "all" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200"}`}>
            Todos ({documents.length})
          </button>
          {categories.map(cat => {
            const count = documents.filter(d => d.category_id === cat.id).length;
            return (
              <button key={cat.id} onClick={() => setCatFilter(cat.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${catFilter === cat.id ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200"}`}
                style={catFilter === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}>
                {cat.name} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Document grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay documentos {searchQuery ? `que coincidan con "${searchQuery}"` : "en esta categoría"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(doc => {
            const tc = DOC_TYPE_CONFIG[doc.doc_type] ?? DOC_TYPE_CONFIG.other;
            const sc = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.active;
            const expired = isExpired(doc.expiry_date);
            const expSoon = !expired && isExpiringSoon(doc.expiry_date);

            return (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl">{tc.icon}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">{doc.title}</p>
                        <p className="text-xs text-gray-400">v{doc.version} · {tc.label}</p>
                      </div>
                    </div>
                    <Badge className={`text-xs flex-shrink-0 ${sc.color}`}>{sc.label}</Badge>
                  </div>

                  {doc.document_categories && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: doc.document_categories.color }} />
                      <span className="text-xs text-gray-500">{doc.document_categories.name}</span>
                    </div>
                  )}

                  {doc.description && <p className="text-xs text-gray-500 line-clamp-2">{doc.description}</p>}

                  {/* Tags */}
                  {doc.tags && doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.slice(0, 4).map((tag, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          <Tag className="w-2.5 h-2.5" />{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expiry */}
                  {doc.expiry_date && (
                    <p className={`text-xs flex items-center gap-1 ${expired ? "text-red-600 font-semibold" : expSoon ? "text-orange-600" : "text-gray-400"}`}>
                      {(expired || expSoon) && <AlertTriangle className="w-3 h-3" />}
                      <Clock className="w-3 h-3" />
                      Vence: {new Date(doc.expiry_date).toLocaleDateString("es-AR")}
                      {expired ? " (VENCIDO)" : expSoon ? " (próximo)" : ""}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{doc.view_count}</span>
                      <span className="flex items-center gap-0.5"><Download className="w-3 h-3" />{doc.download_count}</span>
                    </div>
                    <div className="flex gap-1">
                      {doc.file_url && (
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                          onClick={() => logView(doc)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <ExternalLink className="w-3 h-3" /> Abrir
                        </a>
                      )}
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                        onClick={() => { setEditDoc(doc); setDocForm({ category_id: doc.category_id ?? "", title: doc.title, description: doc.description ?? "", doc_type: doc.doc_type, file_url: doc.file_url ?? "", file_name: doc.file_name ?? "", version: doc.version, status: doc.status, access_level: doc.access_level, tags_raw: (doc.tags ?? []).join(", "), expiry_date: doc.expiry_date ?? "", signed_by: doc.signed_by ?? "", uploaded_by_name: doc.uploaded_by_name ?? "", notes: doc.notes ?? "" }); setDocOpen(true); }}>
                        Editar
                      </Button>
                      {doc.status === "active" && (
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-orange-600" onClick={() => archiveDocument(doc.id)}>
                          <Archive className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
