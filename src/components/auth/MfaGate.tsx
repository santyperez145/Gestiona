/**
 * MfaGate — exige el segundo factor antes de dejar entrar a la app.
 *
 * El problema que resuelve: `signInWithPassword` devuelve una sesión válida
 * en nivel AAL1 aunque el usuario tenga TOTP enrolado. Sin este gate, activar
 * 2FA daba una sensación falsa de seguridad — con la contraseña sola se
 * entraba igual y con acceso total.
 *
 * Supabase expone el nivel actual y el requerido:
 *   currentLevel 'aal1' + nextLevel 'aal2'  → tiene factor verificado y falta
 *                                              el código: se bloquea la app.
 *   currentLevel === nextLevel              → nada que pedir.
 *
 * También cubre el enforcement por organización: si `settings.mfa_required`
 * está activo y el usuario es admin/owner **sin** ningún factor, se lo manda a
 * configurarlo antes de poder seguir.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2, LogOut, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { decideMfaState, type MfaDecision } from "@/lib/mfaGate";

type GateState = "checking" | MfaDecision;

interface Props {
  /** true si el usuario es owner/admin en la org activa */
  isAdmin: boolean;
  /** true si la org exige 2FA a sus admins */
  orgRequiresMfa: boolean;
  children: React.ReactNode;
}

export default function MfaGate({ isAdmin, orgRequiresMfa, children }: Props) {
  const [state, setState] = useState<GateState>("checking");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const navigate = useNavigate();

  const check = useCallback(async () => {
    try {
      const [{ data: aal, error: aalErr }, { data: factors }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      const { decision, factorId: fid } = decideMfaState(
        aalErr ? null : (aal ?? null),
        (factors?.totp ?? []).map(f => ({ id: f.id, status: f.status })),
        { isAdmin, orgRequiresMfa },
      );

      if (fid) setFactorId(fid);
      setState(decision);
    } catch {
      // Un fallo de red no debe dejar al dueño afuera de su propio negocio.
      setState("ok");
    }
  }, [isAdmin, orgRequiresMfa]);

  useEffect(() => { check(); }, [check]);

  const verify = async () => {
    if (!factorId || code.length !== 6) return;
    setVerifying(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setVerifying(false);
    if (error) {
      toast.error("Código incorrecto o vencido");
      setCode("");
      return;
    }
    setState("ok");
  };

  if (state === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "ok") return <>{children}</>;

  const signOut = () => supabase.auth.signOut();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 space-y-4">
        {state === "needs_code" ? (
          <>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h1 className="text-base font-semibold">Verificación en dos pasos</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Ingresá el código de 6 dígitos de tu app de autenticación.
            </p>
            <Input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && verify()}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
              className="text-center text-2xl tracking-[0.4em] font-mono h-12"
            />
            <Button onClick={verify} disabled={verifying || code.length !== 6} className="w-full">
              {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              Verificar
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h1 className="text-base font-semibold">2FA obligatorio</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Esta organización exige verificación en dos pasos a sus administradores.
              Configurá tu app de autenticación para continuar.
            </p>
            <Button className="w-full" onClick={() => { setState("ok"); navigate("/perfil"); }}>
              Configurar ahora
            </Button>
          </>
        )}

        <button
          onClick={signOut}
          className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 pt-1"
        >
          <LogOut className="w-3 h-3" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}
