import { useEffect, useState } from "react";
import { CheckCircle, KeyRound, Loader2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { checkPassword, MIN_PASSWORD_LENGTH, passwordValidationMessage } from "@/lib/passwordSecurity";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";

export default function StorePasswordRecovery() {
  const { basePath } = useStore();
  const { loading, session, passwordRecovery, updatePassword } = useStoreAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationTimedOut, setValidationTimedOut] = useState(false);
  const passwordCheck = checkPassword(password);
  const accountPath = basePath ? `${basePath}/cuenta` : "/cuenta";
  const linkSignalsRecovery = location.hash.includes("type=recovery")
    || new URLSearchParams(location.search).has("code");
  const recoveryReady = Boolean(session && passwordRecovery);

  useEffect(() => {
    if (!linkSignalsRecovery || recoveryReady) return;
    const timer = window.setTimeout(() => setValidationTimedOut(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [linkSignalsRecovery, recoveryReady]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => navigate(accountPath, { replace: true }), 1_800);
    return () => window.clearTimeout(timer);
  }, [accountPath, navigate, success]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const passwordError = passwordValidationMessage(password);
    if (passwordError) { setError(passwordError); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }
    setSaving(true);
    const result = await updatePassword(password);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    setSuccess(true);
  };

  const shell = "storefront-account mx-auto max-w-md px-4 py-16";
  const cardStyle = {
    borderColor: "hsl(var(--st-border))",
    borderRadius: "var(--st-radius)",
    background: "hsl(var(--st-surface))",
  } as React.CSSProperties;
  const inputStyle = {
    borderColor: "hsl(var(--st-border))",
    borderRadius: "var(--st-radius)",
  } as React.CSSProperties;

  if (loading || (linkSignalsRecovery && !recoveryReady && !validationTimedOut)) {
    return <div className={`${shell} grid min-h-[40vh] place-items-center`}><Loader2 className="h-6 w-6 animate-spin opacity-50" aria-label="Validando enlace" /></div>;
  }

  if (success) {
    return (
      <section className={shell}>
        <div className="border p-6 text-center" style={cardStyle} role="status">
          <CheckCircle className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
          <h1 className="text-xl font-semibold">Contraseña actualizada</h1>
          <p className="mt-2 text-sm" style={{ color: "hsl(var(--st-muted))" }}>Ya podés usarla para entrar a tu cuenta.</p>
        </div>
      </section>
    );
  }

  if (!recoveryReady) {
    return (
      <section className={shell}>
        <div className="border p-6 text-center" style={cardStyle} role="alert">
          <KeyRound className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <h1 className="text-xl font-semibold">El enlace no es válido</h1>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--st-muted))" }}>
            Puede haber vencido o ya haberse usado. Pedí uno nuevo desde tu cuenta.
          </p>
          <Link className="mt-5 inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold" to={accountPath} style={{ borderRadius: "var(--st-radius)", background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))" }}>
            Volver a mi cuenta
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={shell}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "hsl(var(--st-muted))" }}>Mi cuenta</p>
      <h1 className="text-2xl font-bold tracking-tight">Elegí una contraseña nueva</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "hsl(var(--st-muted))" }}>Al guardarla cerramos las otras sesiones para proteger tu cuenta.</p>
      <form className="mt-6 space-y-4 border p-5" style={cardStyle} onSubmit={submit}>
        <label className="block">
          <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Nueva contraseña</span>
          <input className="mt-1 w-full border bg-transparent px-3 py-2 text-sm outline-none" style={inputStyle} type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Repetir contraseña</span>
          <input className="mt-1 w-full border bg-transparent px-3 py-2 text-sm outline-none" style={inputStyle} type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-1 text-[11px]" aria-live="polite" style={{ color: "hsl(var(--st-muted))" }}>
          <span className={passwordCheck.checks.length ? "text-emerald-600" : ""}>• {MIN_PASSWORD_LENGTH}+ caracteres</span>
          <span className={passwordCheck.checks.uppercase ? "text-emerald-600" : ""}>• Una mayúscula</span>
          <span className={passwordCheck.checks.lowercase ? "text-emerald-600" : ""}>• Una minúscula</span>
          <span className={passwordCheck.checks.number ? "text-emerald-600" : ""}>• Un número</span>
        </div>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        <button className="min-h-11 w-full px-4 py-2 text-sm font-semibold disabled:opacity-60" style={{ borderRadius: "var(--st-radius)", background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))" }} type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </section>
  );
}
