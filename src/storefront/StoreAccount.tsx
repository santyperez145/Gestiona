import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWishlist } from "./wishlist";
import ProductCard from "./ProductCard";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { retryPublicRead } from "@/lib/publicDataSource";
import { storeOrderPaymentLabel } from "@/lib/storeOrderPayment";
import { productIdsFromStoreOrders, suggestionsFromOrderSeeds } from "@/lib/relatedProducts";
import { User, Loader2, LogOut, Package, MailCheck, Heart } from "lucide-react";

interface Pedido {
  order_number: string;
  items: { name: string; quantity: number; total: number; product_id?: string }[];
  total: number;
  payment_status: string;
  fulfillment_status: string;
  tracking_number: string | null;
  created_at: string;
}

const ESTADO_PAGO: Record<string, { label: string; cls: string }> = {
  paid: { label: "Pagado", cls: "text-emerald-600" },
  pending: { label: "Pendiente de pago", cls: "text-amber-600" },
  failed: { label: "Pago rechazado", cls: "text-red-600" },
  refunded: { label: "Pago devuelto", cls: "text-red-600" },
  charged_back: { label: "Contracargo", cls: "text-red-600" },
};
const ESTADO_ENVIO: Record<string, string> = {
  pending: "Por preparar",
  processing: "En preparación",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export default function StoreAccount() {
  const { store, products, fmt } = useStore();
  const { loading, customer, signIn, signUp, signOut, resetPassword, signInWithEmailOtp, verifyEmailOtp } = useStoreAuth();
  const base = `/tienda/${store?.slug ?? ""}`;

  const [modo, setModo] = useState<"login" | "registro" | "otp">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", otp: "" });
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const deseos = useWishlist();
  // Los deseos son ids: se cruzan con el catálogo ya cargado en vez de pedir
  // los productos de nuevo.
  const deseados = products.filter(x => deseos.has(x.id));
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargandoPedidos, setCargandoPedidos] = useState(false);
  const [errorPedidos, setErrorPedidos] = useState(false);

  const sugeridos = useMemo(() => {
    const seeds = productIdsFromStoreOrders(pedidos);
    if (seeds.length === 0) return [];
    return suggestionsFromOrderSeeds(seeds, products, { limit: 8, preferInStock: true })
      .map(r => r.product)
      .filter(p => Number(p.stock) > 0);
  }, [pedidos, products]);

  const cargarPedidos = () => {
    if (!customer || !store?.slug) return;
    setCargandoPedidos(true);
    setErrorPedidos(false);
    void retryPublicRead(() =>
      supabase.rpc("get_my_store_orders", { p_slug: store.slug }),
    ).then(({ data, error }) => {
      if (error) {
        console.error("[cuenta] error leyendo pedidos:", error.message);
        setErrorPedidos(true);
        setPedidos([]);
      } else {
        setPedidos((data ?? []) as unknown as Pedido[]);
      }
      setCargandoPedidos(false);
    }, () => {
      setErrorPedidos(true);
      setCargandoPedidos(false);
    });
  };

  useEffect(() => {
    cargarPedidos();
    // store.slug y customer disparan la lectura; cargarPedidos se recrea cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, store?.slug]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setAviso(null); setEnviando(true);

    if (modo === "otp") {
      if (!otpSent) {
        const res = await signInWithEmailOtp(form.email, {
          createUser: false,
        });
        setEnviando(false);
        if (res.error) {
          // Primera compra: permitir crear con account_type store_customer.
          if (/signups not allowed|user not found|Unable to validate/i.test(res.error)) {
            const crear = await signInWithEmailOtp(form.email, {
              createUser: true,
              name: form.name || undefined,
            });
            if (crear.error) { setError(crear.error); return; }
            setOtpSent(true);
            setAviso("Te mandamos un enlace y un código. Si es tu primera vez, ya quedás como comprador de esta tienda (no como dueño del panel).");
            return;
          }
          setError(res.error);
          return;
        }
        setOtpSent(true);
        setAviso("Te mandamos un enlace y un código a tu email.");
        return;
      }
      const res = await verifyEmailOtp(form.email, form.otp);
      setEnviando(false);
      if (res.error) { setError(res.error); return; }
      return;
    }

    const res = modo === "login"
      ? await signIn(form.email, form.password)
      : await signUp(form.email, form.password, form.name);

    setEnviando(false);
    if (res.error) { setError(res.error); return; }
    if ("needsConfirm" in res && res.needsConfirm) {
      setAviso("Te mandamos un email para confirmar tu cuenta. Revisá tu bandeja (y el spam).");
    }
  };

  const recuperar = async () => {
    if (!form.email.trim()) { setError("Escribí tu email primero"); return; }
    const res = await resetPassword(form.email);
    if (res.error) setError(res.error);
    else setAviso("Te mandamos un link para cambiar la contraseña.");
  };

  const input = "w-full px-3 py-2 text-sm border bg-transparent outline-none";
  const inputStyle = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as React.CSSProperties;

  if (loading) {
    return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="w-6 h-6 animate-spin opacity-50" /></div>;
  }

  // ── Sin sesión: login / registro ────────────────────────────────────────
  if (!customer) {
    return (
      <div className="max-w-sm mx-auto px-4 py-12">
        <div className="text-center mb-6">
          <User className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <h1 className="text-xl font-bold">
            {modo === "otp"
              ? (otpSent ? "Revisá tu email" : "Entrar con email")
              : modo === "login" ? "Iniciá sesión" : "Creá tu cuenta"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
            {modo === "otp"
              ? "Enlace mágico o código. Las cuentas nuevas se marcan como comprador de la tienda, no como workspace Gestiona."
              : "Para ver tus pedidos y comprar más rápido la próxima vez."}
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-3">
          {modo === "registro" && (
            <label className="block">
              <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Nombre y apellido</span>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={input} style={inputStyle} />
            </label>
          )}
          <label className="block">
            <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Email</span>
            <input required type="email" autoComplete="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={input} style={inputStyle} disabled={modo === "otp" && otpSent} />
          </label>
          {modo !== "otp" && (
            <label className="block">
              <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Contraseña</span>
              <input
                required type="password" minLength={6}
                autoComplete={modo === "login" ? "current-password" : "new-password"}
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className={input} style={inputStyle}
              />
            </label>
          )}
          {modo === "otp" && otpSent && (
            <label className="block">
              <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Código del email</span>
              <input
                required type="text" inputMode="numeric" autoComplete="one-time-code"
                minLength={6} maxLength={8}
                value={form.otp} onChange={e => setForm(f => ({ ...f, otp: e.target.value }))}
                className={input} style={inputStyle}
              />
            </label>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
          {aviso && (
            <p className="text-xs flex items-start gap-1.5" style={{ color: "hsl(var(--st-muted))" }}>
              <MailCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />{aviso}
            </p>
          )}

          <button
            type="submit" disabled={enviando}
            className="w-full min-h-11 py-2.5 text-sm font-medium disabled:opacity-60"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            {enviando
              ? "..."
              : modo === "otp"
                ? (otpSent ? "Confirmar código" : "Enviar enlace y código")
                : modo === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>

        <div className="mt-4 text-center space-y-2 text-xs">
          {modo !== "otp" && (
            <button
              onClick={() => { setModo(m => (m === "login" ? "registro" : "login")); setError(null); setAviso(null); setOtpSent(false); }}
              className="hover:underline"
              style={{ color: "hsl(var(--st-accent))" }}
            >
              {modo === "login" ? "No tengo cuenta, quiero registrarme" : "Ya tengo cuenta"}
            </button>
          )}
          {modo === "login" && (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => { setModo("otp"); setError(null); setAviso(null); setOtpSent(false); }}
                  className="hover:underline"
                  style={{ color: "hsl(var(--st-accent))" }}
                >
                  Entrar con enlace o código
                </button>
              </div>
              <div>
                <button onClick={recuperar} className="hover:underline" style={{ color: "hsl(var(--st-muted))" }}>
                  Olvidé mi contraseña
                </button>
              </div>
            </>
          )}
          {modo === "otp" && (
            <button
              type="button"
              onClick={() => { setModo("login"); setError(null); setAviso(null); setOtpSent(false); }}
              className="hover:underline"
              style={{ color: "hsl(var(--st-muted))" }}
            >
              Volver al login con contraseña
            </button>
          )}
        </div>

        <p className="text-[11px] text-center mt-6" style={{ color: "hsl(var(--st-muted))" }}>
          También podés comprar sin cuenta.{" "}
          <Link to={`${base}/productos`} className="hover:underline" style={{ color: "hsl(var(--st-accent))" }}>
            Ver productos
          </Link>
        </p>
      </div>
    );
  }

  // ── Con sesión: datos + historial ───────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Hola{customer.name ? `, ${customer.name.split(" ")[0]}` : ""}</h1>
          <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>{customer.email}</p>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 border"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        >
          <LogOut className="w-3.5 h-3.5" /> Cerrar sesión
        </button>
      </div>

      <h2 className="font-semibold mb-3">Mis pedidos</h2>

      {cargandoPedidos ? (
        <div className="py-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin opacity-50" /></div>
      ) : errorPedidos ? (
        <div
          className="border p-8 text-center"
          data-storefront-state="account-orders-error"
          role="alert"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        >
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>No pudimos cargar tus pedidos.</p>
          <button
            type="button"
            onClick={cargarPedidos}
            className="inline-block mt-4 min-h-11 px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Reintentar
          </button>
        </div>
      ) : pedidos.length === 0 ? (
        <div
          className="border p-8 text-center"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        >
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>Todavía no hiciste ningún pedido.</p>
          <Link
            to={`${base}/productos`}
            className="inline-block mt-4 px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Ver productos
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {pedidos.map(p => {
            const pago = ESTADO_PAGO[p.payment_status] ?? { label: storeOrderPaymentLabel(p.payment_status), cls: "" };
            return (
              <div
                key={p.order_number}
                className="border p-4"
                style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <Link
                      to={`${base}/orden/${p.order_number}`}
                      className="font-medium text-sm hover:underline"
                    >
                      {p.order_number}
                    </Link>
                    <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                      {new Date(p.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{fmt(Number(p.total))}</p>
                    <p className={`text-xs ${pago.cls}`}>{pago.label}</p>
                  </div>
                </div>

                <p className="text-xs mt-2" style={{ color: "hsl(var(--st-muted))" }}>
                  {(p.items ?? []).map(i => `${i.quantity}× ${i.name}`).join(" · ")}
                </p>

                <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                  <span>{ESTADO_ENVIO[p.fulfillment_status] ?? p.fulfillment_status}</span>
                  {/* La condición estaba invertida: mostraba el seguimiento
                      sólo si el pedido NO estaba pago, o sea nunca — un pedido
                      impago no se despacha. */}
                  {p.tracking_number && (
                    <span>· Seguimiento: {p.tracking_number}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sugeridos.length > 0 && (
        <>
          <h2 className="font-semibold mt-10 mb-3">Porque compraste</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {sugeridos.map(prod => <ProductCard key={prod.id} p={prod} />)}
          </div>
        </>
      )}

      {/* ── Lista de deseos ─────────────────────────────────────────── */}
      <h2 className="font-semibold mt-10 mb-3">Mi lista de deseos</h2>
      {deseados.length === 0 ? (
        <div
          className="border p-8 text-center"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        >
          <Heart className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
            Tocá el corazón en cualquier producto para guardarlo acá.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {deseados.map(prod => <ProductCard key={prod.id} p={prod} />)}
        </div>
      )}
    </div>
  );
}
