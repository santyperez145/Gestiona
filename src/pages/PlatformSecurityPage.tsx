import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import TrustedDevicesSection from '@/components/auth/TrustedDevicesSection';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export default function PlatformSecurityPage() {
  const { user } = useAuth();
  const [hasVerifiedMfa, setHasVerifiedMfa] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    void supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!current) return;
      if (error || !data) throw error ?? new Error('MFA unavailable');
      setHasVerifiedMfa(data.all.some(factor => factor.status === 'verified' && factor.factor_type === 'totp'));
    }).catch(() => {
      if (current) setFailed(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [user?.id, retryCount]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seguridad de mi cuenta"
        description="Administrá los navegadores recordados en tu acceso personal a Nerqia."
        icon={ShieldCheck}
        eyebrow="Cuenta · Plataforma"
      />
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Verificando tu configuración de seguridad…</div>
      ) : failed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <AlertTriangle className="h-4 w-4 text-destructive" /> No pudimos cargar los factores de seguridad de tu cuenta.
          <Button type="button" size="sm" variant="outline" onClick={() => setRetryCount(value => value + 1)}><RotateCw className="mr-2 h-4 w-4" /> Reintentar</Button>
        </div>
      ) : (
        <TrustedDevicesSection
          userId={user?.id}
          hasVerifiedMfa={hasVerifiedMfa}
          allowRemember={false}
          onRequireFreshMfa={async () => false}
        />
      )}
    </div>
  );
}
