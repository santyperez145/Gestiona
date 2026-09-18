import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'react-router-dom';
import { useOrg } from '@/lib/orgContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button, Input, Select } from '@/components/ui/button';
import { SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useState } from 'react';

const DOCUMENT_TYPES: FinanceDocumentType[] = ['supplier_invoice', 'receipt', 'purchase_order', 'other'];

export default function FinanceSolicitudesPage() {
  usePageTitle('Solicitudes · Finance');
  const { activeOrg } = useOrg();
  const { online } = useNetworkStatus();

  // Estados de solicitud: pending, under_review, approved, rejected
  const [solicitudes, setSolicitudes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado para crear nueva solicitud
  const [openCreate, setOpenCreate] = useState(false);
  const [newSolicitud, setNewSolicitud] = useState<{
    title: string;
    amount: number;
    currency: 'ARS' | 'USD';
    category: string | null;
    costo_center: string | null;
    motivo: string | null;
    attachments: string[];
  }>({
    title: '',
    amount: 0,
    currency: 'ARS',
    category: null,
    costo_center: null,
    motivo: null,
    attachments: [],
  });

  const loadSolicitudes = async () => {
    if (!activeOrg?.id) return;
    const orgId = activeOrg.id;
    try {
      const { data, error } = await supabase
        .from('finance_expense_requests')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSolicitudes(data || []);
    } catch (cause) {
      setLoadError(errorMessage(cause, 'No se pudieron cargar las solicitudes'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSolicitudes();
  }, [activeOrg?.id]);

  const handleCreate = async () => {
    if (!newSolicitud.title.trim() || newSolicitud.amount <= 0) {
      toast.error('Completá título y monto mayor a cero');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('finance_create_expense_request', {
        p_org_id: activeOrg.id,
        p_title: newSolicitud.title,
        p_amount: newSolicitud.amount,
        p_currency: newSolicitud.currency,
        p_category: newSolicitud.category,
        p_cost_center: newSolicitud.costo_center,
        p_motivo: newSolicitud.motivo,
      });
      if (error) throw error;
      toast.error(String(data));
      setOpenCreate(false);
      setNewSolicitud({
        title: '',
        amount: 0,
        currency: 'ARS',
        category: null,
        costo_center: null,
        motivo: null,
        attachments: [],
      });
      void loadSolicitudes();
    } catch (cause) {
      setLoadError(errorMessage(cause, 'No se pudo crear la solicitud'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    if (!confirm('Aprobar esta solicitud y comprometer el presupuesto?')) return;
    try {
      const { error } = await supabase.rpc('finance_approve_expense_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      toast.success('Solicitud aprobada; presupuesto comprometido');
      void loadSolicitudes();
    } catch (cause) {
      setLoadError(errorMessage(cause, 'No se pudo aprobar la solicitud'));
    }
  };

  const handleReject = async (requestId: string) => {
    if (!confirm('Rechazar esta solicitud?')) return;
    try {
      const { error } = await supabase.rpc('finance_reject_expense_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      toast.success('Solicitud rechazada');
      void loadSolicitudes();
    } catch (cause) {
      setLoadError(errorMessage(cause, 'No se pudo rechazar la solicitud'));
    }
  };

  const visibleDocuments = activeOrg?.id ? solicitudes : [];
  const inboxCounts = useMemo(() => {
    const counts: any = { todos: visibleDocuments.length, revisar: 0, match: 0, borradores: 0, aprobados: 0, excepcion: 0 };
    for (const doc of visibleDocuments) {
      const status = doc.status || 'pending';
      if (counts[status] !== undefined) counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [visibleDocuments]);

  const filteredDocuments = useMemo(() =>
    sortFinanceInboxDocuments(filterFinanceInbox(visibleDocuments, inboxView, inboxQuery), inboxQuery),
    [visibleDocuments, inboxView, inboxQuery],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileClock}
        eyebrow="Finance · Solicitudes de gasto"
        title="Solicitudes pendientes de aprobación"
        description="Cada solicitud ingresa con importe, categoría y centro de costo. Puede ser aprobada (compromete presupuesto) o rechazada. Registro auditado y vinculado al Core."
      />

      <section className="border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setOpenCreate(true)}>Crear solicitud</Button>
          <Button variant="secondary" size="sm" onClick={() => void loadSolicitudes()}>Actualizar</Button>
        </div>

        {loading && <WorkspaceState kind="initial-loading" layout="embedded" title="Cargando solicitudes" loadingRows={4} />}

        {loadError && <WorkspaceState kind="error-recoverable" layout="embedded" title="Error" description={loadError} actionLabel="Reintentar" onAction={() => void loadSolicitudes()} />}

        {notice && <WorkspaceState kind="success" layout="embedded" title="Acción completada" description={notice} />}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-border bg-card">
            <thead>
              <tr className="bg-muted/20 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="p-4">Título</th>
                <th className="p-4">Monto</th>
                <th className="p-4">Moneda</th>
                <th className="p-4">Categoría</th>
                <th className="p-4">Centro de costo</th>
                <th className="p-4">Estado</th>
                <th className="p-4">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((s, i) => (
                <tr key={s.id} className="border-b transition-colors hover:bg-muted/10">
                  <td className="p-4 truncate font-medium">{s.title || 'Sin título'}</td>
                  <td className="p-4 font-mono">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: s.currency || 'ARS' }).format(s.amount || 0)}</td>
                  <td className="p-4 text-[10px] text-muted-foreground">{s.currency || 'ARS'}</td>
                  <td className="p-4">{s.category || '—'}</td>
                  <td className="p-4">{s.costo_center || '—'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 text-[10px] font-semibold rounded ${s.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : s.status === 'rejected' ? 'bg-destructive text-white' : s.status === 'pending' ? 'bg-teal-100 text-teal-800' : 'bg-warning text-amber-800'}`}>
                      {s.status === 'approved' ? 'Aprobado' : s.status === 'rejected' ? 'Rechazado' : s.status === 'pending' ? 'Pendiente' : s.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-[10px]"
                      onClick={() => handleApprove(s.id)}
                      disabled={s.status !== 'pending'}
                    >
                      {s.status === 'pending' ? 'Aprobar' : 'Finalizado'}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-[10px] text-destructive"
                      onClick={() => handleReject(s.id)}
                      disabled={s.status !== 'pending'}
                    >
                      Rechazar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal para crear solicitud */}
      {openCreate && (
        <Dialog open={openCreate} onOpenChange={(open) => setOpenCreate(open)}>
          <DialogContent className="max-w-lg sm:max-w-full">
            <DialogHeader>
              <DialogTitle>Nueva solicitud de gasto</DialogTitle>
              <p className="text-xs text-muted-foreground">Importe y categoría definirán el compromiso del presupuesto.</p>
            </DialogHeader>
            <DialogContent className="grid gap-4 p-4">
              <div className="grid grid-cols-2 gap-4">
                <Label>Título <span className="text-destructive">*</span></Label>
                <Input 
                  value={newSolicitud.title} 
                  onChange={(e) => setNewSolicitud({ ...newSolicitud, title: e.target.value })}
                  required
                />
                <Label>Monto <span className="text-destructive">*</span></Label>
                <Input 
                  type="number" 
                  value={newSolicitud.amount} 
                  onChange={(e) => setNewSolicitud({ ...newSolicitud, amount: Number(e.target.value) })}
                  min="0.01"
                />
                <Label>Divisa</Label>
                <Select 
                  value={newSolicitud.currency} 
                  onValueChange={(v) => setNewSolicitud({ ...newSolicitud, currency: v as 'ARS' | 'USD' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS (Peso argentino)</SelectItem>
                    <SelectItem value="USD">USD (Dólar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Label>Categoría</Label>
                <Input 
                  value={newSolicitud.category || ''} 
                  onChange={(e) => setNewSolicitud({ ...newSolicitud, category: e.target.value || null })}
                  placeholder="Ej. proveedores, nómina, alquiler"
                />
                <Label>Centro de costo</Label>
                <Input 
                  value={newSolicitud.costo_center || ''} 
                  onChange={(e) => setNewSolicitud({ ...newSolicitud, costo_center: e.target.value || null })}
                  placeholder="Ej. marketing, operaciones, TI"
                />
              </div>

              <Label>Motivo</Label>
              <Textarea 
                value={newSolicitud.motivo || ''} 
                onChange={(e) => setNewSolicitud({ ...newSolicitud, motivo: e.target.value })}
                placeholder="Por qué se solicita este gasto"
                rows={3}
              />

              <div className="mt-4">
                <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={!newSolicitud.title.trim() || newSolicitud.amount <= 0}>
                  {loading ? <Loader2 className="animate-spin" /> : 'Crear solicitud'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </Dialog>
      )}
    </div>
  );
}