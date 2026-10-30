/**
 * Tu contador (2026-10-30): el dueño invita a su contador al portal del
 * estudio. El contador no entra al panel: ve sólo lo fiscal, de sólo lectura,
 * y cada descarga queda en la auditoría. Se revoca cuando se quiera.
 */
import { useCallback, useEffect, useState } from "react";
import { Briefcase, Copy, Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";
import { enlaceDeInvitacion } from "@/lib/estudio";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Acceso = { id: string; email: string; estado: "activo" | "pendiente" | "vencido"; invitado_at: string; aceptado_at: string | null };

const ESTADO: Record<Acceso["estado"], string> = { activo: "con acceso", pendiente: "invitación enviada", vencido: "invitación vencida" };

export default function TuContador({ orgId }: { orgId: string }) {
  const { ask, dialog } = useConfirmDialog();
  const [accesos, setAccesos] = useState<Acceso[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [email, setEmail] = useState("");
  const [enlace, setEnlace] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("contadores_del_negocio" as never, { p_org: orgId } as never);
    if (error) {
      if (isMissingFunction(error)) { setDisponible(false); return; }
      console.error("[Tu contador]", error);
      toast.error("No se pudieron leer los accesos de tu contador");
      setAccesos([]);
      return;
    }
    setAccesos((data ?? []) as Acceso[]);
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const invitar = async () => {
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("invitar_contador" as never, { p_org: orgId, p_email: email } as never);
      if (error) throw error;
      const r = data as { token?: string; ya_tiene_acceso?: boolean };
      if (r.ya_tiene_acceso) { toast.info("Ese contador ya tiene acceso"); return; }
      const link = enlaceDeInvitacion(String(r.token));
      setEnlace(link);
      try { await navigator.clipboard.writeText(link); toast.success("Enlace copiado: mandáselo a tu contador"); }
      catch { toast.success("Invitación lista: copiá el enlace y mandáselo"); }
      setEmail("");
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo invitar");
    } finally {
      setEnviando(false);
    }
  };

  const revocar = async (a: Acceso) => {
    if (!(await ask({ title: `¿Quitarle el acceso a ${a.email}?`, description: "Deja de ver tus datos fiscales en su portal. Podés volver a invitarlo cuando quieras.", confirmText: "Quitar acceso", variant: "destructive" }))) return;
    const { error } = await supabase.rpc("revocar_contador" as never, { p_id: a.id } as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Acceso revocado");
    await cargar();
  };

  if (!disponible) return null;

  return (
    <section className="bg-card border border-border/40 rounded-xl p-5 space-y-4" aria-labelledby="tu-contador-titulo">
      <div className="flex items-start gap-3">
        <Briefcase className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 id="tu-contador-titulo" className="font-semibold">Tu contador</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Invitalo y descarga el paquete de cada mes desde su portal, sin pedirte nada. No entra a tu panel: ve sólo lo fiscal, y cada descarga queda registrada.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void invitar(); }}>
        <div className="space-y-1">
          <Label htmlFor="contador-email" className="text-xs">Email de tu contador</Label>
          <Input id="contador-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="estudio@ejemplo.com" className="h-9 w-64" />
        </div>
        <Button type="submit" size="sm" className="h-9" disabled={enviando || !email.trim()}>
          {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}Invitar
        </Button>
      </form>

      {enlace && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
          <span className="text-muted-foreground">Enlace (vale 14 días, sólo para ese email):</span>
          <code className="break-all">{enlace}</code>
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void navigator.clipboard.writeText(enlace).then(() => toast.success("Enlace copiado"))}>
            <Copy className="w-3 h-3" />Copiar
          </Button>
        </div>
      )}

      {accesos && accesos.length > 0 && (
        <ul className="divide-y divide-border/40 text-sm">
          {accesos.map(a => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{a.email} <span className="text-xs text-muted-foreground">· {ESTADO[a.estado]}</span></span>
              <span className="flex gap-1">
                {a.estado !== "activo" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEmail(a.email); }}>Reenviar</Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void revocar(a)} aria-label={`Quitar el acceso a ${a.email}`}>
                  <UserX className="w-3 h-3" />Quitar acceso
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
