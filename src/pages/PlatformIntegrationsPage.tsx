import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Cable, CheckCircle2, Clock3, Code2, Database,
  KeyRound, Loader2, MessageSquare, Package,
  RefreshCw, Search, Server, ShoppingBag, Truck, Wallet,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePersistedState } from '@/hooks/usePersistedState';
import { usePageTitle } from '@/hooks/usePageTitle';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface IntegrationRow {
  id: string;
  integration_key: string;
  display_name: string;
  category: string;
  connection_mode: string;
  lifecycle: string;
  scope: string;
  description: string;
  capabilities: string[];
  requires_contract: boolean;
  sort_order: number;
  is_active: boolean;
}

const CATEGORY_META: Record<string, { label: string; icon: typeof Cable }> = {
  payments: { label: 'Cobros', icon: Wallet },
  tax: { label: 'Fiscal', icon: Database },
  commerce: { label: 'Canales', icon: ShoppingBag },
  messaging: { label: 'Mensajería', icon: MessageSquare },
  shipping: { label: 'Envíos', icon: Truck },
  platform: { label: 'Plataforma', icon: Server },
  automation: { label: 'Automatización', icon: Code2 },
};

const LIFECYCLE_META: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  production: { label: 'Producción', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  beta: { label: 'Beta', className: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: Cable },
  needs_setup: { label: 'Requiere configuración', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: KeyRound },
  needs_contract: { label: 'Requiere contrato', className: 'text-orange-400 bg-orange-500/10 border-orange-500/20', icon: Truck },
  planned: { label: 'Planificado', className: 'text-muted-foreground bg-muted/50 border-border', icon: Clock3 },
};

const CONNECTION_LABEL: Record<string, string> = {
  oauth: 'OAuth',
  delegation: 'Delegación',
  server_config: 'Configuración server-side',
  webhook: 'Webhook',
  manual: 'Manual',
  none: 'Sin conexión',
};

const SCOPE_LABEL: Record<string, string> = {
  platform: 'Gestiona',
  merchant: 'Comercio',
  both: 'Gestiona + comercio',
};

function errorMessage(error: { message?: string } | null) {
  return error?.message || 'No se pudo leer el registro de integraciones.';
}

export default function PlatformIntegrationsPage() {
  usePageTitle('Integraciones de plataforma');
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = usePersistedState('gestiona.view.platform.integrations-search', '');
  const [category, setCategory] = usePersistedState('gestiona.view.platform.integrations-category', 'all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('platform_integration_registry')
      .select('id,integration_key,display_name,category,connection_mode,lifecycle,scope,description,capabilities,requires_contract,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('display_name', { ascending: true });

    if (queryError) {
      setError(errorMessage(queryError));
      setRows([]);
    } else {
      setRows((data || []) as IntegrationRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(row => counts.set(row.category, (counts.get(row.category) || 0) + 1));
    return Object.entries(CATEGORY_META)
      .filter(([key]) => counts.has(key))
      .map(([key, meta]) => ({ key, ...meta, count: counts.get(key) || 0 }));
  }, [rows]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return rows.filter(row => {
      const matchesCategory = category === 'all' || row.category === category;
      const matchesSearch = !normalized || [
        row.display_name,
        row.integration_key,
        row.description,
        ...row.capabilities,
      ].join(' ').toLowerCase().includes(normalized);
      return matchesCategory && matchesSearch;
    });
  }, [category, rows, search]);

  const productionCount = rows.filter(row => row.lifecycle === 'production').length;
  const setupCount = rows.filter(row => row.lifecycle === 'needs_setup' || row.lifecycle === 'needs_contract').length;
  const plannedCount = rows.filter(row => row.lifecycle === 'planned').length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        icon={Cable}
        title="Registro de integraciones"
        description="Contrato de producto para cada conexión: qué hace, cómo se conecta y qué falta para venderla. La salud de runtime se consulta en Sistema."
        badge={{ label: 'Control Plane', variant: 'default' }}
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard label="Registradas" value={rows.length} icon={Cable} color="purple" sub="integraciones activas en catálogo" />
        <KPICard label="En producción" value={productionCount} icon={CheckCircle2} color="success" sub="código operativo" />
        <KPICard label="Preparación pendiente" value={setupCount} icon={AlertTriangle} color="warning" sub="configuración o contrato" />
        <KPICard label="Planificadas" value={plannedCount} icon={Clock3} color="primary" sub="sin promesa comercial" />
      </div>

      <div className="border-b border-border/40">
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList>
            <TabsTrigger value="all">Todas <span className="ml-1 text-[10px] opacity-60">{rows.length}</span></TabsTrigger>
            {categories.map(({ key, label, count }) => (
              <TabsTrigger key={key} value={key}>{label} <span className="ml-1 text-[10px] opacity-60">{count}</span></TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por proveedor, capacidad o clave..."
            className="pl-9 h-9 bg-muted/30"
          />
        </div>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {filtered.length} de {rows.length} integraciones visibles
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/10 rounded-[8px] p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">No se pudo cargar el registro</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando integraciones...
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-[8px] py-16 text-center">
          <Cable className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-medium text-sm">No hay integraciones para este filtro</p>
          <p className="text-xs text-muted-foreground mt-1">Probá con otra categoría o limpiá la búsqueda.</p>
        </div>
      ) : (
        <div className="border border-border/60 rounded-[8px] overflow-hidden bg-card">
          <div className="hidden lg:grid grid-cols-[minmax(220px,1.4fr)_140px_170px_170px_minmax(180px,1fr)] gap-4 px-5 py-3 border-b border-border bg-muted/20 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
            <span>Integración</span>
            <span>Ámbito</span>
            <span>Conexión</span>
            <span>Estado de producto</span>
            <span>Capacidades</span>
          </div>
          <div className="divide-y divide-border/60">
            {filtered.map(row => {
              const categoryMeta = CATEGORY_META[row.category] || CATEGORY_META.platform;
              const CategoryIcon = categoryMeta.icon;
              const lifecycleMeta = LIFECYCLE_META[row.lifecycle] || LIFECYCLE_META.planned;
              const LifecycleIcon = lifecycleMeta.icon;
              return (
                <div key={row.id} className="grid lg:grid-cols-[minmax(220px,1.4fr)_140px_170px_170px_minmax(180px,1fr)] gap-4 px-4 sm:px-5 py-4 hover:bg-muted/15 transition-colors">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-[8px] bg-violet-500/10 border border-violet-500/15 text-violet-300 flex items-center justify-center shrink-0">
                      <CategoryIcon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate">{row.display_name}</p>
                        {row.requires_contract && <Truck className="w-3.5 h-3.5 text-orange-400" aria-label="Requiere contrato" />}
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">{row.integration_key}</p>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-[480px]">{row.description}</p>
                    </div>
                  </div>
                  <div className="lg:pt-1">
                    <span className="lg:hidden text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-2">Ámbito</span>
                    <span className="text-xs text-foreground/80">{SCOPE_LABEL[row.scope] || row.scope}</span>
                  </div>
                  <div className="lg:pt-1">
                    <span className="lg:hidden text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-2">Conexión</span>
                    <span className="text-xs text-foreground/80">{CONNECTION_LABEL[row.connection_mode] || row.connection_mode}</span>
                  </div>
                  <div className="lg:pt-0.5">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] border text-[11px] font-medium ${lifecycleMeta.className}`}>
                      <LifecycleIcon className="w-3 h-3" /> {lifecycleMeta.label}
                    </span>
                  </div>
                  <div className="flex items-start gap-1.5 flex-wrap lg:pt-0.5">
                    {row.capabilities.map(capability => (
                      <span key={capability} className="px-2 py-1 rounded-[5px] bg-muted/40 border border-border/50 text-[10px] text-muted-foreground font-mono">
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground/70 border-t border-border/40 pt-4">
        <Package className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>Este registro describe el alcance del producto. No indica que una cuenta de comercio esté conectada ni reemplaza la observabilidad de Sistema.</p>
      </div>
    </div>
  );
}
