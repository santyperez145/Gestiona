import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Hash, Mail, PackageCheck, Pencil, RefreshCw, ScanSearch, Search, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { buildIdentityReviewCsv, identityReviewFilename } from "@/lib/identityExport";
import {
  normalizeIdentityText,
  summarizeCustomerIdentity,
  summarizeProductIdentity,
  missingCustomerIdentityRows,
  missingProductIdentityRows,
  type CustomerIdentityReviewRow,
  type ProductIdentityReviewRow,
  type IdentityReviewSummary,
} from "@/lib/recordIdentity";

type Entity = "products" | "customers";

const PRODUCT_COLUMNS = "id,org_id,name,brand,sku,barcode,sku_key,barcode_key,name_brand_key,sku_match_count,barcode_match_count,name_brand_match_count,exact_conflict,review_required,identity_issue";
const CUSTOMER_COLUMNS = "id,org_id,name,email,phone,whatsapp_number,name_key,email_key,phone_key,whatsapp_key,name_match_count,email_match_count,phone_match_count,whatsapp_match_count,exact_conflict,review_required,missing_contact,identity_issue";

type IdentityReviewRow = ProductIdentityReviewRow | CustomerIdentityReviewRow;

async function fetchIdentityRows(entity: Entity, orgId: string): Promise<{ data: IdentityReviewRow[] | null; error: Error | null }> {
  const result = entity === "products"
    ? await supabase.from("product_identity_review").select(PRODUCT_COLUMNS).eq("org_id", orgId).order("name")
    : await supabase.from("customer_identity_review").select(CUSTOMER_COLUMNS).eq("org_id", orgId).order("name");

  return {
    data: result.error ? null : (result.data ?? []) as IdentityReviewRow[],
    error: result.error,
  };
}

interface IdentityHealthPanelProps {
  entity: Entity;
  orgId: string;
  onOpenProduct?: (id: string) => void;
  onOpenCustomer?: (id: string) => void;
}

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string | number; hint: string; icon: typeof Hash }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />{label}
      </div>
      <p className="mt-1 text-xl font-display font-bold text-foreground">{value}</p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function IdentityHealthPanel({ entity, orgId, onOpenProduct, onOpenCustomer }: IdentityHealthPanelProps) {
  const [rows, setRows] = useState<IdentityReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [queueSearch, setQueueSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchIdentityRows(entity, orgId);
    if (result.error) {
      setError(result.error.message);
      setRows([]);
    } else {
      setRows(result.data ?? []);
    }
    setLoading(false);
  }, [entity, orgId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIdentityRows(entity, orgId).then(result => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error.message);
        setRows([]);
      } else {
        setRows(result.data ?? []);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [entity, orgId]);

  const summary: IdentityReviewSummary = useMemo(
    () => entity === "products"
      ? summarizeProductIdentity(rows as ProductIdentityReviewRow[])
      : summarizeCustomerIdentity(rows as CustomerIdentityReviewRow[]),
    [entity, rows],
  );
  const isProduct = entity === "products";
  const missingRows = useMemo(
    () => isProduct
      ? missingProductIdentityRows(rows as ProductIdentityReviewRow[])
      : missingCustomerIdentityRows(rows as CustomerIdentityReviewRow[]),
    [isProduct, rows],
  );
  const openRecord = isProduct ? onOpenProduct : onOpenCustomer;
  const identityCovered = summary.reviewRows === 0 && summary.missingPrimaryRows === 0;
  const normalizedQueueSearch = normalizeIdentityText(queueSearch) ?? "";
  const filteredMissingRows = useMemo(() => {
    if (!normalizedQueueSearch) return missingRows;
    return missingRows.filter(row => {
      const text = isProduct
        ? `${(row as ProductIdentityReviewRow).brand} ${(row as ProductIdentityReviewRow).name} ${(row as ProductIdentityReviewRow).sku ?? ""} ${(row as ProductIdentityReviewRow).barcode ?? ""}`
        : `${(row as CustomerIdentityReviewRow).name} ${(row as CustomerIdentityReviewRow).email ?? ""} ${(row as CustomerIdentityReviewRow).phone ?? ""} ${(row as CustomerIdentityReviewRow).whatsapp_number ?? ""}`;
      return (normalizeIdentityText(text) ?? "").includes(normalizedQueueSearch);
    });
  }, [isProduct, missingRows, normalizedQueueSearch]);
  const filteredExamples = useMemo(() => {
    if (!normalizedQueueSearch) return summary.examples;
    return summary.examples.filter(example =>
      (normalizeIdentityText(`${example.label} ${example.issue}`) ?? "").includes(normalizedQueueSearch));
  }, [normalizedQueueSearch, summary.examples]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const csv = buildIdentityReviewCsv(entity, rows);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = identityReviewFilename(entity);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };
  const title = isProduct ? "Identidad del catálogo" : "Identidad de clientes";
  const description = isProduct
    ? "SKU y EAN son la llave entre POS, tienda e integraciones. Los nombres sólo generan candidatos, nunca fusiones automáticas."
    : "Email y teléfono orientan la identidad; un nombre compartido puede ser una homonimia y siempre requiere revisión humana.";

  return (
    <section className="rounded-[10px] border border-border/60 bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
            <ScanSearch className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-display font-semibold">{title}</h2>
              {!loading && !error && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${identityCovered ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-amber-500/25 bg-amber-500/10 text-amber-400"}`}>
                  {identityCovered ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {summary.reviewRows > 0
                    ? `${summary.reviewRows} filas para revisar`
                    : identityCovered
                      ? "Identidad cubierta"
                      : `${summary.missingPrimaryRows} fichas incompletas`}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-[11px]" onClick={exportCsv} disabled={loading || !!error || rows.length === 0} title="Descargar este reporte como CSV">
            <Download className="h-3.5 w-3.5" />CSV
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} disabled={loading} title="Volver a analizar identidad">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-muted/30" />
      ) : error ? (
        <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
          No se pudo leer el reporte de identidad. La pantalla no va a inferir que no hay duplicados: {error}
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Registros" value={summary.total} hint="En esta organización" icon={isProduct ? PackageCheck : UsersRound} />
            <Metric label="Cobertura" value={`${summary.coveragePercent}%`} hint={isProduct ? `${summary.identifiedRows} con SKU o EAN` : `${summary.identifiedRows} con contacto fuerte`} icon={isProduct ? Hash : Mail} />
            <Metric label="Conflictos" value={summary.exactConflictRows} hint="Coincidencia de identificador" icon={ShieldCheck} />
            <Metric label="Faltantes" value={summary.missingPrimaryRows} hint={isProduct ? "Sin SKU ni EAN" : "Sin email, teléfono o WhatsApp"} icon={AlertTriangle} />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="h-8">
              <TabsTrigger value="summary" className="px-3 pb-2 pt-1 text-[10px]">Resumen</TabsTrigger>
              <TabsTrigger value="pending" className="gap-1 px-3 pb-2 pt-1 text-[10px]">
                Pendientes <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400">{missingRows.length}</span>
              </TabsTrigger>
              <TabsTrigger value="candidates" className="gap-1 px-3 pb-2 pt-1 text-[10px]">
                Candidatos <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px]">{summary.reviewRows}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-3">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {summary.reviewRows === 0
                  ? isProduct && summary.missingPrimaryRows > 0
                    ? "No hay colisiones, pero el catálogo todavía no tiene una llave portable. Completar SKU/EAN es el siguiente paso antes de sincronizar canales."
                    : isProduct
                      ? "La identidad está cubierta y no hay colisiones exactas en el reporte actual."
                      : summary.missingPrimaryRows > 0
                        ? "No se detectaron colisiones exactas. Los registros sin contacto siguen siendo deuda de calidad, no duplicados."
                        : "La identidad está cubierta y no hay colisiones exactas en el reporte actual."
                  : "Este reporte sólo propone revisión. No modifica filas ni habilita fusiones automáticas."}
              </p>
            </TabsContent>

            <TabsContent value="pending" className="mt-3">
              {missingRows.length === 0 ? (
                <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">No hay fichas incompletas en el reporte actual.</p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={queueSearch} onChange={event => setQueueSearch(event.target.value)} placeholder={isProduct ? "Buscar producto, SKU o EAN" : "Buscar cliente o contacto"} className="h-8 pl-8 text-xs" />
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{filteredMissingRows.length}/{missingRows.length}</span>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {filteredMissingRows.length === 0 ? (
                    <p className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">No hay coincidencias para esa búsqueda.</p>
                  ) : filteredMissingRows.map(row => {
                    const label = isProduct
                      ? `${(row as ProductIdentityReviewRow).brand} · ${(row as ProductIdentityReviewRow).name}`
                      : (row as CustomerIdentityReviewRow).name;
                    const action = openRecord ? () => openRecord(row.id) : undefined;
                    return (
                      <div key={row.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/20 px-2.5 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{label}</p>
                          <p className="text-[10px] text-muted-foreground">{isProduct ? "Falta SKU y EAN" : "Falta un dato de contacto fuerte"}</p>
                        </div>
                        {action && (
                          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]" onClick={action}>
                            <Pencil className="h-3 w-3" />Completar
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="candidates" className="mt-3">
              {summary.examples.length === 0 ? (
                <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">No hay candidatos para revisar en el reporte actual.</p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={queueSearch} onChange={event => setQueueSearch(event.target.value)} placeholder="Buscar candidato o motivo" className="h-8 pl-8 text-xs" />
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{filteredExamples.length}/{summary.examples.length}</span>
                  </div>
                  <div className="space-y-1.5">
                  {filteredExamples.length === 0 ? (
                    <p className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">No hay coincidencias para esa búsqueda.</p>
                  ) : filteredExamples.map(example => (
                    <div key={example.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/20 px-2.5 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{example.label}</p>
                        <p className="text-[10px] text-muted-foreground">{example.issue}</p>
                      </div>
                      {openRecord && (
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]" onClick={() => openRecord(example.id)}>
                          <Pencil className="h-3 w-3" />Revisar
                        </Button>
                      )}
                    </div>
                  ))}
                  </div>
                </>
              )}
              {summary.reviewRows > summary.examples.length && (
                <p className="mt-2 text-[10px] text-muted-foreground">Se muestran los primeros {summary.examples.length} candidatos para mantener la pantalla compacta.</p>
              )}
            </TabsContent>
          </Tabs>

        </>
      )}
    </section>
  );
}
