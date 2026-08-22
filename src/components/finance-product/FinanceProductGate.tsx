import { AlertTriangle, CheckCircle2, Clock3, Loader2, LockKeyhole, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useFinanceProductAccess } from '@/hooks/useFinanceProductAccess';
import { useOrg } from '@/lib/orgContext';

export default function FinanceProductGate({ children }: { children: React.ReactNode }) {
  const { activeOrg } = useOrg();
  const { access, loading, requesting, error, refresh, requestAccess } = useFinanceProductAccess();

  if (loading) {
    return <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando producto y permisos...</div>;
  }

  if (error || !access) {
    return (
      <div className="mx-auto max-w-xl rounded-[12px] border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <h1 className="text-base font-semibold">No se pudo verificar el acceso</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error || 'El producto no devolvió un estado válido.'}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>Reintentar</Button>
          </div>
        </div>
      </div>
    );
  }

  if (access.allowed) return <>{children}</>;

  const requested = access.status === 'requested';
  const permissionDenied = access.blocker === 'module_permission_denied';

  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-14">
      <div className="rounded-[14px] border border-teal-500/20 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-300">
          {requested ? <Clock3 className="h-5 w-5" /> : permissionDenied ? <LockKeyhole className="h-5 w-5" /> : <ReceiptText className="h-5 w-5" />}
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-300">Gestiona Finance</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {requested ? 'Solicitud en revisión' : permissionDenied ? 'Tu rol no tiene acceso a Finanzas' : 'Activá el piloto documental'}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {requested
            ? `Gestiona recibió la solicitud de ${activeOrg?.name || 'esta organización'}. Habilitar el producto no cambia compras, deudas ni asientos: Finance usa el mismo Business Core.`
            : permissionDenied
              ? 'El producto está habilitado para la organización, pero el permiso finance.view está desactivado para tu rol. Pedile acceso a un owner o administrador.'
              : 'El piloto organiza facturas de proveedor sobre los proveedores, compras, obligaciones y ledger que ya existen. La captura nunca registra stock ni deuda sin revisión.'}
        </p>

        {!requested && !permissionDenied && (
          <div className="mt-5 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            {['Misma organización', 'Mismos proveedores', 'Mismo ledger'].map(label => (
              <div key={label} className="flex items-center gap-2 rounded-[8px] border border-border/60 bg-muted/20 px-3 py-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" /> {label}
              </div>
            ))}
          </div>
        )}

        {access.canRequest && (
          <Button
            className="mt-6 bg-teal-600 text-white hover:bg-teal-700"
            disabled={requesting}
            onClick={async () => {
              if (await requestAccess()) toast.success('Solicitud de Finance enviada');
            }}
          >
            {requesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Solicitar acceso al piloto
          </Button>
        )}
      </div>
    </div>
  );
}
