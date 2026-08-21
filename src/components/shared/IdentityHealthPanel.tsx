import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Hash, Mail, PackageCheck, Pencil, RefreshCw, ScanSearch, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
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
  const [rows, setRows] = useState<Array<ProductIdentityReviewRow | CustomerIdentityReviewRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = entity === "products"
      ? await supabase.from("product_identity_review").select(PRODUCT_COLUMNS).eq("org_id", orgId).order("name")
      : await supabase.from("customer_identity_review").select(CUSTOMER_COLUMNS).eq("org_id", orgId).order("name");
    if (result.error) {
      setError(result.error.message);
      setRows([]);
    } else {
      setRows((result.data ?? []) as Array<ProductIdentityReviewRow | CustomerIdentityReviewRow>);
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      const result = entity === "products"
        ? await supabase.from("product_identity_review").select(PRODUCT_COLUMNS).eq("org_id", orgId).order("name")
        : await supabase.from("customer_identity_review").select(CUSTOMER_COLUMNS).eq("org_id", orgId).order("name");
      if (cancelled) return;
      if (result.error) {
        setError(result.error.message);
        setRows([]);
      } else {
        setRows((result.data ?? []) as Array<ProductIdentityReviewRow | CustomerIdentityReviewRow>);
      }
      setLoading(false);
    };
    run();
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
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={load} disabled={loading} title="Volver a analizar identidad">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
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

          {missingRows.length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Completar identidad</p>
                <span className="text-[10px] text-muted-foreground">{missingRows.length} pendientes</span>
              </div>
              <div className="space-y-1.5">
                {missingRows.slice(0, 6).map(row => {
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
              {missingRows.length > 6 && (
                <p className="mt-2 text-[10px] text-muted-foreground">+{missingRows.length - 6} pendientes más. La lista se ordena por nombre.</p>
              )}
            </div>
          )}

          {summary.examples.length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Candidatos a revisar</p>
              <div className="space-y-1.5">
                {summary.examples.map(example => (
                  <div key={example.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/20 px-2.5 py-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{example.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{example.issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
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
        </>
      )}
    </section>
  );
}
