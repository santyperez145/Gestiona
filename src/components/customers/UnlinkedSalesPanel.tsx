import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { UserPlus, ChevronDown, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Ventas cuyo nombre no matchea ningún cliente del CRM.
 *
 * Hasta que las ventas se vincularon por id, esto no se podía ni preguntar. Y
 * es plata concreta: cada fila es alguien que ya te compró y al que no le podés
 * hacer seguimiento, ni mandarle una campaña, ni ver su historial. En una tienda
 * chica suelen ser los clientes más valiosos, cargados a las apuradas en el POS.
 *
 * Darlos de alta acá los engancha: el trigger `trg_sales_link_customer` resuelve
 * las ventas nuevas solo, y este panel además vincula las que ya existían.
 */

interface Fila {
  customer_name: string;
  ventas: number;
  total_ars: number;
  ultima_venta: string | null;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

export default function UnlinkedSalesPanel() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('sales_sin_cliente')
      .select('customer_name, ventas, total_ars, ultima_venta')
      .eq('org_id', activeOrg.id)
      .order('total_ars', { ascending: false })
      .limit(50);
    // La vista se crea en 20260731000016; si todavía no está, el panel
    // simplemente no aparece en vez de romper la página.
    if (error) { setFilas([]); setLoading(false); return; }
    setFilas((data ?? []) as unknown as Fila[]);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  async function darDeAlta(fila: Fila) {
    if (!activeOrg?.id || !user?.id) return;
    setCreando(fila.customer_name);

    const { data: nuevo, error } = await supabase
      .from('customers')
      .insert({
        org_id: activeOrg.id,
        user_id: user.id,
        name: fila.customer_name,
        tags: ['desde-ventas'],
      } as never)
      .select('id')
      .single();

    if (error || !nuevo) {
      setCreando(null);
      toast.error(error?.message ?? 'No se pudo crear el cliente');
      return;
    }

    // El trigger cubre las ventas futuras; las que ya existen se vinculan acá.
    const { error: linkErr } = await supabase
      .from('sales')
      .update({ customer_id: (nuevo as { id: string }).id } as never)
      .eq('org_id', activeOrg.id)
      .eq('customer_name', fila.customer_name)
      .is('customer_id', null);

    setCreando(null);
    if (linkErr) {
      toast.warning(`${fila.customer_name} se creó, pero sus ventas anteriores no se vincularon`);
    } else {
      toast.success(
        `${fila.customer_name} agregado`,
        { description: `Se le vincularon ${fila.ventas} ${fila.ventas === 1 ? 'venta' : 'ventas'}` },
      );
    }
    cargar();
  }

  if (loading || filas.length === 0) return null;

  const totalPerdido = filas.reduce((s, f) => s + Number(f.total_ars || 0), 0);

  return (
    <div className="bg-card border border-yellow-500/25 rounded-[10px] overflow-hidden">
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {abierto ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">
            {filas.length} {filas.length === 1 ? 'persona compró' : 'personas compraron'} y no {filas.length === 1 ? 'está' : 'están'} en tu lista
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fmt(totalPerdido)} en ventas sin posibilidad de seguimiento
          </p>
        </div>
      </button>

      {abierto && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {filas.map(f => (
            <div key={f.customer_name} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{f.customer_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {f.ventas} {f.ventas === 1 ? 'compra' : 'compras'} · {fmt(Number(f.total_ars))}
                  {f.ultima_venta && ` · última ${new Date(f.ultima_venta).toLocaleDateString('es-AR')}`}
                </p>
              </div>
              <Button
                size="sm" variant="outline" className="h-7 text-xs shrink-0"
                onClick={() => darDeAlta(f)}
                disabled={creando === f.customer_name}
              >
                {creando === f.customer_name
                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  : <UserPlus className="w-3 h-3 mr-1" />}
                Agregar
              </Button>
            </div>
          ))}
          <p className="px-4 py-2 text-[11px] text-muted-foreground">
            Al agregarlos se les vinculan sus compras anteriores y pasan a contar
            para RFM, fidelidad y campañas.
          </p>
        </div>
      )}
    </div>
  );
}
