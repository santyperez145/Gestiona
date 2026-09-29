import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarClock, Check, Clock, FileSignature, ShieldAlert, Wallet, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import BrandLogo from '@/components/shared/BrandLogo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Aceptación pública de contrato por token (Go-Marz parity).
 *
 * El creador sin cuenta acepta las condiciones desde un enlace personal e
 * intransferible. El token expone SOLO las condiciones de ese contrato: ni
 * otros contratos, ni costos internos, ni PII de la marca. La firma es un
 * nombre declarado + timestamp, versionado en la base.
 */

type ContractData = {
  id: string;
  influencer_name: string;
  org_name: string | null;
  contract_type: 'fixed' | 'percentage' | 'hybrid';
  contract_amount: number;
  commission_percent: number;
  valid_from: string;
  valid_until: string | null;
  status: string;
  version: number;
  notes: string | null;
  creator_accepted: boolean;
  brand_accepted_at: string | null;
};

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

export default function InfluencerContractAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const [contract, setContract] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [firma, setFirma] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ is_signed: boolean } | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        // RPC aún no desplegada en la base (bundle de migraciones pendiente):
        // se llama con cast para no acoplar el tipo del frontend a la migración.
        const { data, error: rpcError } = await (supabase as any).rpc('get_influencer_contract_by_token', { p_token: token });
        if (rpcError) throw rpcError;
        if (!data) { setError('El enlace no corresponde a un contrato vigente.'); return; }
        setContract(data as ContractData);
      } catch {
        setError('No pudimos leer el contrato. Pedile a la marca un enlace nuevo.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    const nombre = firma.trim();
    if (nombre.length < 2) { setError('Escribí tu nombre completo para firmar.'); return; }
    setBusy(true); setError(null);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc('accept_influencer_contract_by_token', {
        p_token: token,
        p_signature_name: nombre,
      });
      if (rpcError) throw rpcError;
      setResult(data as { is_signed: boolean });
      setContract(prev => prev ? { ...prev, creator_accepted: true } : prev);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (message.includes('contract_not_acceptable')) setError('Este contrato ya no admite aceptación. Contactate con la marca.');
      else if (message.includes('signature_required')) setError('Escribí tu nombre completo para firmar.');
      else setError('No pudimos registrar tu aceptación. Intentá nuevamente.');
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

  if (error && !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-2xl font-display font-bold">Contrato no disponible</h1>
          <p className="text-muted-foreground mt-2 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!contract) return null;

  const yaAceptado = contract.creator_accepted || result;
  const condiciones =
    contract.contract_type === 'fixed' ? `Monto fijo de ${fmtMoney(Number(contract.contract_amount))}` :
    contract.contract_type === 'percentage' ? `${Number(contract.commission_percent)}% por venta` :
    `${fmtMoney(Number(contract.contract_amount))} + ${Number(contract.commission_percent)}% por venta`;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">
        <BrandLogo eager className="mb-8 flex justify-center" markClassName="h-7 w-7" nameClassName="text-[15px] text-foreground/80" />
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Condiciones de colaboración</p>
            <h1 className="mt-2 text-2xl font-display font-bold">{contract.influencer_name ?? 'Creador'}</h1>
            {contract.org_name && <p className="mt-1 text-sm text-muted-foreground">{contract.org_name} te propuso un acuerdo de comisiones.</p>}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-primary" /> {condiciones}</p>
              <Badge variant="outline" className="text-[10px]">Versión {contract.version}</Badge>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Vigente desde {fmtDate(contract.valid_from)}
              {contract.valid_until ? ` hasta ${fmtDate(contract.valid_until)}` : ' sin vencimiento'}
            </p>
            {contract.brand_accepted_at && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                {contract.org_name} ya aceptó esta versión el {fmtDate(contract.brand_accepted_at)}
              </p>
            )}
            {contract.notes && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words border-t border-border pt-2">{contract.notes}</p>
            )}
          </div>

          {yaAceptado ? (
            <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center" role="status">
              <Check className="h-5 w-5 mx-auto text-emerald-600" />
              <p className="mt-1.5 text-sm font-medium">Aceptaste esta versión del contrato</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result?.is_signed
                  ? 'Ambas partes firmaron: el acuerdo está vigente.'
                  : `La marca verá tu firma y el acuerdo queda vigente cuando complete la suya.`}
              </p>
            </div>
          ) : (
            <>
              <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                Al aceptar confirmás estas condiciones de la versión {contract.version}. Si la marca cambia
                el monto o el porcentaje después, el enlace deja de valer y vas a recibir uno nuevo con la
                versión actualizada para decidir de nuevo.
              </p>
              {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
              <form onSubmit={accept} className="mt-4 space-y-3">
                <input
                  type="text"
                  value={firma}
                  onChange={e => setFirma(e.target.value)}
                  placeholder="Tu nombre completo (firma declarada)"
                  maxLength={120}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                  required
                />
                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => window.history.back()}>
                    <X className="mr-2 h-4 w-4" /> No acepto
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Clock className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
                    Aceptar y firmar
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Enlace personal e intransferible · No compartas las condiciones fuera de tu acuerdo
        </p>
      </div>
    </div>
  );
}