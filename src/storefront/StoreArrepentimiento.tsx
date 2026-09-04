/**
 * Botón de arrepentimiento — Ley 24.240 art. 34 y Resolución 424/2020.
 *
 * ── Por qué esta pantalla existe y por qué está donde está ────────────────
 *
 * La Res. 424/2020 no dice "accesible": dice que el botón tiene que estar
 * **en la primera pantalla del sitio**. Por eso el link vive en la barra de
 * arriba del header y no en el pie, que es donde la intuición lo pondría.
 *
 * ── Las dos cosas que se confunden, y son distintas ───────────────────────
 *
 * **Arrepentimiento** (art. 34): 10 días corridos desde que recibió el
 * pedido, **sin explicar por qué**, y el envío de vuelta lo paga el vendedor.
 * No hay nada que discutir: es un derecho.
 *
 * **Falla** (art. 11): garantía legal de 6 meses en producto nuevo. Necesita
 * que algo esté mal, pero dura mucho más.
 *
 * El formulario las separa a propósito. Ofrecer una sola casilla de "motivo"
 * lleva a que alguien que se arrepintió invente un defecto, y a partir de ahí
 * la conversación es sobre si el defecto existe en vez de sobre un derecho que
 * no requiere causa.
 *
 * ── Sin cuenta ───────────────────────────────────────────────────────────
 *
 * Se identifica con número de orden + email. Pedir que se registre para
 * ejercer un derecho es ponerle un trámite adelante, y además muchas compras
 * se hacen sin cuenta. El RPC devuelve **el mismo error** exista o no la
 * orden, así que esta pantalla tampoco sirve para averiguar quién compró qué.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, ShieldCheck, CheckCircle2 } from "lucide-react";

type Tipo = "arrepentimiento" | "falla";

export default function StoreArrepentimiento() {
  const { slug } = useParams<{ slug: string }>();
  const [tipo, setTipo] = useState<Tipo>("arrepentimiento");
  const [orden, setOrden] = useState("");
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState<{ rma: string } | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setEnviando(true);
    const { data, error: err } = await supabase.rpc("request_store_return", {
      p_slug: slug,
      p_order_number: orden.trim(),
      p_email: email.trim(),
      p_tipo: tipo,
      p_motivo: motivo.trim() || null,
    } as never);
    setEnviando(false);

    // No se traga el error: si algo falló, la persona tiene que enterarse.
    // Un "listo" falso acá le hace perder el plazo creyendo que lo usó.
    if (err) { setError(err.message); return; }
    const r = data as { ok?: boolean; error?: string; rma?: string } | null;
    if (!r?.ok) { setError(r?.error || "No pudimos registrar el pedido"); return; }
    setListo({ rma: r.rma ?? "" });
  };

  if (listo) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: "hsl(var(--st-link))" }} />
        <h1 className="text-2xl font-semibold mb-2">Pedido registrado</h1>
        <p className="text-sm mb-6" style={{ color: "hsl(var(--st-muted))" }}>
          Tu número de seguimiento es <strong>{listo.rma}</strong>. Te vamos a
          escribir al email que dejaste para coordinar la devolución.
        </p>
        {tipo === "arrepentimiento" && (
          <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            El costo de enviarlo de vuelta corre por nuestra cuenta, como
            corresponde por el artículo 34 de la Ley 24.240.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-1">Botón de arrepentimiento</h1>
      <p className="text-sm mb-8" style={{ color: "hsl(var(--st-muted))" }}>
        Ley 24.240 artículo 34 y Resolución 424/2020.
      </p>

      <form onSubmit={enviar} className="space-y-6">
        {/* Las dos opciones se explican enteras: la diferencia de plazo es lo
            que decide cuál corresponde, y es exactamente lo que nadie sabe. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { v: "arrepentimiento" as const, icon: RotateCcw, t: "Me arrepentí",
              d: "Dentro de los 10 días corridos de recibirlo. No hace falta explicar por qué, y el envío de vuelta lo pagamos nosotros." },
            { v: "falla" as const, icon: ShieldCheck, t: "Llegó con una falla",
              d: "Garantía legal de 6 meses en productos nuevos. Contanos qué pasó." },
          ]).map(o => (
            <button
              key={o.v} type="button" onClick={() => setTipo(o.v)}
              className="text-left border rounded-lg p-4 transition-colors"
              style={{
                borderColor: tipo === o.v ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                background: tipo === o.v ? "hsl(var(--st-accent) / 0.06)" : undefined,
              }}
            >
              <o.icon className="w-5 h-5 mb-2" style={{ color: "hsl(var(--st-link))" }} />
              <p className="font-medium text-sm mb-1">{o.t}</p>
              <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>{o.d}</p>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="orden">Número de orden</Label>
          <Input
            id="orden" required value={orden} placeholder="Por ejemplo, 1042"
            onChange={e => setOrden(e.target.value)}
          />
          <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            Está en el email de confirmación que te mandamos al comprar.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email con el que compraste</Label>
          <Input
            id="email" type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="motivo">
            {tipo === "falla" ? "Qué le pasa al producto" : "Comentario (opcional)"}
          </Label>
          <Textarea
            id="motivo" rows={3} value={motivo}
            required={tipo === "falla"}
            onChange={e => setMotivo(e.target.value)}
            placeholder={tipo === "falla"
              ? "Contanos qué falla tiene"
              : "No es obligatorio: podés arrepentirte sin dar explicaciones."}
          />
        </div>

        {error && (
          <p className="text-sm rounded-md p-3" style={{ background: "hsl(0 70% 50% / 0.1)", color: "hsl(0 70% 45%)" }}>
            {error}
          </p>
        )}

        <Button type="submit" disabled={enviando} className="w-full">
          {enviando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Enviar el pedido
        </Button>
      </form>

      <div className="mt-10 pt-6 border-t text-xs space-y-2" style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-muted))" }}>
        <p>
          <strong>Arrepentimiento:</strong> tenés 10 días corridos desde que
          recibís el pedido para devolverlo sin expresar motivo. El producto
          tiene que estar sin uso y en su embalaje original. El costo de
          devolución lo asumimos nosotros.
        </p>
        <p>
          <strong>Garantía:</strong> los productos nuevos tienen 6 meses de
          garantía legal por defectos de fabricación.
        </p>
        <p>
          Si no llegamos a un acuerdo, podés reclamar en la{" "}
          <a
            href="https://autogestion.produccion.gob.ar/consumidores"
            target="_blank" rel="noopener noreferrer"
            className="underline"
          >
            Ventanilla Única Federal de Reclamos
          </a>{" "}
          de Defensa del Consumidor.
        </p>
      </div>
    </div>
  );
}
