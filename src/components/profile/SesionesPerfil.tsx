import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LogOut, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

/**
 * Cerrar sesión en otros lados. No existía: con un celular perdido o una
 * computadora compartida que quedó abierta, la única salida era cambiar la
 * contraseña y esperar a que venciera la sesión.
 *
 * `scope: 'others'` revoca todos los refresh tokens menos el de esta sesión;
 * `'global'` incluye el actual. Los tokens de acceso ya emitidos siguen
 * valiendo hasta que vencen (una hora como máximo en Supabase): se avisa.
 */
export default function SesionesPerfil({ ultimoAcceso }: { ultimoAcceso?: string | null }) {
  const navigate = useNavigate();
  const [confirmar, setConfirmar] = useState<"others" | "global" | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const cerrar = async (scope: "others" | "global") => {
    setTrabajando(true);
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw error;
      if (scope === "global") {
        navigate("/login", { replace: true });
        return;
      }
      toast.success("Cerraste las demás sesiones", { description: "Esta queda abierta. Las otras se cortan en menos de una hora." });
    } catch (err: any) {
      toast.error("No se pudieron cerrar las sesiones", { description: err?.message });
    } finally {
      setTrabajando(false);
      setConfirmar(null);
    }
  };

  return (
    <section className="relative space-y-4 overflow-hidden rounded-[12px] border border-border/70 bg-card p-5 shadow-card" aria-label="Sesiones abiertas">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 font-display flex items-center gap-2">
        <MonitorSmartphone className="w-3 h-3" /> Sesiones
      </p>
      <p className="text-[12px] text-muted-foreground">
        {ultimoAcceso
          ? <>Último ingreso: {new Date(ultimoAcceso).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}. </>
          : null}
        Si perdiste un dispositivo o dejaste la sesión abierta en una computadora ajena, cerrala desde acá.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" size="sm" disabled={trabajando} onClick={() => setConfirmar("others")}>
          {trabajando && confirmar === "others" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <MonitorSmartphone className="w-4 h-4 mr-1.5" />}
          Cerrar las otras sesiones
        </Button>
        <Button variant="ghost" size="sm" disabled={trabajando} onClick={() => setConfirmar("global")} className="text-destructive hover:text-destructive">
          <LogOut className="w-4 h-4 mr-1.5" />Cerrar todas, incluida esta
        </Button>
      </div>

      <ConfirmDialog
        open={confirmar !== null}
        onOpenChange={open => { if (!open && !trabajando) setConfirmar(null); }}
        title={confirmar === "global" ? "¿Cerrar todas las sesiones?" : "¿Cerrar las otras sesiones?"}
        description={confirmar === "global"
          ? "Vas a salir también de este dispositivo y tendrás que volver a ingresar en todos."
          : "Los demás dispositivos van a tener que volver a ingresar. Este sigue abierto."}
        confirmText={confirmar === "global" ? "Cerrar todas" : "Cerrar las otras"}
        cancelText="Cancelar"
        variant={confirmar === "global" ? "destructive" : "default"}
        onConfirm={() => { if (confirmar) void cerrar(confirmar); }}
      />
    </section>
  );
}
