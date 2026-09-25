/**
 * Formulario de suscripción al newsletter del footer de la tienda.
 *
 * Conecta directamente al RPC público `subscribe_store_newsletter` por slug,
 * sin hardcodear texto ni suposiciones de negocio: el footer de cada tienda
 * captura suscriptores anónimos respetando el opt-out global.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { Loader2, Send } from "lucide-react";

export default function StoreNewsletter() {
  const { store } = useStore();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [estado, setEstado] = useState<"idle" | "ok" | "error" | "unsubscribed">("idle");
  const [mensaje, setMensaje] = useState("");

  if (!store?.slug) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setEstado("idle");
    setMensaje("");

    const { data, error } = await (supabase.rpc as any)("subscribe_store_newsletter", {
      p_store_slug: store.slug,
      p_email: email,
      p_name: name || null,
    });

    setEnviando(false);

    if (error) {
      console.error("[newsletter] error:", error);
      setEstado("error");
      setMensaje("No pudimos registrar la suscripción. Probá de nuevo.");
      return;
    }

    const result = (data as { ok: boolean; error?: string }) | null;
    if (result?.ok) {
      setEstado("ok");
      setMensaje("¡Gracias! Tu-email está registrado.");
      setEmail("");
      setName("");
    } else if (result?.error === "unsubscribed") {
      setEstado("unsubscribed");
      setMensaje("Este email está dado de baja. Contactanos para revertirlo.");
    } else {
      setEstado("error");
      setMensaje(result?.error ?? "No se pudo suscribir.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="storefront-newsletter space-y-2">
      <p className="text-xs font-semibold" style={{ color: "hsl(var(--st-muted))" }}>
        Sumate al newsletter
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="email"
          required
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={enviando || estado === "ok"}
          className="w-full px-3 py-2 text-sm border bg-transparent outline-none"
          style={{
            borderRadius: "var(--st-radius)",
            borderColor: "hsl(var(--st-border))",
            color: "hsl(var(--st-fg))",
          }}
        />
        <input
          type="text"
          placeholder="Nombre (opcional)"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          disabled={enviando || estado === "ok"}
          className="w-full px-3 py-2 text-sm border bg-transparent outline-none"
          style={{
            borderRadius: "var(--st-radius)",
            borderColor: "hsl(var(--st-border))",
            color: "hsl(var(--st-fg))",
          }}
        />
        <button
          type="submit"
          disabled={enviando || estado === "ok" || estado === "unsubscribed"}
          className="w-full flex min-h-11 items-center justify-center gap-2 text-sm font-medium"
          style={{
            background: "hsl(var(--st-accent))",
            color: "hsl(var(--st-accent-fg))",
            borderRadius: "var(--st-radius)",
          }}
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {enviando ? "Enviando…" : "Suscribir"}
        </button>
        {estado === "ok" && (
          <p className="text-xs" style={{ color: "hsl(var(--st-link))" }}>{mensaje}</p>
        )}
      </div>
    </form>
  );
}
