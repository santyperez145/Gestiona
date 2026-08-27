/**
 * El certificado de AFIP de la plataforma — C14.
 *
 * Vive acá y no en Ajustes de una organización porque es de la plataforma: con
 * él se emiten los comprobantes de todos los comercios que delegaron `wsfe`.
 *
 * ⚠️ La clave privada **entra y no vuelve**. Se manda a `afip-platform-cert` y
 * se guarda en una tabla con RLS y cero policies; esta pantalla lee
 * `afip_platform_status`, que dice si está cargado y cuándo vence el ticket,
 * nunca el contenido.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformAccess } from '@/lib/usePermissions';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FileText, ShieldCheck, ShieldAlert, Loader2, Save, Trash2, Info,
  Building2, KeyRound, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import { usePageTitle } from '@/hooks/usePageTitle';
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

interface Estado {
  cuit: string | null;
  razon_social: string | null;
  environment: string;
  configured: boolean;
  ta_expires_at: string | null;
  ticket_vigente: boolean;
  updated_at: string | null;
  comercios_delegados: number;
}

export default function PlatformAfipPage() {
  usePageTitle('AFIP · Plataforma');
  const { isSuperadmin, loading: accessLoading } = usePlatformAccess();

  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const [cuit, setCuit] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [environment, setEnvironment] = useState('homologacion');
  const [certificate, setCertificate] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from('afip_platform_status')
      .select('*')
      .maybeSingle();

    // ⚠️ No se traga el error: "no tengo permiso" y "no hay nada cargado" son
    // problemas opuestos y muestran la misma pantalla vacía si se confunden.
    if (error && error.code !== 'PGRST116') {
      toast.error('No se pudo leer el estado de AFIP: ' + error.message);
      setCargando(false);
      return;
    }

    const e = (data ?? null) as Estado | null;
    setEstado(e);
    if (e) {
      setCuit(e.cuit ?? '');
      setRazonSocial(e.razon_social ?? '');
      setEnvironment(e.environment ?? 'homologacion');
    }
    setCargando(false);
  }, []);

  useEffect(() => { if (isSuperadmin) void cargar(); }, [isSuperadmin, cargar]);

  const guardar = async () => {
    if (!certificate.trim() || !privateKey.trim()) {
      toast.error('Falta el certificado o la clave privada');
      return;
    }
    setGuardando(true);
    const { data, error } = await supabase.functions.invoke('afip-platform-cert', {
      body: { cuit, razonSocial, environment, certificate, privateKey },
    });
    setGuardando(false);

    if (error || data?.error) {
      toast.error(await mensajeDeEdgeFunction(error, data) || 'No se pudo guardar');
      return;
    }
    // El PEM se borra del formulario apenas se guarda: no hay motivo para que
    // siga en memoria del navegador.
    setCertificate('');
    setPrivateKey('');
    toast.success('Certificado de plataforma guardado');
    void cargar();
  };

  const borrar = async () => {
    if (!confirm('¿Borrar el certificado de la plataforma? Los comercios en modo delegado dejan de poder facturar hasta que cargues otro.')) return;
    setGuardando(true);
    const { data, error } = await supabase.functions.invoke('afip-platform-cert', { body: { action: 'delete' } });
    setGuardando(false);
    if (error || data?.error) {
      toast.error(await mensajeDeEdgeFunction(error, data) || 'No se pudo borrar');
      return;
    }
    toast.success('Certificado borrado');
    void cargar();
  };

  if (accessLoading) return null;
  if (!isSuperadmin) return <Navigate to="/platform" replace />;

  const listo = estado?.configured === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AFIP de la plataforma"
        description="Un solo certificado para emitir en nombre de los comercios que delegan el servicio."
        icon={FileText}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KPICard
          label="Certificado"
          value={listo ? 'Cargado' : 'Falta'}
          icon={listo ? ShieldCheck : ShieldAlert}
          color={listo ? 'success' : 'destructive'}
          sub={estado?.environment === 'produccion' ? 'Ambiente de producción' : 'Ambiente de homologación'}
        />
        <KPICard
          label="Ticket de acceso"
          value={estado?.ticket_vigente ? 'Vigente' : 'Sin ticket'}
          icon={KeyRound}
          color={estado?.ticket_vigente ? 'success' : 'primary'}
          sub={estado?.ta_expires_at
            ? `Vence ${new Date(estado.ta_expires_at).toLocaleString('es-AR')}`
            : 'Se pide solo al facturar'}
        />
        <KPICard
          label="Comercios delegados"
          value={String(estado?.comercios_delegados ?? 0)}
          icon={Building2}
          color="blue"
          sub="Facturan con este certificado"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            <p>
              El certificado identifica un <strong>computador</strong>, no a un contribuyente.
              Quién emite se decide en cada factura con el CUIT del comercio, y ARCA lo acepta
              si ese comercio delegó el servicio <code>wsfe</code> al CUIT de la plataforma
              desde <em>Administrador de Relaciones</em>.
            </p>
            <p className="text-muted-foreground">
              Al comercio sólo le pedimos CUIT, razón social y domicilio. No sube ninguna clave.
            </p>
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href="https://www.afip.gob.ar/ws/documentacion/wsaa.asp"
              target="_blank" rel="noreferrer"
            >
              Documentación de WSAA <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pf-cuit">CUIT de la plataforma</Label>
              <Input
                id="pf-cuit" value={cuit} onChange={(e) => setCuit(e.target.value)}
                placeholder="20123456789" inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-rs">Razón social</Label>
              <Input id="pf-rs" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Ambiente</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacion">Homologación (pruebas)</SelectItem>
                  <SelectItem value="produccion">Producción (facturas reales)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-cert">Certificado (.crt en PEM)</Label>
            <Textarea
              id="pf-cert" rows={5} value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-key">Clave privada (.key en PEM)</Label>
            <Textarea
              id="pf-key" rows={5} value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Entra y no vuelve: se guarda en una tabla sin políticas de lectura. Ni siquiera
              esta pantalla puede mostrártela después.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {listo ? 'Reemplazar certificado' : 'Guardar certificado'}
            </Button>
            {listo && (
              <Button variant="outline" onClick={borrar} disabled={guardando}>
                <Trash2 className="mr-2 h-4 w-4" /> Borrar
              </Button>
            )}
            {estado?.updated_at && (
              <Badge variant="secondary">
                Actualizado {new Date(estado.updated_at).toLocaleDateString('es-AR')}
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
