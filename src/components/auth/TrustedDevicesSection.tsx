import { useCallback, useEffect, useRef, useState } from 'react';
import { Laptop, Loader2, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { TrustedDeviceError, canRememberDevice, trustedDeviceCommand } from '@/lib/trustedDevice';

type Device = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

interface Props {
  userId: string | undefined;
  hasVerifiedMfa: boolean;
  onRequireFreshMfa: () => Promise<boolean>;
}

function dateLabel(value: string | undefined): string {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sin registro' : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function safeError(error: unknown, fallback: string): string {
  return error instanceof TrustedDeviceError ? error.message : fallback;
}

export default function TrustedDevicesSection({ userId, hasVerifiedMfa, onRequireFreshMfa }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>();
  const [trusted, setTrusted] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const requestGeneration = useRef(0);
  const activeUserId = useRef(userId);
  activeUserId.current = userId;

  const refresh = useCallback(async (initial = false) => {
    const generation = ++requestGeneration.current;
    if (!userId || !hasVerifiedMfa || !canRememberDevice()) {
      setDevices([]);
      setCurrentDeviceId(undefined);
      setTrusted(false);
      setExpiresAt(undefined);
      setError(undefined);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await trustedDeviceCommand('list');
      if (generation !== requestGeneration.current) return;
      setDevices(result.devices ?? []);
      setCurrentDeviceId(result.currentDeviceId);
      setTrusted(result.trusted);
      setExpiresAt(result.expiresAt);
      setError(undefined);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(safeError(cause, 'No pudimos cargar tus dispositivos. Reintentá.'));
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId, hasVerifiedMfa]);

  useEffect(() => {
    setDevices([]);
    setCurrentDeviceId(undefined);
    setTrusted(false);
    setExpiresAt(undefined);
    setBusy(undefined);
    void refresh(true);
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  const remember = async () => {
    if (!userId || !hasVerifiedMfa || busy) return;
    const forUser = userId;
    const verified = await onRequireFreshMfa();
    if (!verified || activeUserId.current !== forUser) return;
    setBusy('register');
    try {
      const result = await trustedDeviceCommand('register');
      if (activeUserId.current !== forUser) return;
      if (!result.trusted) throw new TrustedDeviceError('TRUST_UNAVAILABLE');
      setTrusted(true);
      setExpiresAt(result.expiresAt);
      toast.success('Este navegador se recordará durante 7 días.');
      await refresh();
    } catch (cause) {
      if (activeUserId.current !== forUser) return;
      setError(safeError(cause, 'No pudimos recordar este navegador. Reintentá.'));
    } finally {
      if (activeUserId.current === forUser) setBusy(undefined);
    }
  };

  const revoke = async (id: string) => {
    if (!userId || busy) return;
    const forUser = userId;
    setBusy(id);
    try {
      await trustedDeviceCommand('revoke', id === currentDeviceId ? undefined : id);
      if (activeUserId.current !== forUser) return;
      toast.success(id === currentDeviceId ? 'Este navegador ya no está recordado.' : 'Dispositivo revocado.');
      await refresh();
    } catch (cause) {
      if (activeUserId.current !== forUser) return;
      setError(safeError(cause, 'No pudimos revocar el dispositivo. Reintentá.'));
    } finally {
      if (activeUserId.current === forUser) setBusy(undefined);
    }
  };

  const revokeAll = async () => {
    if (!userId || busy) return;
    const forUser = userId;
    setBusy('all');
    try {
      await trustedDeviceCommand('revoke_all');
      if (activeUserId.current !== forUser) return;
      toast.success('Todos los dispositivos recordados fueron revocados.');
      await refresh();
    } catch (cause) {
      if (activeUserId.current !== forUser) return;
      setError(safeError(cause, 'No pudimos revocar los dispositivos. Reintentá.'));
    } finally {
      if (activeUserId.current === forUser) setBusy(undefined);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border/70 bg-card p-5 shadow-card" aria-labelledby="trusted-devices-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="trusted-devices-title" className="flex items-center gap-2 text-sm font-semibold"><Laptop className="h-4 w-4 text-primary" /> Dispositivos recordados</h2>
          <p className="mt-1 text-xs text-muted-foreground">En tus dispositivos de confianza, el acceso no pedirá el código 2FA durante 7 días. Los cambios de seguridad seguirán pidiéndolo.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing || loading} aria-label="Actualizar dispositivos recordados">
          <RotateCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </div>

      {!canRememberDevice() && <p className="text-xs text-muted-foreground">El acceso recordado está disponible en el navegador web.</p>}
      {canRememberDevice() && !hasVerifiedMfa && <p className="text-xs text-muted-foreground">Activá 2FA para poder recordar este navegador.</p>}
      {canRememberDevice() && hasVerifiedMfa && !trusted && (
        <Button type="button" size="sm" onClick={() => void remember()} disabled={busy !== undefined || loading}>
          {busy === 'register' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Recordar este navegador por 7 días
        </Button>
      )}
      {trusted && <p className="text-xs text-emerald-700 dark:text-emerald-300">Este navegador está recordado hasta {dateLabel(expiresAt)}.</p>}
      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error} <Button type="button" variant="link" size="sm" className="h-auto px-1 text-xs" onClick={() => void refresh()} disabled={refreshing}>Reintentar</Button></div>}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Cargando dispositivos...</div>
      ) : !hasVerifiedMfa || !canRememberDevice() ? null : devices.length === 0 ? (
        !error && <p className="text-xs text-muted-foreground">Todavía no hay dispositivos recordados.</p>
      ) : (
        <div className="space-y-2">
          {devices.map(device => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{device.label || 'Dispositivo sin nombre'} {device.id === currentDeviceId && <span className="text-xs font-normal text-primary">· Este navegador</span>}</p>
                <p className="text-xs text-muted-foreground">Agregado: {dateLabel(device.createdAt)} · Último uso: {dateLabel(device.lastUsedAt)} · Vence: {dateLabel(device.expiresAt)}</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button type="button" size="sm" variant="outline" disabled={busy !== undefined}><Trash2 className="mr-1.5 h-3.5 w-3.5" />{device.id === currentDeviceId ? 'Olvidar' : 'Revocar'}</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{device.id === currentDeviceId ? '¿Olvidar este navegador?' : '¿Revocar este dispositivo?'}</AlertDialogTitle>
                    <AlertDialogDescription>En el próximo inicio de sesión deberá verificarse nuevamente con el código de la app de autenticación.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void revoke(device.id)}>Confirmar</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy !== undefined}>Revocar todos</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>¿Revocar todos los dispositivos?</AlertDialogTitle><AlertDialogDescription>La próxima vez que se inicie sesión en cada dispositivo, habrá que ingresar nuevamente un código 2FA.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void revokeAll()}>Revocar todos</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </section>
  );
}
