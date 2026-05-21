import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Mail, Check, AlertTriangle } from 'lucide-react';

export default function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data: inv } = await supabase.from('org_invitations').select('*').eq('token', token).maybeSingle();
      if (!inv) { setError('Invitación no encontrada o ya usada'); setLoading(false); return; }
      if (inv.accepted_at) { setError('Esta invitación ya fue aceptada'); setLoading(false); return; }
      if (new Date(inv.expires_at) < new Date()) { setError('La invitación expiró'); setLoading(false); return; }
      const { data: o } = await supabase.from('organizations').select('id, name, logo_url').eq('id', inv.org_id).maybeSingle();
      setInvite(inv); setOrg(o); setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    if (!user || !invite) return;
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      setError(`Esta invitación es para ${invite.email}. Iniciá sesión con esa cuenta.`);
      return;
    }
    setAccepting(true);
    const { error: memErr } = await supabase.from('memberships').insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
    });
    if (memErr && !memErr.message.includes('duplicate')) {
      toast.error(memErr.message); setAccepting(false); return;
    }
    await supabase.from('org_invitations').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id);
    localStorage.setItem('gestiona.activeOrgId', invite.org_id);
    toast.success(`¡Bienvenido a ${org?.name}!`);
    window.location.href = '/';
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'hsl(228 28% 4.5%)' }}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'hsl(228 28% 4.5%)' }}>
      <div className="absolute inset-x-0 top-0 h-[300px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(38 82% 52% / 0.05) 0%, transparent 70%)' }} />

      <div className="w-full max-w-[420px] relative z-10">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-7 h-7 rounded-[5px] flex items-center justify-center"
            style={{ background: 'var(--gradient-gold)' }}>
            <span className="font-display font-black text-[12px]" style={{ color: 'hsl(225 22% 6%)' }}>G</span>
          </div>
          <span className="font-display font-semibold text-[15px] tracking-tight text-foreground/80">Gestiona</span>
        </div>

        {/* Card */}
        <div className="rounded-[10px] border border-border/60 p-8 text-center relative overflow-hidden"
          style={{ background: 'hsl(228 24% 7%)' }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

          {error ? (
            <>
              <div className="w-12 h-12 rounded-[8px] bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto mb-5">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <h1 className="font-display text-[1.2rem] font-bold tracking-tight mb-2">Algo salió mal</h1>
              <p className="text-[12px] text-muted-foreground/60 mb-6 leading-relaxed">{error}</p>
              <Button onClick={() => navigate('/')} variant="outline" className="w-full">Ir al inicio</Button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-[8px] bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-primary/60 mb-2">Invitación recibida</p>
              <h1 className="font-display text-[1.3rem] font-bold tracking-tight mb-3">
                Te invitaron a {org?.name}
              </h1>
              <p className="text-[12px] text-muted-foreground/60 mb-6 leading-relaxed">
                Vas a unirte como <strong className="text-foreground font-semibold">{invite.role}</strong> con el email{' '}
                <span className="font-mono text-foreground/80">{invite.email}</span>.
              </p>
              {!user ? (
                <Button onClick={() => navigate(`/?invite=${token}`)} className="w-full">
                  Iniciar sesión para aceptar
                </Button>
              ) : (
                <Button onClick={accept} disabled={accepting} className="w-full">
                  {accepting ? 'Aceptando...' : <><Check className="w-4 h-4 mr-1.5" /> Aceptar invitación</>}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
