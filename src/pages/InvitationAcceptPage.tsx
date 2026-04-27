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

  if (loading || authLoading) return <div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 text-center animate-fade-in-up">
        {error ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
            <h1 className="text-xl font-display font-bold mb-2">Algo salió mal</h1>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={() => navigate('/')} variant="outline" className="w-full">Ir al inicio</Button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold mb-2">Te invitaron a {org?.name}</h1>
            <p className="text-sm text-muted-foreground mb-6">Vas a unirte como <strong className="text-foreground">{invite.role}</strong> con el email <strong className="text-foreground">{invite.email}</strong>.</p>
            {!user ? (
              <Button onClick={() => navigate(`/?invite=${token}`)} className="w-full">Iniciar sesión para aceptar</Button>
            ) : (
              <Button onClick={accept} disabled={accepting} className="w-full">
                {accepting ? 'Aceptando...' : <><Check className="w-4 h-4 mr-1" /> Aceptar invitación</>}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}