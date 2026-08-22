import { useState } from 'react';
import { Clock3, HandHelping, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  ACTIVATION_INTERVENTION_OUTCOMES,
  ACTIVATION_INTERVENTION_OUTCOME_LABEL,
  ACTIVATION_INTERVENTION_TYPES,
  ACTIVATION_INTERVENTION_TYPE_LABEL,
  ACTIVATION_MILESTONES,
  ACTIVATION_MILESTONE_LABEL,
  validateActivationIntervention,
  type ActivationInterventionOutcome,
  type ActivationInterventionRow,
  type ActivationInterventionType,
  type ActivationMilestoneId,
} from '@/lib/activationCohorts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ActivationInterventionsPanelProps {
  orgId: string;
  interventions: ActivationInterventionRow[];
  canRecord: boolean;
  onChanged: () => Promise<void> | void;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Sin fecha'
    : date.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ActivationInterventionsPanel({
  orgId,
  interventions,
  canRecord,
  onChanged,
}: ActivationInterventionsPanelProps) {
  const [milestone, setMilestone] = useState<ActivationMilestoneId>('general');
  const [interventionType, setInterventionType] = useState<ActivationInterventionType>('onboarding_call');
  const [minutesSpent, setMinutesSpent] = useState(15);
  const [outcome, setOutcome] = useState<ActivationInterventionOutcome>('follow_up');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const record = async () => {
    const validationError = validateActivationIntervention({
      milestone,
      interventionType,
      minutesSpent,
      outcome,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc('record_activation_intervention', {
      p_org_id: orgId,
      p_idempotency_key: idempotencyKey,
      p_milestone: milestone,
      p_intervention_type: interventionType,
      p_minutes_spent: minutesSpent,
      p_outcome: outcome,
    });
    if (error) {
      toast.error(`No se pudo registrar la intervención: ${error.message}`);
      setSaving(false);
      return;
    }

    // La clave sólo cambia después de confirmar. Un retry por red reutiliza la
    // anterior y la base devuelve el mismo evento sin duplicar minutos.
    setIdempotencyKey(crypto.randomUUID());
    setSaving(false);
    toast.success('Intervención incorporada al costo de activación');
    await onChanged();
  };

  const voidIntervention = async (id: string) => {
    setVoidingId(id);
    const { error } = await supabase.rpc('void_activation_intervention', {
      p_intervention_id: id,
    });
    if (error) {
      toast.error(`No se pudo anular: ${error.message}`);
      setVoidingId(null);
      return;
    }
    setVoidingId(null);
    toast.success('Intervención anulada; la auditoría se conserva');
    await onChanged();
  };

  const active = interventions.filter(row => row.is_active);
  const activeMinutes = active.reduce((sum, row) => sum + Number(row.minutes_spent || 0), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-[10px] border border-violet-500/20 bg-violet-500/[0.04] p-4">
        <div className="flex items-start gap-3">
          <HandHelping className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
          <div>
            <h2 className="text-sm font-semibold">Costo de acompañamiento</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {active.length} {active.length === 1 ? 'intervención activa' : 'intervenciones activas'} · {activeMinutes} minutos.
              Sólo el trabajo anterior a la primera venta entra en la cohorte. No se guardan notas, clientes ni datos del negocio.
            </p>
          </div>
        </div>
      </section>

      {canRecord ? (
        <section className="rounded-[10px] border border-border/60 bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold">Registrar ayuda concreta</h3>
              <p className="text-[11px] text-muted-foreground">Vocabulario cerrado para medir costo sin convertir soporte en una base paralela de clientes.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label className="text-[10px] text-muted-foreground">Hito asistido</Label>
              <Select value={milestone} onValueChange={value => setMilestone(value as ActivationMilestoneId)}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVATION_MILESTONES.map(value => <SelectItem key={value} value={value}>{ACTIVATION_MILESTONE_LABEL[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Tipo de intervención</Label>
              <Select value={interventionType} onValueChange={value => setInterventionType(value as ActivationInterventionType)}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVATION_INTERVENTION_TYPES.map(value => <SelectItem key={value} value={value}>{ACTIVATION_INTERVENTION_TYPE_LABEL[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Minutos reales</Label>
              <Input
                className="mt-1 h-9 text-xs"
                type="number"
                min={1}
                max={480}
                step={1}
                value={minutesSpent}
                onChange={event => setMinutesSpent(Number(event.target.value))}
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Resultado</Label>
              <Select value={outcome} onValueChange={value => setOutcome(value as ActivationInterventionOutcome)}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVATION_INTERVENTION_OUTCOMES.map(value => <SelectItem key={value} value={value}>{ACTIVATION_INTERVENTION_OUTCOME_LABEL[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={record} disabled={saving}>
              <Clock3 className="mr-2 h-3.5 w-3.5" />{saving ? 'Registrando…' : 'Registrar intervención'}
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-[10px] border border-border/60 bg-card p-4 text-xs text-muted-foreground">
          El rol Finance puede leer el costo agregado, pero sólo Support o Superadmin pueden registrar y corregir acompañamiento.
        </section>
      )}

      <section className="overflow-hidden rounded-[10px] border border-border/60 bg-card">
        <div className="border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold">Historial auditable</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Las correcciones se anulan; nunca se borran silenciosamente.</p>
        </div>
        {interventions.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Todavía no hay acompañamiento instrumentado.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {interventions.map(row => {
              const milestoneKey = row.milestone as ActivationMilestoneId;
              const typeKey = row.intervention_type as ActivationInterventionType;
              const outcomeKey = row.outcome as ActivationInterventionOutcome;
              return (
                <article key={row.id} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(100px,.5fr)_minmax(130px,.7fr)_auto] md:items-center ${row.is_active ? '' : 'opacity-55'}`}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{ACTIVATION_INTERVENTION_TYPE_LABEL[typeKey] || row.intervention_type}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{ACTIVATION_MILESTONE_LABEL[milestoneKey] || row.milestone} · {formatDateTime(row.occurred_at)}</p>
                  </div>
                  <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Esfuerzo</p><p className="mt-0.5 text-xs font-semibold">{row.minutes_spent || 0} min</p></div>
                  <div><Badge variant="outline" className="text-[10px]">{ACTIVATION_INTERVENTION_OUTCOME_LABEL[outcomeKey] || row.outcome}</Badge></div>
                  <div className="md:text-right">
                    {!row.is_active ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Anulada</span>
                    ) : canRecord && row.id ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-muted-foreground"><RotateCcw className="mr-1 h-3 w-3" />Corregir</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Anular esta intervención?</AlertDialogTitle>
                            <AlertDialogDescription>Dejará de sumar minutos y de clasificar la activación como acompañada. El evento seguirá visible para auditoría.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => voidIntervention(row.id!)} disabled={voidingId === row.id}>Anular conservando auditoría</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
