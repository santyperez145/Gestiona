/**
 * Cuenta mayorista del comprador en Mi cuenta (2026-10-30), migración
 * 20261023000600: pide el alta con razón social y CUIT, ve si está en
 * revisión o rechazada (con el motivo), y aprobada ve su lista, su crédito
 * disponible y si puede pedir a cuenta corriente.
 */
import { useState } from "react";
import { Building2, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";

const borde = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as const;
const tenue = { color: "hsl(var(--st-muted))" } as const;

export default function CuentaMayorista({ slug }: { slug: string }) {
  const { mayorista, recargarMayorista, fmt } = useStore();
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState("");
  const [telefono, setTelefono] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (!mayorista || mayorista.modo === "off") return null;
  const comprador = mayorista.comprador;

  const solicitar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const { error } = await supabase.rpc("solicitar_cuenta_mayorista" as never, {
      p_slug: slug, p_razon_social: razonSocial, p_cuit: cuit, p_telefono: telefono || null, p_mensaje: mensaje || null,
    } as never);
    setEnviando(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Pedido enviado: te avisamos cuando la tienda lo revise");
    recargarMayorista();
  };

  return (
    <section className="mb-10 border p-5 space-y-3" style={borde} aria-labelledby="cuenta-mayorista-titulo">
      <h2 id="cuenta-mayorista-titulo" className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" />Cuenta mayorista</h2>

      {comprador?.estado === "aprobado" ? (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="w-4 h-4" />Tu cuenta mayorista está activa{comprador.razon_social ? ` · ${comprador.razon_social}` : ""}.</p>
          <p style={tenue}>Ves y pagás tus precios{comprador.lista ? ` (${comprador.lista})` : ""} en toda la tienda.</p>
          {Number(mayorista.minimo ?? 0) > 0 && <p style={tenue}>Compra mínima: {fmt(Number(mayorista.minimo))}.</p>}
          {comprador.cuenta_corriente && (
            <p style={tenue}>Podés pedir a cuenta corriente{comprador.credito_disponible != null ? `: te quedan ${fmt(comprador.credito_disponible)} de crédito` : ""}.</p>
          )}
        </div>
      ) : comprador?.estado === "pendiente" ? (
        <p className="flex items-center gap-1.5 text-sm"><Clock className="w-4 h-4" />Tu pedido de cuenta mayorista está en revisión.</p>
      ) : (
        <>
          {comprador?.estado === "rechazado" && (
            <p className="text-sm" role="status">La tienda no aprobó tu pedido{comprador.motivo ? `: ${comprador.motivo}` : "."} Podés volver a pedirlo.</p>
          )}
          <p className="text-sm" style={tenue}>
            {mayorista.modo === "exclusivo" ? "Esta tienda vende sólo a mayoristas." : "¿Comprás para tu negocio?"} Pedí tu cuenta y la tienda te asigna tus precios.
          </p>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => void solicitar(e)}>
            <label className="text-xs space-y-1">Razón social
              <input required value={razonSocial} onChange={e => setRazonSocial(e.target.value.slice(0, 200))} className="w-full border px-3 py-2 text-sm bg-transparent" style={borde} />
            </label>
            <label className="text-xs space-y-1">CUIT
              <input required inputMode="numeric" value={cuit} onChange={e => setCuit(e.target.value.replace(/[^0-9-]/g, "").slice(0, 13))} placeholder="30-12345678-9" className="w-full border px-3 py-2 text-sm bg-transparent" style={borde} />
            </label>
            <label className="text-xs space-y-1">Teléfono (opcional)
              <input value={telefono} onChange={e => setTelefono(e.target.value.slice(0, 40))} className="w-full border px-3 py-2 text-sm bg-transparent" style={borde} />
            </label>
            <label className="text-xs space-y-1">Mensaje (opcional)
              <input value={mensaje} onChange={e => setMensaje(e.target.value.slice(0, 1000))} placeholder="Rubro, volumen…" className="w-full border px-3 py-2 text-sm bg-transparent" style={borde} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={enviando} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold"
                style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}>
                {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Pedir cuenta mayorista
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
