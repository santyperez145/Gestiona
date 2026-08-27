/**
 * Mi plan — la suscripción del comercio al SaaS.
 *
 * ⚠️ No confundir con `/suscripciones`, que es lo contrario: las suscripciones
 * que el comercio le **vende a sus clientes**. Son dos relaciones distintas y
 * comparten vocabulario, que es exactamente por qué esta pantalla es aparte y
 * se llama distinto.
 *
 * El cobro es por MercadoPago con la API de preapproval: el comercio autoriza
 * el débito una vez y MP cobra solo cada período, avisando por webhook. Acá no
 * pasa ninguna tarjeta — se manda al comercio al link de MercadoPago.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatARS } from "@/lib/supabaseStore";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import {
  CreditCard, Check, Loader2, ExternalLink, AlertTriangle, Calendar, Receipt,
} from "lucide-react";

interface PlanContratable {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_ars_monthly: number;
  price_ars_yearly: number | null;
  max_products: number | null;
  max_users: number | null;
  ai_enabled: boolean;
  ahorro_anual_pct: number | null;
  sort_order: number;
}

interface EstadoSuscripcion {
  estado: string;
  provider?: string;
  ciclo?: string;
  renueva_el?: string | null;
  cancela_al_final?: boolean;
  dias_restantes?: number | null;
  plan?: { code: string; name: string; price_ars_monthly: number | null } | null;
  /**
   * Lo que ESTE comercio autorizó en MercadoPago.
   *
   * ⚠️ No es `plan.price_ars_monthly`: ése es el precio de lista, el que paga
   * quien se suscriba hoy. El `preapproval` se creó con el monto del día de la
   * contratación, así que los dos pueden diferir — y mostrarle al comercio el
   * de lista es mostrarle el precio de otro.
   *
   * NULL = no consta. No es lo mismo que gratis.
   */
  precio_ars?: number | null;
}

interface Factura {
  id: string;
  numero: string;
  monto: number;
  estado: string;
  periodo_desde: string;
  periodo_hasta: string;
  pagado_at: string | null;
}

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  active:   { texto: "Activa",           clase: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  trialing: { texto: "Prueba gratuita",  clase: "bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  past_due: { texto: "Pago pendiente",   clase: "bg-destructive/12 text-destructive border-destructive/20" },
  paused:   { texto: "Pausada",          clase: "bg-yellow-500/12 text-yellow-700 dark:text-yellow-400 border-yellow-500/20" },
  canceled: { texto: "Cancelada",        clase: "bg-muted text-muted-foreground border-border" },
  sin_suscripcion: { texto: "Sin plan",  clase: "bg-muted text-muted-foreground border-border" },
};

export default function MiPlanPage() {
  usePageTitle("Mi plan");
  const { activeOrg } = useOrg();

  const [sub, setSub] = useState<EstadoSuscripcion | null>(null);
  const [planes, setPlanes] = useState<PlanContratable[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [ciclo, setCiclo] = useState<"mensual" | "anual">("mensual");
  const [loading, setLoading] = useState(true);
  const [contratando, setContratando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    const [subRes, planRes, facRes] = await Promise.all([
      supabase.rpc("suscripcion_de_organizacion", { p_org: activeOrg.id }),
      supabase.from("planes_contratables").select("*").order("sort_order"),
      supabase.from("saas_invoices")
        .select("id,numero,monto,estado,periodo_desde,periodo_hasta,pagado_at")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false }).limit(12),
    ]);

    if (subRes.error) {
      console.error("suscripcion_de_organizacion", subRes.error);
      toast.error("No pudimos leer tu plan");
    } else {
      setSub(subRes.data as unknown as EstadoSuscripcion);
    }

    setPlanes((planRes.data ?? []) as PlanContratable[]);
    setFacturas((facRes.data ?? []) as Factura[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { cargar(); }, [cargar]);

  const contratar = async (plan: PlanContratable) => {
    if (!activeOrg) return;
    setContratando(plan.code);

    const { data, error } = await supabase.functions.invoke("mp-subscribe", {
      body: {
        org_id: activeOrg.id,
        plan_code: plan.code,
        ciclo,
        back_url: `${window.location.origin}/mi-plan`,
      },
    });

    setContratando(null);

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error ?? "No se pudo iniciar la suscripción");
      return;
    }

    const link = (data as any)?.init_point;
    if (!link) {
      toast.error("MercadoPago no devolvió el link de pago");
      return;
    }

    // Se manda al comercio a autorizar el débito en MercadoPago. La suscripción
    // se activa cuando MP confirme el primer cobro, no al abrir el link.
    window.location.href = link;
  };

  const estadoActual = sub?.estado ?? "sin_suscripcion";
  const badge = ETIQUETA_ESTADO[estadoActual] ?? ETIQUETA_ESTADO.sin_suscripcion;
  const precio = (p: PlanContratable) =>
    ciclo === "anual" ? Number(p.price_ars_yearly ?? 0) : Number(p.price_ars_monthly);

  return (
    <div className="workspace-page space-y-5">
      <PageHeader
        icon={CreditCard}
        title="Mi plan"
        description="Tu suscripción a Gestiona. Se cobra por MercadoPago."
        badge={{ label: badge.texto }}
      />

      {/* Estado actual */}
      <div className="rounded-[8px] border border-border/80 bg-card p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando
          </div>
        ) : estadoActual === "sin_suscripcion" ? (
          <p className="text-sm text-muted-foreground">
            Todavía no tenés un plan contratado. Elegí uno abajo.
          </p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Plan actual</p>
              <p className="text-xl font-semibold">{sub?.plan?.name ?? "—"}</p>
              {estadoActual !== "sin_suscripcion" && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {sub?.precio_ars != null
                    ? <>Pagás <span className="font-medium text-foreground">{formatARS(sub.precio_ars)}</span>{sub?.ciclo === "anual" ? " por año" : " por mes"}</>
                    : "No tenemos registro del monto: revisalo en tu resumen de MercadoPago"}
                </p>
              )}
              <span className={`inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded border ${badge.clase}`}>
                {badge.texto}
              </span>
            </div>

            {sub?.renueva_el && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                  <Calendar className="w-3 h-3" />
                  {sub.cancela_al_final ? "Vence el" : "Renueva el"}
                </p>
                <p className="text-sm font-medium">
                  {new Date(sub.renueva_el).toLocaleDateString("es-AR")}
                </p>
                {typeof sub.dias_restantes === "number" && (
                  <p className="text-[11px] text-muted-foreground">
                    {sub.dias_restantes >= 0
                      ? `en ${sub.dias_restantes} día${sub.dias_restantes === 1 ? "" : "s"}`
                      : "vencido"}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cancelar no corta el acceso: el período ya está pago. */}
        {sub?.cancela_al_final && (
          <div className="mt-4 flex items-start gap-2 rounded-[6px] border border-yellow-500/25 bg-yellow-500/8 px-3 py-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <p className="text-muted-foreground">
              Cancelaste la renovación. Seguís teniendo acceso hasta que termine
              el período que ya pagaste.
            </p>
          </div>
        )}

        {estadoActual === "past_due" && (
          <div className="mt-4 flex items-start gap-2 rounded-[6px] border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
            <p className="text-muted-foreground">
              El último cobro no se pudo hacer. Revisá el medio de pago en
              MercadoPago para no perder el servicio.
            </p>
          </div>
        )}
      </div>

      {/* Planes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Planes</h2>
          <div className="inline-flex rounded-[6px] border border-border/70 p-0.5">
            {(["mensual", "anual"] as const).map(c => (
              <button
                key={c}
                onClick={() => setCiclo(c)}
                className={`px-3 py-1 text-xs rounded-[4px] transition-colors ${
                  ciclo === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c === "mensual" ? "Mensual" : "Anual"}
              </button>
            ))}
          </div>
        </div>

        {loading ? null : planes.length === 0 ? (
          // Un plan sin precio en pesos no se puede cobrar por MercadoPago, y
          // eso se dice en vez de mostrar un número convertido que nadie decidió.
          <div className="rounded-[8px] border border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
            Todavía no hay planes con precio en pesos configurado. MercadoPago
            cobra en pesos, así que hasta que se carguen no se puede contratar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {planes.map(p => {
              const esActual = sub?.plan?.code === p.code;
              const monto = precio(p);
              return (
                <div
                  key={p.id}
                  className={`rounded-[8px] border bg-card p-4 flex flex-col ${
                    esActual ? "border-primary/50 ring-1 ring-primary/15" : "border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{p.name}</h3>
                    {esActual && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/12 text-primary border border-primary/20">
                        Actual
                      </span>
                    )}
                  </div>

                  <div className="mt-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {monto > 0 ? formatARS(monto) : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ciclo === "anual" ? " / año" : " / mes"}
                    </span>
                    {ciclo === "anual" && p.ahorro_anual_pct ? (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        Ahorrás {p.ahorro_anual_pct}% contra el mensual
                      </p>
                    ) : null}
                  </div>

                  {p.description && (
                    <p className="text-xs text-muted-foreground mt-2">{p.description}</p>
                  )}

                  <ul className="mt-3 space-y-1 text-xs flex-1">
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                      {p.max_products ? `${p.max_products.toLocaleString("es-AR")} productos` : "Productos ilimitados"}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                      {p.max_users ? `${p.max_users} usuario${p.max_users === 1 ? "" : "s"}` : "Usuarios ilimitados"}
                    </li>
                    {p.ai_enabled && (
                      <li className="flex items-center gap-1.5">
                        <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                        Asistente de IA
                      </li>
                    )}
                  </ul>

                  <Button
                    className="w-full mt-4"
                    variant={esActual ? "outline" : "default"}
                    disabled={esActual || contratando !== null || monto <= 0}
                    onClick={() => contratar(p)}
                  >
                    {contratando === p.code ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : esActual ? (
                      "Tu plan"
                    ) : (
                      <>Contratar <ExternalLink className="w-3.5 h-3.5 ml-1" /></>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Facturas */}
      {facturas.length > 0 && (
        <div className="rounded-[8px] border border-border/80 bg-card">
          <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Historial de pagos</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="text-left font-medium px-4 py-2">Comprobante</th>
                  <th className="text-left font-medium px-4 py-2">Período</th>
                  <th className="text-left font-medium px-4 py-2">Estado</th>
                  <th className="text-right font-medium px-4 py-2">Monto</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => (
                  <tr key={f.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{f.numero}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(f.periodo_desde).toLocaleDateString("es-AR")} –{" "}
                      {new Date(f.periodo_hasta).toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
                        f.estado === "paid"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      }`}>
                        {f.estado === "paid" ? "Pagado" : "Rechazado"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatARS(f.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
