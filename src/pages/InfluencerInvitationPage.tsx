import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Clock, Mail, ShieldAlert, X } from 'lucide-react';
import { getInfluencerInvitation, respondInfluencerInvitation } from '@/lib/influencersDB';
import BrandLogo from '@/components/shared/BrandLogo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type InvitationData = {
  id: string;
  status: string;
  expires_at: string;
  email: string | null;
  campaign_title: string | null;
  campaign_brief: string | null;
  campaign_due_date: string | null;
  channel: string | null;
  influencer_name: string | null;
  org_name: string | null;
};

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', multiple: 'Varias redes',
};

export default function InfluencerInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const data = await getInfluencerInvitation(token);
        if (!data) { setError('Invitación no encontrada.'); return; }
        setInvitation(data as InvitationData);
      } catch {
        setError('No pudimos leer la invitación. Pedile a la marca un enlace nuevo.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const respond = async (action: 'accept' | 'decline') => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await respondInfluencerInvitation(token, action);
      setResult(status);
      setInvitation(prev => prev ? { ...prev, status } : prev);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (message.includes('invitation_expired')) setError('La invitación expiró. Pedile a la marca que te envíe una nueva.');
      else if (message.includes('already_responded')) setError('Esta invitación ya fue respondida.');
      else setError('No pudimos registrar tu respuesta. Intentá nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-2xl font-display font-bold">Invitación no disponible</h1>
          <p className="text-muted-foreground mt-2 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!invitation) return null;

  const expired = invitation.status === 'expired' || new Date(invitation.expires_at) < new Date();
  const resolved = invitation.status === 'accepted' || invitation.status === 'declined' || result;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">
        <BrandLogo eager className="mb-8 flex justify-center" markClassName="h-7 w-7" nameClassName="text-[15px] text-foreground/80" />
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Invitación a colaborar</p>
            <h1 className="mt-2 text-2xl font-display font-bold">{invitation.influencer_name ?? 'Creador'}</h1>
            {invitation.org_name && <p className="mt-1 text-sm text-muted-foreground">{invitation.org_name} te invita a crear contenido de marca.</p>}
          </div>

          {invitation.campaign_title && (
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{invitation.campaign_title ?? 'Campaña'}</p>
                {invitation.channel && <Badge variant="outline">{CHANNEL_LABELS[invitation.channel] ?? invitation.channel}</Badge>}
              </div>
              {invitation.campaign_brief && <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{invitation.campaign_brief}</p>}
              {invitation.campaign_due_date && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Fecha objetivo: {new Date(`${invitation.campaign_due_date}T12:00:00`).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
          )}

          {resolved ? (
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 text-center" role="status">
              <p className="text-sm font-medium">
                {invitation.status === 'accepted' || result === 'accepted' ? 'Colaboración aceptada' : 'Invitación rechazada'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {invitation.status === 'accepted' || result === 'accepted'
                  ? 'La marca verá tu confirmación y coordinará los próximos pasos con vos.'
                  : 'La marca verá que rechazaste esta invitación.'}
              </p>
            </div>
          ) : invitation.status === 'expired' || expired ? (
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 text-center" role="alert">
              <p className="text-sm font-medium">Esta invitación expiró</p>
              <p className="mt-1 text-xs text-muted-foreground">Podés pedirle a la marca que te envíe una nueva.</p>
            </div>
          ) : (
            <>
              <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Responder antes del {new Date(invitation.expires_at).toLocaleDateString('es-AR')}
              </p>
              {error && <p role="alert" className="mt-3 text-center text-sm text-destructive">{error}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button variant="outline" disabled={busy} onClick={() => void respond('decline')}>
                  <X className="mr-2 h-4 w-4" /> No puedo
                </Button>
                <Button disabled={busy} onClick={() => void respond('accept')}>
                  <Check className="mr-2 h-4 w-4" /> Aceptar
                </Button>
              </div>
            </>
          )}
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5" /> {invitation.email ?? 'Enlace personal e intransferible'}
        </p>
      </div>
    </div>
  );
}