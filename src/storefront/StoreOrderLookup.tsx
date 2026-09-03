/**
 * Consultar pedido — entrada descubrible (Shopify Order status / Tiendanube).
 * Nº + email → misma autoridad que `/orden/:n` (token opaco, sin IDOR).
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, PackageSearch } from "lucide-react";
import { getStoreOrderSecure } from "@/lib/publicDataSource";
import { normalizeStoreOrderNumber } from "@/lib/storeOrderLookup";
import { useStore } from "./storeContext";
import { saveOrderAccessToken } from "./orderAccess";

export default function StoreOrderLookup() {
  const { store } = useStore();
  const navigate = useNavigate();
  const base = `/tienda/${store?.slug ?? ""}`;
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!store?.slug) return;
    const numero = normalizeStoreOrderNumber(orderNumber);
    const mail = email.trim();
    if (!numero || !mail) {
      setError("Completá el número de pedido y el email de la compra.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await getStoreOrderSecure({
      slug: store.slug,
      orderNumber: numero,
      email: mail,
    });
    setBusy(false);
    if (result.error) {
      setError("No pudimos consultar ahora. Reintentá en un momento.");
      return;
    }
    if (!result.data) {
      // Misma honestidad que StoreOrder: no revelar si falló el nº o el email.
      setError("No pudimos verificar esos datos. Revisalos o escribile a la tienda.");
      return;
    }
    if (result.data.access_token) {
      saveOrderAccessToken(store.slug, numero, result.data.access_token);
    }
    navigate(`${base}/orden/${encodeURIComponent(numero)}`, { replace: true });
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 sm:py-20">
      <div
        className="border p-6"
        style={{
          borderColor: "hsl(var(--st-border))",
          background: "hsl(var(--st-surface))",
          borderRadius: "var(--st-radius)",
        }}
      >
        <PackageSearch className="mx-auto mb-3 h-10 w-10" style={{ color: "hsl(var(--st-accent))" }} />
        <h1 className="text-center text-xl font-bold">Consultar mi pedido</h1>
        <p className="mt-2 text-center text-sm" style={{ color: "hsl(var(--st-muted))" }}>
          Ingresá el número que te mandamos por email y el mismo correo de la compra.
        </p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { void onSubmit(e); }}>
          <div>
            <label htmlFor="lookup-order" className="text-xs font-medium">Número de pedido</label>
            <input
              id="lookup-order"
              name="order_number"
              autoComplete="off"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="mt-1 w-full border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
              placeholder="Ej. 1042"
            />
          </div>
          <div>
            <label htmlFor="lookup-email" className="text-xs font-medium">Email de la compra</label>
            <input
              id="lookup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-1"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium disabled:opacity-60"
            style={{
              background: "hsl(var(--st-accent))",
              color: "hsl(var(--st-accent-fg))",
              borderRadius: "var(--st-radius)",
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Ver estado del pedido
          </button>
        </form>
        {error && (
          <p className="mt-3 text-center text-xs text-red-600" role="alert">{error}</p>
        )}
        <Link
          to={base}
          className="mt-5 block text-center text-sm hover:underline"
          style={{ color: "hsl(var(--st-accent))" }}
        >
          Volver a la tienda
        </Link>
      </div>
    </div>
  );
}
