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
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2, LogOut, AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { decideMfaState, type MfaDecision } from "@/lib/mfaGate";
import BrandLogo from "@/components/shared/BrandLogo";

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
  const [enrolling, setEnrolling] = useState(false);
  const [enrollment, setEnrollment] = useState<{ factorId: string; uri: string; secret: string } | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState("");

  const check = useCallback(async () => {
    try {
      const [{ data: aal, error: aalErr }, { data: factors, error: factorsErr }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      if (aalErr || factorsErr) {
        setState("unavailable");
        return;
      }
      const { decision, factorId: fid } = decideMfaState(
        aal ?? null,
        (factors?.totp ?? []).map(f => ({ id: f.id, status: f.status })),
        { isAdmin, orgRequiresMfa },
      );

      setFactorId(fid ?? null);
      setState(decision);
    } catch {
      // El acceso no se abre si no pudimos comprobar el segundo factor.
      setState("unavailable");
    }
  }, [isAdmin, orgRequiresMfa]);

  useEffect(() => { check(); }, [check]);

  const verify = async () => {
    if (!factorId || code.length !== 6) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
      await check();
    } catch {
      toast.error("Código incorrecto o vencido");
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const startEnrollment = async () => {
    setEnrolling(true);
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      // Un enrolamiento abandonado no protege la cuenta y puede impedir
      // registrar otro factor con el mismo nombre.
      for (const factor of factors?.totp ?? []) {
        if (factor.status === "verified") continue;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) throw error ?? new Error("MFA enrollment failed");
      setEnrollment({ factorId: data.id, uri: data.totp.uri, secret: data.totp.secret });
      setEnrollmentCode("");
    } catch {
      toast.error("No pudimos iniciar la verificación. Reintentá.");
    } finally {
      setEnrolling(false);
    }
  };

  const finishEnrollment = async () => {
    if (!enrollment || enrollmentCode.length !== 6) return;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollment.factorId,
        code: enrollmentCode,
      });
      if (error) throw error;
      setEnrollment(null);
      setEnrollmentCode("");
      await check();
    } catch {
      toast.error("El código no es válido o venció. Revisá tu app de autenticación.");
      setEnrollmentCode("");
    } finally {
      setVerifying(false);
    }
  };

  const cancelEnrollment = async () => {
    if (!enrollment) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    if (error) {
      toast.error("No pudimos cancelar el registro. Reintentá.");
      return;
    }
    setEnrollment(null);
    setEnrollmentCode("");
    await check();
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
        <BrandLogo eager className="border-b border-border/60 pb-4" markClassName="h-7 w-7" nameClassName="text-sm" />
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
        ) : state === "needs_enrollment" ? (
          <>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h1 className="text-base font-semibold">2FA obligatorio</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Esta organización exige verificación en dos pasos a sus administradores.
              Configurá tu app de autenticación para continuar.
            </p>
            {enrollment ? (
              <div className="space-y-3">
                <div className="flex justify-center rounded-lg bg-white p-3">
                  <QRCodeSVG value={enrollment.uri} size={176} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Escaneá el QR o ingresá esta clave en tu app: <code className="break-all">{enrollment.secret}</code>
                </p>
                <Input
                  value={enrollmentCode}
                  onChange={e => setEnrollmentCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={e => e.key === "Enter" && void finishEnrollment()}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Código de 6 dígitos"
                  aria-label="Código de la app de autenticación"
                />
                <Button className="w-full" onClick={() => void finishEnrollment()} disabled={verifying || enrollmentCode.length !== 6}>
                  {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Activar verificación
                </Button>
                <Button className="w-full" variant="ghost" onClick={() => void cancelEnrollment()} disabled={verifying}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button className="w-full" onClick={() => void startEnrollment()} disabled={enrolling}>
                {enrolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Configurar ahora
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h1 className="text-base font-semibold">No pudimos verificar tu acceso</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              No se pudo comprobar el estado de seguridad de tu sesión. Reintentá cuando vuelva la conexión.
            </p>
            <Button className="w-full" onClick={() => { setState("checking"); void check(); }}>
              Reintentar verificación
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
