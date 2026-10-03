/**
 * Newsletter de la tienda — el formulario que Tiendanube y Shopify pisan en
 * el footer de cada página.
 *
 * Antes, el consentimiento de marketing sólo existía al finalizar una compra:
 * el visitante que todavía no compraba no tenía forma de dejar su email. La
 * suscripción vive en `store_newsletter_subscribers` (RPC pública por slug) y
 * viaja al CRM cuando la persona compra. La baja nunca se reactiva desde acá.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Loader2, Check } from "lucide-react";
import { normalizarEmail } from "@/lib/couponRules";

type Estado = "idle" | "enviando" | "procesado" | "error";

const MENSAJES: Record<Exclude<Estado, "idle" | "enviando">, string> = {
  procesado: "Listo. Si la dirección puede suscribirse, la solicitud quedó registrada.",
  error: "No pudimos guardar tu email. Revisalo e intentá de nuevo.",
};

export default function StoreNewsletter({ slug, base }: { slug?: string | null; base: string }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");

  if (!slug) return null;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = normalizarEmail(email);
    if (!limpio) {
      setEstado("error");
      return;
    }
    setEstado("enviando");
    const { data, error } = await supabase.rpc("register_store_newsletter", {
      p_slug: slug,
      p_email: limpio,
    });
    const respuesta = (data ?? {}) as { ok?: boolean; estado?: string };
    if (error || !respuesta.ok || !respuesta.estado) {
      setEstado("error");
      return;
    }
    setEstado(respuesta.estado === "procesado" ? "procesado" : "error");
    setEmail("");
  };

  const resuelto = estado === "procesado";

  return (
    <div className="storefront-newsletter min-w-0">
      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Mail className="w-4 h-4" style={{ color: "hsl(var(--st-accent))" }} />
        Novedades y promociones
      </p>
      {resuelto ? (
        <p className="text-sm flex items-start gap-2" style={{ color: "hsl(var(--st-muted))" }}>
          <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--st-accent))" }} />
          {MENSAJES[estado as Exclude<Estado, "idle" | "enviando">]}
        </p>
      ) : (
        <form onSubmit={enviar} className="flex w-full min-w-0 gap-2 max-w-sm" aria-label="Suscribirse al newsletter">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (estado === "error") setEstado("idle"); }}
            placeholder="Email para novedades"
            aria-label="Email para recibir novedades"
            className="flex-1 min-w-0 min-h-11 px-3 text-sm border"
            style={{
              borderRadius: "var(--st-radius)",
              borderColor: "hsl(var(--st-border))",
              background: "hsl(var(--st-bg))",
              color: "hsl(var(--st-text))",
            }}
          />
          <button
            type="submit"
            disabled={estado === "enviando"}
            className="px-4 min-h-11 text-sm font-semibold shrink-0 disabled:opacity-60 inline-flex items-center gap-2"
            style={{
              background: "hsl(var(--st-accent))",
              color: "hsl(var(--st-accent-fg))",
              borderRadius: "var(--st-radius)",
            }}
          >
            {estado === "enviando" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Suscribirme
          </button>
        </form>
      )}
      {estado === "error" && (
        <p className="text-xs mt-1.5" style={{ color: "#dc2626" }}>{MENSAJES.error}</p>
      )}
      <p className="text-[11px] mt-2" style={{ color: "hsl(var(--st-muted))" }}>
        Al suscribirte aceptás recibir novedades. Podés darte de baja cuando quieras —{" "}
        <a href={`${base}/pagina/politica-de-privacidad`} className="underline">política de privacidad</a>.
      </p>
    </div>
  );
}
