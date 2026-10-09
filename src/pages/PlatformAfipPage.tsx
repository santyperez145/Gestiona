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
  Building2, KeyRound, ExternalLink, Clock, RefreshCw, CheckCircle2,
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
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import FilePicker from "@/components/shared/FilePicker";
import { vencimientoCertificado } from '@/lib/certificateExpiry';

interface Estado {
  cuit: string | null;
  razon_social: string | null;
  environment: string;
  configured: boolean;
  ta_expires_at: string | null;
  ticket_vigente: boolean;
  updated_at: string | null;
  comercios_delegados: number;
  certificate_not_before: string | null;
  certificate_expires_at: string | null;
  certificate_fingerprint_sha256: string | null;
  certificate_valid: boolean | null;
}

interface SolicitudDelegacion {
  org_id: string;
  organization_name: string;
  cuit: string | null;
  razon_social: string | null;
  punto_venta: number | null;
  environment: string | null;
  delegacion_solicitada_at: string;
  delegacion_revisada_at: string | null;
  delegacion_verificada: boolean | null;
  delegacion_verificada_at: string | null;
  last_error: string | null;
  estado: 'pendiente' | 'requiere_correccion' | 'verificada';
}

export default function PlatformAfipPage() {
  usePageTitle('AFIP · Plataforma');
  const { isSuperadmin, loading: accessLoading } = usePlatformAccess();
  const { ask, dialog } = useConfirmDialog();

  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [solicitudes, setSolicitudes] = useState<SolicitudDelegacion[]>([]);
  const [verificandoOrg, setVerificandoOrg] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [verificationErrors, setVerificationErrors] = useState<Record<string, string>>({});

  const [cuit, setCuit] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [environment, setEnvironment] = useState('homologacion');
  const [certificate, setCertificate] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const leerArchivoPem = async (file: File | undefined, destino: 'certificate' | 'privateKey') => {
    if (!file) return;
    if (file.size > 128 * 1024) {
      toast.error('El archivo supera 128 KB y no parece un PEM válido');
      return;
    }
    try {
      const content = await file.text();
      if (destino === 'certificate') setCertificate(content);
      else setPrivateKey(content);
      toast.success(`${file.name} cargado para validar`);
    } catch {
      toast.error(`No se pudo leer ${file.name}`);
    }
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    setStatusError(null);
    setQueueError(null);
    try {
      const [statusResult, queueResult] = await Promise.all([
        supabase.from('afip_platform_status').select('*').maybeSingle(),
        supabase.from('platform_afip_delegation_queue').select('*')
          .order('delegacion_solicitada_at', { ascending: false }),
      ]);
      const { data, error } = statusResult;
      if (error) {
        console.error('[ARCA Platform] status read failed', { code: error.code });
        setStatusError('No pudimos actualizar el estado del certificado. Reintentá sin reemplazarlo.');
      }
      if (queueResult.error) {
        console.error('[ARCA Platform] queue read failed', { code: queueResult.error.code });
        setQueueError('No pudimos actualizar las solicitudes. Reintentá; este error no significa que la cola esté vacía.');
      } else {
        setSolicitudes((queueResult.data || []) as SolicitudDelegacion[]);
      }
      if (!error) {
        const e = (data ?? null) as Estado | null;
        setEstado(e);
        if (e) {
          setCuit(e.cuit ?? '');
          setRazonSocial(e.razon_social ?? '');
          setEnvironment(e.environment ?? 'homologacion');
        }
      }
    } catch {
      console.error('[ARCA Platform] fiscal reads unavailable');
      setStatusError('No pudimos consultar el estado fiscal. Reintentá sin cambiar el certificado.');
      setQueueError('No pudimos consultar las solicitudes. Volvé a intentar.');
    } finally {
      setCargando(false);
    }
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
      toast.error(await mensajeDeEdgeFunction(error, data, "platform") || 'No se pudo guardar');
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
    if (!(await ask({
      title: "¿Borrar el certificado de la plataforma?",
      description: "Los comercios en modo delegado dejan de poder facturar hasta que cargues otro.",
      confirmText: "Borrar",
    }))) return;
    setGuardando(true);
    const { data, error } = await supabase.functions.invoke('afip-platform-cert', { body: { action: 'delete' } });
    setGuardando(false);
    if (error || data?.error) {
      toast.error(await mensajeDeEdgeFunction(error, data, "platform") || 'No se pudo borrar');
      return;
    }
    toast.success('Certificado borrado');
    void cargar();
  };

  const verificarDelegacion = async (solicitud: SolicitudDelegacion) => {
    if (!isSuperadmin || verificandoOrg) return;
    setVerificandoOrg(solicitud.org_id);
    setVerificationErrors(previous => ({ ...previous, [solicitud.org_id]: '' }));
    try {
      const { data, error } = await supabase.functions.invoke('afip-authorize', {
        body: { action: 'verificar_delegacion', org_id: solicitud.org_id },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        const detalle = await mensajeDeEdgeFunction(error, data);
        setVerificationErrors(previous => ({ ...previous, [solicitud.org_id]: detalle || 'ARCA todavía no aceptó la conexión' }));
        toast.error(detalle || 'ARCA todavía no aceptó la conexión');
        await cargar();
        return;
      }
      toast.success(`Conexión de ${solicitud.organization_name} verificada en ${solicitud.environment === 'produccion' ? 'producción' : 'homologación (sin valor fiscal)'}`);
      await cargar();
    } catch {
      console.error('[ARCA Platform] verification request unavailable');
      setVerificationErrors(previous => ({ ...previous, [solicitud.org_id]: 'No pudimos consultar ARCA. La solicitud se conserva; reintentá en unos minutos.' }));
    } finally {
      setVerificandoOrg(null);
    }
  };

  if (accessLoading) return null;
  if (!isSuperadmin) return <Navigate to="/platform" replace />;

  const listo = estado?.configured === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ARCA de la plataforma"
        eyebrow="Nerqia · Plataforma"
        description="Un solo certificado para emitir en nombre de los comercios que delegan el servicio."
        icon={FileText}
      />

      {listo && (() => {
        const venc = vencimientoCertificado(estado?.certificate_expires_at);
        if (venc.nivel === "ok") return null;
        const tono = venc.nivel === "aviso" || venc.nivel === "desconocido"
          ? "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200"
          : "border-destructive/30 bg-destructive/5 text-destructive";
        return (
          <div role="alert" className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${tono}`}>
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>Certificado de la plataforma.</strong> {venc.mensaje}{estado?.comercios_delegados ? ` Afecta a ${estado.comercios_delegados} comercio${estado.comercios_delegados === 1 ? "" : "s"} delegado${estado.comercios_delegados === 1 ? "" : "s"}.` : ""}</span>
          </div>
        );
      })()}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          label="Certificado"
          value={cargando ? '…' : statusError ? 'Sin actualizar' : listo ? 'Cargado' : 'Falta'}
          icon={listo ? ShieldCheck : ShieldAlert}
          color={listo ? 'success' : 'destructive'}
          sub={estado?.certificate_expires_at
            ? `Vence ${new Date(estado.certificate_expires_at).toLocaleDateString('es-AR')}`
            : estado?.environment === 'produccion' ? 'Producción · vigencia sin registrar' : 'Homologación · vigencia sin registrar'}
        />
        <KPICard
          label="Ticket de acceso"
          value={cargando ? '…' : statusError ? 'Sin actualizar' : estado?.ticket_vigente ? 'Vigente' : 'Sin ticket'}
          icon={KeyRound}
          color={estado?.ticket_vigente ? 'success' : 'primary'}
          sub={estado?.ta_expires_at
            ? `Vence ${new Date(estado.ta_expires_at).toLocaleString('es-AR')}`
            : 'Se pide solo al facturar'}
        />
        <KPICard
          label="Comercios delegados"
          value={cargando ? '…' : statusError ? 'Sin actualizar' : String(estado?.comercios_delegados ?? 0)}
          icon={Building2}
          color="blue"
          sub="Facturan con este certificado"
        />
        <KPICard
          label="Activaciones pendientes"
          value={cargando ? '…' : queueError ? 'Sin actualizar' : String(solicitudes.filter(item => item.estado !== 'verificada').length)}
          icon={Clock}
          color="primary"
          sub="Requieren aceptación y prueba"
        />
      </div>

      {statusError && <p role="alert" className="text-sm text-destructive">{statusError}</p>}
      <section aria-label="Activaciones fiscales" className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">Activaciones solicitadas</h2>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Para cada comercio: aceptá la designación en Administrador de Relaciones,
              autorizá el computador fiscal correspondiente al alias del certificado y
              recién después ejecutá la verificación de sólo lectura.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
        {queueError && <p role="alert" className="p-4 text-sm text-destructive">{queueError}</p>}
        {cargando && solicitudes.length === 0 ? <p role="status" className="p-4 text-sm text-muted-foreground">Consultando solicitudes…</p> : !queueError && solicitudes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No hay solicitudes de activación.</p>
        ) : (
          <div className="divide-y divide-border">
            {solicitudes.map((solicitud) => {
              const verificando = verificandoOrg === solicitud.org_id;
              return (
                <div key={solicitud.org_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{solicitud.organization_name}</p>
                      <Badge variant="outline" className={solicitud.estado === 'verificada' ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : undefined}>
                        {solicitud.estado === 'verificada' ? 'Verificada'
                          : solicitud.estado === 'requiere_correccion' ? 'Requiere corrección'
                            : 'Pendiente'}
                      </Badge>
                      <Badge variant="outline">{solicitud.environment === 'produccion' ? 'Producción' : 'Homologación'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      CUIT {solicitud.cuit || 'sin informar'} · Punto de venta {solicitud.punto_venta || '—'} ·
                      solicitada {new Date(solicitud.delegacion_solicitada_at).toLocaleString('es-AR')}
                    </p>
                    {solicitud.last_error && solicitud.estado !== 'verificada' && (
                      <p className="max-w-3xl text-xs text-destructive">ARCA: {solicitud.last_error}</p>
                    )}
                    {verificationErrors[solicitud.org_id] && <p role="alert" className="max-w-3xl text-sm text-destructive break-words">{verificationErrors[solicitud.org_id]}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href="https://auth.afip.gob.ar/contribuyente_/login.xhtml" target="_blank" rel="noreferrer">
                        Abrir ARCA <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {solicitud.estado !== 'verificada' && (
                      <Button size="sm" onClick={() => void verificarDelegacion(solicitud)} disabled={!!verificandoOrg}>
                        {verificando
                          ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          : <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
                        Verificar con ARCA
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
            <p className="text-muted-foreground">
              El <strong>CSR se sube a ARCA</strong>. Acá se carga el <strong>CRT emitido</strong>
              junto con la misma <strong>KEY privada</strong> usada para generar ese CSR. La extensión
              no distingue homologación de producción; elegí el ambiente real del certificado.
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
              <Label htmlFor="pf-environment">Ambiente</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger id="pf-environment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacion">Homologación (pruebas)</SelectItem>
                  <SelectItem value="produccion">Producción (facturas reales)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-cert">Certificado (.crt en PEM)</Label>
            <FilePicker
              mode="button" accept=".crt,.cer,.pem,text/plain,application/x-x509-ca-cert"
              title="Seleccionar certificado CRT" disabled={guardando}
              onFile={(file) => leerArchivoPem(file, 'certificate')}
            />
            <Textarea
              id="pf-cert" rows={5} value={certificate}
              onChange={(e) => setCertificate(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-key">Clave privada (.key en PEM)</Label>
            <FilePicker
              mode="button" accept=".key,.pem,text/plain"
              title="Seleccionar clave privada KEY" disabled={guardando}
              onFile={(file) => leerArchivoPem(file, 'privateKey')}
            />
            <Textarea
              id="pf-key" rows={5} value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Entra y no vuelve: el servidor comprueba que CRT y KEY forman el mismo par,
              valida CUIT y vigencia, y los cifra antes de guardarlos. Ni siquiera esta pantalla
              puede mostrarlos después.
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
            {estado?.certificate_fingerprint_sha256 && (
              <Badge variant="outline" title={estado.certificate_fingerprint_sha256}>
                SHA-256 …{estado.certificate_fingerprint_sha256.slice(-12)}
              </Badge>
            )}
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
