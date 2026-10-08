import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useEntitlements, type Plan } from "@/lib/useEntitlements";
import {
  annualSaving,
  limitesDelPlan,
  planPrice,
  PLAN_COMPARISON,
} from "@/lib/planOffer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import BrandLogo from "@/components/shared/BrandLogo";

const FAQ = [
  {
    q: "¿La tienda gratuita vence después de 14 días?",
    a: "No. Tu tienda, productos, ventas y equipo siguen disponibles sin límite de plan. Los 14 días corresponden a la prueba de los extras: inteligencia artificial, copias automáticas y marca propia sin identificación de Nerqia.",
  },
  {
    q: "¿Puedo cambiar de plan cuando quiera?",
    a: "Sí. Elegís el plan nuevo desde Mi plan y MercadoPago te pide autorizar el nuevo importe. El cambio necesita tu autorización; no modificamos tus cobros sólo por publicar un precio nuevo.",
  },
  {
    q: "¿Puedo darme de baja cuando quiera?",
    a: "Sí, desde Mi plan. Le avisamos a MercadoPago para que no te cobre más. Conservás los extras hasta que termina lo que ya pagaste, y después podés seguir con el comercio gratuito.",
  },
  {
    q: "¿Qué pasa con mi información si me doy de baja?",
    a: "Tus productos, ventas, stock y clientes siguen intactos. Podés seguir operando y exportando tus datos; no borramos información por dejar de pagar.",
  },
  {
    q: "¿En qué moneda son los precios?",
    a: "En pesos argentinos. La suscripción se autoriza con MercadoPago. Los costos de procesar los pagos de tus compradores dependen del proveedor que conectes y son independientes de tu plan.",
  },
  {
    q: "¿Conviene pagar el año entero?",
    a: "Cada plan muestra su ahorro real frente a doce pagos mensuales. Al elegir Anual ves tanto el equivalente por mes como el importe total que vas a autorizar por año.",
  },
  {
    q: "¿Y si alguna vez suben el precio?",
    a: "El precio publicado es para nuevas contrataciones. Un cambio de tu importe necesita un aviso previo con el monto y la fecha, y podés dar de baja la suscripción desde Mi plan.",
  },
];
const TRUST = ["Sin permanencia", "Tus datos son tuyos", "Baja desde Mi plan"];
const fmtARS = (n: number) =>
  n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

export default function PricingPage() {
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const {
    plan: currentPlan,
    subscription,
    planVigente,
    isTrialing,
    trialDaysLeft,
  } = useEntitlements();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [comparisonPlan, setComparisonPlan] = useState("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const {
    data: plans = [],
    isPending: loading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["public-plan-offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select(
          "id,code,name,description,price_ars_monthly,price_ars_yearly,max_products,max_sales_per_month,max_users,ai_enabled,ai_monthly_credits,backups_enabled,custom_branding,sort_order,features",
        )
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Plan[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const visiblePlan = plans.find((p) => p.code === comparisonPlan) ?? plans[0];
  const canSubscribe =
    !user || activeRole === "owner" || activeRole === "admin";

  const handleSelect = async (plan: Plan) => {
    if (!user) {
      navigate("/login?mode=register");
      return;
    }
    if (plan.code === "trial") {
      navigate("/mi-plan");
      return;
    }
    if (!activeOrg || !canSubscribe) {
      toast.error("El titular o administrador puede contratar el plan.");
      return;
    }
    if (planPrice(plan, yearly) == null || planPrice(plan, yearly) === 0)
      return;
    setCheckingOut(plan.code);
    setCheckoutError(null);
    try {
      const { data, error } = await supabase.functions.invoke("mp-subscribe", {
        body: {
          org_id: activeOrg.id,
          plan_code: plan.code,
          ciclo: yearly ? "anual" : "mensual",
          back_url: `${window.location.origin}/mi-plan`,
        },
      });
      if (error || data?.error) {
        const message = await mensajeDeEdgeFunction(error, data);
        setCheckoutError(
          message || "No pudimos iniciar la suscripción. Intentá nuevamente.",
        );
        return;
      }
      const link = (data as { init_point?: string })?.init_point;
      if (!link || !/^https:\/\//.test(link)) {
        setCheckoutError(
          "No recibimos el enlace de autorización. Intentá nuevamente.",
        );
        return;
      }
      window.location.href = link;
    } catch (error) {
      console.error("Pricing subscription request failed", error);
      setCheckoutError(
        "No pudimos conectar con el sistema de pagos. Intentá nuevamente.",
      );
    } finally {
      setCheckingOut(null);
    }
  };

  return (
    <div className="plan-offers min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <nav
          aria-label="Navegación de planes"
          className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4"
        >
          <Link to="/" aria-label="Nerqia, inicio">
            <BrandLogo />
          </Link>
          <Button variant="ghost" asChild>
            <Link to={user ? "/mi-plan" : "/"}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {user ? "Mi plan" : "Inicio"}
            </Link>
          </Button>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-7xl px-5 pb-8 pt-10 sm:pt-14">
          <p className="mb-3 text-sm font-semibold text-primary">
            Nerqia · Planes
          </p>
          <h1 className="max-w-3xl font-display text-3xl font-bold leading-tight sm:text-4xl">
            Tu tienda sin límites. Un plan para cada etapa.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Empezá con el comercio gratuito. Sumá inteligencia artificial,
            copias automáticas y tu propia marca cuando lo necesites.
          </p>
          {user && subscription && (
            <p className="mt-4 text-sm text-muted-foreground">
              {isTrialing && planVigente
                ? `Prueba de extras: ${trialDaysLeft} días restantes.`
                : planVigente
                  ? `Tu plan: ${currentPlan?.name ?? "activo"}.`
                  : "Comercio gratuito activo. Tus datos y tu tienda siguen disponibles."}{" "}
              <Link
                className="text-primary underline underline-offset-4"
                to="/mi-plan"
              >
                Ver mi suscripción
              </Link>
            </p>
          )}
          <div
            className="mt-7 inline-flex rounded-lg border border-border bg-card p-1"
            role="group"
            aria-label="Frecuencia de pago"
          >
            {[
              { value: false, label: "Mensual" },
              { value: true, label: "Anual" },
            ].map(({ value, label }) => (
              <button
                key={label}
                type="button"
                aria-pressed={yearly === value}
                onClick={() => setYearly(value)}
                className={`min-h-10 rounded-md px-6 text-sm font-medium ${yearly === value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section
          aria-label="Planes disponibles"
          className="mx-auto max-w-7xl px-5 pb-10"
        >
          {isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 border border-destructive/40 p-5"
            >
              <AlertTriangle className="h-5 w-5" />
              No pudimos cargar los planes.
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reintentar
              </Button>
            </div>
          ) : loading ? (
            <div role="status" className="py-12">
              <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
              Cargando planes…
            </div>
          ) : plans.length === 0 ? (
            <p role="status">No hay planes publicados en este momento.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {plans.map((p) => {
                const free = p.code === "trial";
                const amount = planPrice(p, yearly);
                const saving = annualSaving(p);
                const current =
                  !free &&
                  currentPlan?.code === p.code &&
                  subscription?.status === "active";
                const features = [
                  ...limitesDelPlan(p),
                  ...(Array.isArray(p.features) ? p.features : []),
                ];
                return (
                  <article
                    key={p.id}
                    aria-labelledby={`offer-${p.code}`}
                    className={`plan-offer plan-offer--${p.code} flex flex-col rounded-lg border border-border bg-card p-5`}
                  >
                    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
                      <h2
                        id={`offer-${p.code}`}
                        className="text-xl font-semibold"
                      >
                        {p.name}
                      </h2>
                      {current && (
                        <span className="text-xs font-medium text-primary">
                          Tu plan
                        </span>
                      )}
                    </div>
                    <p className="mt-2 min-h-12 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                    <div className="mt-5 min-h-24">
                      <p className="text-2xl font-semibold tabular-nums">
                        {amount === null
                          ? "No disponible"
                          : amount === 0
                            ? "Gratis"
                            : `$${fmtARS(yearly ? Math.round((amount / 12) * 100) / 100 : amount)}`}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {amount != null && amount > 0 ? "ARS / mes" : ""}
                        </span>
                      </p>
                      {yearly && amount != null && amount > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          ${fmtARS(amount)} ARS en un pago anual
                        </p>
                      )}
                      {yearly && saving != null && saving > 0 && (
                        <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          Ahorrás {saving}%
                        </p>
                      )}
                      {free && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Sin tarjeta · Sin vencimiento del comercio
                        </p>
                      )}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      variant={free ? "outline" : "default"}
                      disabled={
                        checkingOut !== null ||
                        current ||
                        (!free &&
                          (amount == null || amount <= 0 || !canSubscribe))
                      }
                      onClick={() => handleSelect(p)}
                    >
                      {checkingOut === p.code ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Conectando
                        </>
                      ) : current ? (
                        "Plan actual"
                      ) : free ? (
                        user ? (
                          "Ver comercio gratuito"
                        ) : (
                          "Crear tienda gratis"
                        )
                      ) : (
                        <>
                          {user ? `Elegir ${p.name}` : "Empezar ahora"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                    <ul className="mt-5 flex-1 space-y-3 border-t border-border pt-5 text-sm">
                      {Array.from(new Set(features)).map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check
                            aria-hidden
                            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {free && (
                      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                        La prueba de los extras dura 14 días. Después, tu
                        comercio sigue gratis.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {user && !canSubscribe && (
            <p className="mt-4 text-sm text-muted-foreground">
              Podés comparar planes. Para contratar, pedile al titular o
              administrador del comercio.
            </p>
          )}
          {checkoutError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/30 p-4 text-sm"
            >
              {checkoutError}
            </p>
          )}
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            Los importes corresponden al plan de Nerqia. El dominio, la
            mensajería, los envíos y las comisiones del proveedor de pagos
            pueden tener costos propios. Cada conexión requiere una cuenta
            habilitada y configuración.
          </p>
        </section>
        {plans.length > 0 && !isError && (
          <section
            aria-labelledby="comparison-title"
            className="border-y border-border bg-card py-10"
          >
            <div className="mx-auto max-w-7xl px-5">
              <h2 id="comparison-title" className="text-2xl font-semibold">
                Compará lo que incluye cada plan
              </h2>
              <div className="my-5 lg:hidden">
                <label htmlFor="compare-plan" className="mb-2 block text-sm">
                  Plan a comparar
                </label>
                <Select
                  value={visiblePlan?.code}
                  onValueChange={setComparisonPlan}
                >
                  <SelectTrigger id="compare-plan" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.code}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Tabs defaultValue="commerce" className="mt-6">
                <TabsList className="mb-4 flex h-auto w-fit max-w-full flex-wrap justify-start gap-1">
                  {PLAN_COMPARISON.map((group) => (
                    <TabsTrigger
                      className="min-h-10 whitespace-normal"
                      key={group.id}
                      value={group.id}
                    >
                      {group.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {PLAN_COMPARISON.map((group) => (
                  <TabsContent value={group.id} key={group.id}>
                    <table className="w-full table-fixed text-sm">
                      <caption className="sr-only">
                        {group.label}: prestaciones por plan
                      </caption>
                      <thead>
                        <tr className="border-b border-border">
                          <th
                            scope="col"
                            className="w-[46%] py-4 pr-3 text-left font-medium lg:w-[28%]"
                          >
                            Prestación
                          </th>
                          {plans.map((p) => (
                            <th
                              key={p.id}
                              scope="col"
                              className={`${p.id === visiblePlan?.id ? "" : "hidden"} px-2 py-4 text-left font-semibold lg:table-cell`}
                            >
                              {p.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr
                            key={row.label}
                            className="border-b border-border last:border-0"
                          >
                            <th
                              scope="row"
                              className="py-4 pr-3 text-left font-normal"
                            >
                              {row.label}
                            </th>
                            {plans.map((p) => (
                              <td
                                key={p.id}
                                className={`${p.id === visiblePlan?.id ? "" : "hidden"} break-words px-2 py-4 text-muted-foreground lg:table-cell`}
                              >
                                {row.value(p)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TabsContent>
                ))}
              </Tabs>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                Las acciones de IA no son conversaciones de WhatsApp. Los
                permisos y la seguridad se mantienen en todos los planes;
                contratar no saltea validaciones ni configuraciones de
                proveedores.
              </p>
            </div>
          </section>
        )}
        <section className="mx-auto max-w-3xl px-5 py-10">
          <h2 className="mb-5 text-2xl font-semibold">Preguntas frecuentes</h2>
          {FAQ.map((item, i) => (
            <div className="border-b border-border" key={item.q}>
              <button
                type="button"
                aria-expanded={faqOpen === i}
                aria-controls={`faq-${i}`}
                className="flex w-full items-center justify-between gap-3 py-5 text-left text-sm font-medium"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
              >
                {item.q}
                <ChevronDown
                  className={`h-4 w-4 shrink-0 ${faqOpen === i ? "rotate-180" : ""}`}
                />
              </button>
              <div
                id={`faq-${i}`}
                hidden={faqOpen !== i}
                className="pb-5 text-sm leading-relaxed text-muted-foreground"
              >
                {item.a}
              </div>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t border-border px-5 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>{TRUST.join(" · ")}</p>
          <div className="flex gap-5">
            <Link to="/terminos">Términos</Link>
            <Link to="/privacidad">Privacidad</Link>
            <Link to="/">Nerqia</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
