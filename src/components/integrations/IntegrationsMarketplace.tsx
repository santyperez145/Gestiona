/**
 * Mercado de integraciones del comercio.
 * Lee `merchant_integration_catalog` — sin secretos ni salud inventada.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Cable, Loader2, Search, ShoppingBag, Truck, Wallet,
  Database, MessageSquare, Code2, Server, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  filterMerchantCatalog,
  merchantIntegrationCta,
  MERCHANT_CATEGORY_LABEL,
  MERCHANT_LIFECYCLE_LABEL,
  type MerchantIntegrationRow,
} from "@/lib/merchantIntegrationCatalog";
import { isMissingRelation } from "@/lib/publicDataSource";

const CATEGORY_ICON: Record<string, typeof Cable> = {
  payments: Wallet,
  shipping: Truck,
  commerce: ShoppingBag,
  tax: Database,
  messaging: MessageSquare,
  automation: Code2,
  platform: Server,
};

const LIFECYCLE_CLASS: Record<string, string> = {
  production: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  beta: "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-300",
  needs_setup: "bg-amber-500/10 text-amber-800 border-amber-500/25 dark:text-amber-300",
  needs_contract: "bg-orange-500/10 text-orange-800 border-orange-500/25 dark:text-orange-300",
  planned: "bg-muted text-muted-foreground border-border",
};

export default function IntegrationsMarketplace() {
  const [rows, setRows] = useState<MerchantIntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("merchant_integration_catalog" as never)
      .select(
        "integration_key,display_name,category,connection_mode,lifecycle,description,capabilities,requires_contract,sort_order",
      )
      .order("sort_order", { ascending: true });

    if (qErr) {
      if (isMissingRelation(qErr)) {
        setError("El catálogo de integraciones todavía no está aplicado en esta base.");
      } else {
        console.error("No se pudo leer merchant_integration_catalog", qErr);
        setError("No se pudo cargar el mercado de integraciones.");
      }
      setRows([]);
    } else {
      setRows((data || []) as unknown as MerchantIntegrationRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    const keys = [...new Set(rows.map((r) => r.category))];
    return keys.sort((a, b) =>
      (MERCHANT_CATEGORY_LABEL[a] || a).localeCompare(MERCHANT_CATEGORY_LABEL[b] || b, "es"),
    );
  }, [rows]);

  const filtered = useMemo(
    () => filterMerchantCatalog(rows, { category, query }),
    [rows, category, query],
  );

  const shippingReady = filtered.filter(
    (r) => r.category === "shipping" && r.lifecycle === "production",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Cable className="w-4 h-4 text-primary" />
            Mercado de integraciones
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Como en Tiendanube Aplicaciones: descubrí cobros, envíos y canales.
            El estado es de producto — no inventa una conexión ni una API de correo sin contrato.
          </p>
          {shippingReady > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Envíos listos hoy: tarifario por provincia y etiqueta imprimible. Correo / Andreani / OCA piden contrato.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => { void load(); }} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Actualizar"}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder="Buscar (Andreani, Mercado Pago, envíos…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Button
            type="button"
            size="sm"
            variant={category === "all" ? "default" : "outline"}
            className="shrink-0 h-9"
            onClick={() => setCategory("all")}
          >
            Todas
          </Button>
          {categories.map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={category === c ? "default" : "outline"}
              className="shrink-0 h-9"
              onClick={() => setCategory(c)}
            >
              {MERCHANT_CATEGORY_LABEL[c] || c}
            </Button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando catálogo…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-[10px] border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No hay integraciones con ese filtro.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => {
            const Icon = CATEGORY_ICON[row.category] || Cable;
            const cta = merchantIntegrationCta(row);
            return (
              <article
                key={row.integration_key}
                className="rounded-[10px] border border-border/60 bg-card p-4 flex flex-col gap-3 shadow-card"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-md border border-border/60 bg-muted/40 p-2">
                    <Icon className="w-4 h-4 text-primary" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-sm font-semibold truncate">{row.display_name}</h3>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${LIFECYCLE_CLASS[row.lifecycle] || LIFECYCLE_CLASS.planned}`}
                      >
                        {MERCHANT_LIFECYCLE_LABEL[row.lifecycle] || row.lifecycle}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {MERCHANT_CATEGORY_LABEL[row.category] || row.category}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {row.description}
                </p>
                {(row.capabilities?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {row.capabilities!.slice(0, 4).map((cap) => (
                      <span
                        key={cap}
                        className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {cap.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                )}
                {cta.href ? (
                  <Button asChild size="sm" className="w-full sm:w-auto">
                    <Link to={cta.href}>
                      {cta.label}
                      <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                    </Link>
                  </Button>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{cta.label}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
