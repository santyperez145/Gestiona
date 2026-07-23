/**
 * InvoiceOCRModal — "Escanear factura" modal for Purchase Orders.
 *
 * Ported from the former standalone DocumentOCRPage (`/ocr-facturas`, now removed).
 * Lets the user drag & drop or upload an invoice/receipt image or PDF, tracks its
 * OCR status (`ocr_documents` table) and, once extraction completes, shows the
 * extracted fields + line items with a "Usar estos datos" action that prefills a
 * new Purchase Order via the `onUseData` callback.
 */
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ScanLine, Upload, FileText, CheckCircle2, XCircle,
  RefreshCw, Download, Trash2, AlertTriangle, Sparkles,
  Building2, Calendar, DollarSign, ChevronDown, ChevronUp,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-400 border-0",
  reviewed: "bg-blue-500/15 text-blue-400 border-0",
  processing: "bg-yellow-500/15 text-yellow-400 border-0",
  pending: "bg-zinc-500/15 text-zinc-400 border-0",
  failed: "bg-red-500/15 text-red-400 border-0",
};

export interface OCRPrefillItem {
  product_name: string;
  sku: string | null;
  quantity_ordered: number;
  unit_cost: number;
  tax_rate: number;
}

export interface OCRPrefillData {
  supplierName: string;
  items: OCRPrefillItem[];
}

function mapDoc(d: any) {
  return {
    id: d.id,
    filename: d.filename,
    status: d.ocr_status,
    confidence: d.confidence,
    created_at: (d.created_at || "").slice(0, 16).replace("T", " "),
    extracted: (d.ocr_status === "completed" || d.ocr_status === "reviewed") && d.extracted_data && Object.keys(d.extracted_data).length > 0
      ? d.extracted_data
      : null,
    items: (d.ocr_line_items || []).map((i: any) => ({
      description: i.description,
      qty: i.quantity,
      unit_price: i.unit_price,
      total: i.total_price,
    })),
    error: d.error_message,
  };
}

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "text-emerald-400" : pct >= 65 ? "text-yellow-400" : "text-red-400";
  return <span className={`text-xs font-semibold ${color}`}>{pct}% confianza</span>;
}

interface InvoiceOCRModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseData: (data: OCRPrefillData) => void;
}

export default function InvoiceOCRModal({ open, onOpenChange, onUseData }: InvoiceOCRModalProps) {
  const { orgId } = useOrganization();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orgId) return;
    supabase
      .from("ocr_documents")
      .select("*, ocr_line_items(*)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) { toast.error("Error cargando documentos OCR"); return; }
        setDocs((data ?? []).map(mapDoc));
      });
  }, [open, orgId]);

  const processFiles = async (files: File[]) => {
    if (!orgId || !user) return;
    setUploading(true);
    for (const file of files) {
      const path = `${orgId}/ocr/${Date.now()}-${file.name}`;
      const { error: storageErr } = await supabase.storage.from("documents").upload(path, file, { upsert: false });
      if (storageErr) { toast.error(`Error subiendo ${file.name}`); continue; }
      const { data: url } = supabase.storage.from("documents").getPublicUrl(path);
      await supabase.from("ocr_documents").insert({
        org_id: orgId, uploaded_by: user.id, filename: file.name,
        file_url: url.publicUrl, file_size: file.size,
        mime_type: file.type || "application/pdf",
        ocr_status: "pending", ocr_provider: "google_vision",
      });
      const newDoc: any = {
        id: Date.now().toString(), filename: file.name,
        status: "processing", confidence: null,
        created_at: new Date().toISOString().slice(0, 16).replace("T", " "),
        extracted: null, items: [],
      };
      setDocs(prev => [newDoc, ...prev]);
    }
    setUploading(false);
    toast.info("Procesando documento con OCR...");
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) await processFiles(files);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await processFiles(files);
    e.target.value = "";
  };

  const handleUseData = (doc: any) => {
    if (!doc.extracted) return;
    const items: OCRPrefillItem[] = (doc.items ?? []).map((i: any) => ({
      product_name: i.description ?? "Ítem escaneado",
      sku: null,
      quantity_ordered: i.qty || 1,
      unit_cost: i.unit_price || 0,
      tax_rate: 21,
    }));
    onUseData({
      supplierName: doc.extracted.supplier ?? "",
      items: items.length > 0 ? items : [{
        product_name: "Ítem escaneado",
        sku: null,
        quantity_ordered: 1,
        unit_cost: doc.extracted.total ?? 0,
        tax_rate: 21,
      }],
    });
    toast.success("Datos cargados — revisá y guardá la orden de compra");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-primary" />Escanear factura
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Subí una foto o PDF de la factura del proveedor. Una vez procesada, podés usar los datos extraídos para prellenar una nueva orden de compra.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dragging ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40 hover:bg-primary/3"}`}
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Upload className={`w-5 h-5 ${dragging ? "text-primary animate-bounce" : "text-primary/60"}`} />
            </div>
            <p className="text-sm font-semibold">{dragging ? "Soltá para subir" : uploading ? "Subiendo…" : "Arrastrá una factura acá o hacé clic"}</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — hasta 10 MB</p>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFileInput} disabled={uploading} />
          </div>

          {/* Documents list */}
          <div className="space-y-2">
            {docs.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Sin documentos escaneados aún</p>
            )}
            {docs.map(doc => (
              <div key={doc.id} className="bg-card border border-border/40 rounded-xl overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    {doc.status === "processing" || doc.status === "pending"
                      ? <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                      : doc.status === "failed"
                      ? <XCircle className="w-3.5 h-3.5 text-red-400" />
                      : <FileText className="w-3.5 h-3.5 text-primary" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{doc.created_at}</span>
                      {doc.extracted && <ConfidenceBadge value={doc.confidence} />}
                    </div>
                  </div>
                  <Badge className={`text-xs ${STATUS_COLORS[doc.status] || "bg-muted text-muted-foreground border-0"}`}>
                    {doc.status}
                  </Badge>
                  {expandedId === doc.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>

                {expandedId === doc.id && (
                  <div className="border-t border-border/40 p-4 space-y-3">
                    {doc.status === "failed" && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">{doc.error || "Error en procesamiento OCR"}</p>
                      </div>
                    )}

                    {doc.extracted && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-muted/30 rounded-lg p-2.5 flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Proveedor</p>
                              <p className="text-xs font-semibold">{doc.extracted.supplier}</p>
                            </div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2.5 flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Fecha</p>
                              <p className="text-xs font-semibold">{doc.extracted.date}</p>
                            </div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2.5 flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Nro. Factura</p>
                              <p className="text-xs font-semibold">{doc.extracted.invoice_number || "—"}</p>
                            </div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-2.5 flex items-center gap-2">
                            <DollarSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-[10px] text-muted-foreground">Total</p>
                              <p className="text-xs font-semibold">${(doc.extracted.total ?? 0).toLocaleString("es-AR")}</p>
                            </div>
                          </div>
                        </div>

                        {doc.items.length > 0 && (
                          <div className="bg-muted/20 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border/40">
                                  <th className="text-left px-3 py-2 text-muted-foreground">Descripción</th>
                                  <th className="text-right px-3 py-2 text-muted-foreground">Cant.</th>
                                  <th className="text-right px-3 py-2 text-muted-foreground">P. Unit.</th>
                                  <th className="text-right px-3 py-2 text-muted-foreground">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {doc.items.map((item: any, i: number) => (
                                  <tr key={i} className="border-b border-border/20 last:border-0">
                                    <td className="px-3 py-2">{item.description}</td>
                                    <td className="px-3 py-2 text-right">{item.qty}</td>
                                    <td className="px-3 py-2 text-right">${(item.unit_price ?? 0).toLocaleString("es-AR")}</td>
                                    <td className="px-3 py-2 text-right font-semibold">${(item.total ?? 0).toLocaleString("es-AR")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleUseData(doc)} className="gradient-gold text-primary-foreground h-7 text-xs gap-1">
                            <Sparkles className="w-3 h-3" />Usar estos datos
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-400 border-red-400/30 hover:bg-red-400/10"
                            onClick={async () => {
                              setDocs(prev => prev.filter(d => d.id !== doc.id));
                              await supabase.from("ocr_documents").delete().eq("id", doc.id);
                              toast.success("Documento eliminado");
                            }}>
                            <Trash2 className="w-3 h-3" />Eliminar
                          </Button>
                        </div>
                      </div>
                    )}

                    {(doc.status === "processing" || doc.status === "pending") && (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                        <span>Analizando documento con IA...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
