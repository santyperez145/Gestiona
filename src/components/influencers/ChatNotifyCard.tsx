import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { getChatNotifyPrefs, setChatNotifyPrefs, type ChatNotifyPrefs } from '@/lib/campaignChatDB';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Consentimiento de notificaciones del chat de campañas (email/push).
 * La preferencia es por persona: sin fila en `influencer_chat_notify_prefs`
 * no hay consentimiento y el servidor no encola nada. Guardar apaga los
 * canales tan explícitamente como encenderlos.
 */
export default function ChatNotifyCard({ compact = false }: { compact?: boolean }) {
  const [prefs, setPrefs] = useState<ChatNotifyPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getChatNotifyPrefs()
      .then(p => { if (alive) setPrefs(p); })
      .catch(() => { if (alive) setPrefs({ email_enabled: false, push_enabled: false }); });
    return () => { alive = false; };
  }, []);

  const update = async (next: ChatNotifyPrefs) => {
    setSaving(true);
    try {
      const saved = await setChatNotifyPrefs(next.email_enabled, next.push_enabled);
      setPrefs(saved);
      const activos = [saved.email_enabled && 'correo', saved.push_enabled && 'push'].filter(Boolean);
      toast.success(activos.length > 0 ? `Avisos por ${activos.join(' y ')} activados` : 'Avisos desactivados');
    } catch {
      toast.error('No pudimos guardar tu preferencia. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <Card className={compact ? '' : 'mb-6'}>
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando preferencias de avisos...
        </CardContent>
      </Card>
    );
  }

  const sinConsentimiento = !prefs.email_enabled && !prefs.push_enabled;

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="notify-email" className="flex items-center gap-2 text-sm font-normal">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span>
            Correo electrónico
            <span className="block text-[11px] text-muted-foreground">
              Un aviso por mensaje nuevo en tus colaboraciones
            </span>
          </span>
        </Label>
        <Switch
          id="notify-email"
          checked={prefs.email_enabled}
          disabled={saving}
          onCheckedChange={v => update({ ...prefs, email_enabled: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="notify-push" className="flex items-center gap-2 text-sm font-normal">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span>
            Notificación push
            <span className="block text-[11px] text-muted-foreground">
              En este navegador, cuando tengas la sesión abierta
            </span>
          </span>
        </Label>
        <Switch
          id="notify-push"
          checked={prefs.push_enabled}
          disabled={saving}
          onCheckedChange={v => update({ ...prefs, push_enabled: v })}
        />
      </div>
    </div>
  );

  if (compact) return body;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          {sinConsentimiento ? <BellOff className="h-4 w-4 text-muted-foreground" /> : <Bell className="h-4 w-4 text-primary" />}
          Avisos de mensajes
        </CardTitle>
        {sinConsentimiento ? (
          <Badge variant="outline" className="text-[10px]">Sin avisos</Badge>
        ) : (
          <Badge variant="success" className="text-[10px]">Activos</Badge>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}