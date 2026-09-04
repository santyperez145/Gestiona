import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Loader2,
  RotateCcw,
  Save,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import {
  parseStoreThemeVersion,
  sameStoreThemeConfig,
  storeThemePreviewPath,
  type StoreThemeConfig,
  type StoreThemeVersion,
} from '@/lib/storeThemePublishing';

type Props = {
  storeId: string | null;
  slug: string;
  config: StoreThemeConfig;
  onLoadDraft: (config: StoreThemeConfig) => void;
  onPublished: (config: StoreThemeConfig) => void;
};

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function versionDate(version: StoreThemeVersion): string {
  const raw = version.published_at ?? version.updated_at;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateFormatter.format(date);
}

export default function StoreThemePublishingPanel({
  storeId,
  slug,
  config,
  onLoadDraft,
  onPublished,
}: Props) {
  const { ask, dialog } = useConfirmDialog();
  const [versions, setVersions] = useState<StoreThemeVersion[]>([]);
  const [loading, setLoading] = useState(Boolean(storeId));
  const [busy, setBusy] = useState<'save' | 'publish' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('Borrador de diseño');
  const hydratedStoreRef = useRef<string | null>(null);

  const draft = useMemo(
    () => versions.find(version => version.status === 'draft') ?? null,
    [versions],
  );
  const published = useMemo(
    () => versions.find(version => version.status === 'published') ?? null,
    [versions],
  );
  const history = useMemo(
    () => versions.filter(version => version.status !== 'draft').slice(0, 6),
    [versions],
  );
  const baseline = draft?.config ?? published?.config ?? null;
  const draftLabelChanged = Boolean(
    draft && (label.trim() || 'Borrador de diseño') !== draft.label,
  );
  const hasUnsavedChanges = !storeId
    ? false
    : baseline
      ? !sameStoreThemeConfig(config, baseline) || draftLabelChanged
      : true;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const load = useCallback(async (applyDraft: boolean) => {
    if (!storeId) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('store_theme_versions')
      .select('id, org_id, store_id, version, label, status, config, created_by, published_by, created_at, updated_at, published_at')
      .eq('store_id', storeId)
      .order('version', { ascending: false });
    setLoading(false);
    if (queryError) {
      console.error('No se pudo leer el historial de diseño', queryError);
      setError('No pudimos abrir el historial. El diseño publicado no cambió.');
      return;
    }
    const parsed = (data ?? []).map(parseStoreThemeVersion).filter(Boolean) as StoreThemeVersion[];
    if (parsed.length !== (data ?? []).length) {
      console.error('El historial de diseño no cumple el contrato esperado', data);
      setError('El historial recibido no es válido. Recargá antes de editar.');
      return;
    }
    setVersions(parsed);
    const activeDraft = parsed.find(version => version.status === 'draft');
    if (activeDraft) setLabel(activeDraft.label);
    if (applyDraft && activeDraft) onLoadDraft(activeDraft.config);
  }, [onLoadDraft, storeId]);

  useEffect(() => {
    if (hydratedStoreRef.current !== storeId) {
      hydratedStoreRef.current = storeId;
      void load(true);
    }
  }, [load, storeId]);

  const saveDraft = async () => {
    if (!storeId || busy) return null;
    setBusy('save');
    const { data, error: saveError } = await supabase.rpc('save_store_theme_draft', {
      p_store_id: storeId,
      p_config: config,
      p_label: label.trim() || 'Borrador de diseño',
      p_expected_updated_at: draft?.updated_at ?? null,
    });
    setBusy(null);
    if (saveError) {
      console.error('No se pudo guardar el borrador de diseño', saveError);
      toast.error(saveError.message || 'No se pudo guardar el borrador.');
      return null;
    }
    const saved = parseStoreThemeVersion(data);
    if (!saved) {
      console.error('El borrador guardado no cumple el contrato esperado', data);
      toast.error('El servidor no confirmó el borrador. Recargá antes de continuar.');
      return null;
    }
    setVersions(current => [saved, ...current.filter(version => version.id !== saved.id)]
      .sort((left, right) => right.version - left.version));
    toast.success('Borrador guardado. La tienda pública no cambió.');
    return saved;
  };

  const publishDraft = async () => {
    if (!storeId || !draft || busy) return;
    if (hasUnsavedChanges) {
      toast.info('Guardá el borrador antes de publicarlo.');
      return;
    }
    const accepted = await ask({
      title: `Publicar diseño v${draft.version}`,
      description: 'La tienda cambiará completa en una sola operación. La versión actual quedará disponible en el historial para restaurarla.',
      confirmText: 'Publicar diseño',
      cancelText: 'Seguir revisando',
    });
    if (!accepted) return;

    setBusy('publish');
    const { data, error: publishError } = await supabase.rpc('publish_store_theme_draft', {
      p_store_id: storeId,
      p_draft_id: draft.id,
      p_expected_updated_at: draft.updated_at,
    });
    setBusy(null);
    if (publishError) {
      console.error('No se pudo publicar el diseño', publishError);
      toast.error(publishError.message || 'No se pudo publicar el diseño.');
      return;
    }
    const payload = data as { config?: unknown } | null;
    const next = payload?.config ? parseStoreThemeVersion({ ...draft, config: payload.config }) : null;
    if (!next) {
      console.error('La publicación devolvió un contrato inesperado', data);
      toast.error('No pudimos confirmar la publicación. Recargá para verificar.');
      return;
    }
    onPublished(next.config);
    await load(false);
    toast.success(`Diseño v${draft.version} publicado.`);
  };

  const restoreVersion = async (version: StoreThemeVersion) => {
    if (!storeId || busy || version.status === 'published') return;
    const accepted = await ask({
      title: `Restaurar diseño v${version.version}`,
      description: 'Se publicará una copia nueva de esta versión. El historial existente y cualquier borrador guardado se conservarán.',
      confirmText: 'Restaurar versión',
      cancelText: 'Cancelar',
    });
    if (!accepted) return;

    setBusy('restore');
    const { data, error: restoreError } = await supabase.rpc('restore_store_theme_version', {
      p_store_id: storeId,
      p_version_id: version.id,
    });
    setBusy(null);
    if (restoreError) {
      console.error('No se pudo restaurar el diseño', restoreError);
      toast.error(restoreError.message || 'No se pudo restaurar la versión.');
      return;
    }
    const payload = data as { config?: unknown } | null;
    const restoredConfig = payload?.config && typeof payload.config === 'object'
      ? parseStoreThemeVersion({ ...version, config: payload.config })?.config
      : null;
    if (!restoredConfig) {
      console.error('La restauración devolvió un contrato inesperado', data);
      toast.error('No pudimos confirmar la restauración. Recargá para verificar.');
      return;
    }
    onPublished(restoredConfig);
    await load(false);
    toast.success(`Diseño v${version.version} restaurado como una versión nueva.`);
  };

  if (!storeId) {
    return (
      <WorkspaceState
        kind="empty-first-use"
        icon={Save}
        title="Primero creá la tienda"
        description="La identidad y la dirección crean el espacio donde Nerqia guardará borradores y versiones publicadas."
      />
    );
  }

  if (loading) {
    return (
      <section className="border-y border-border/60 py-6" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando publicación del diseño…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <WorkspaceState
        kind="error-recoverable"
        icon={History}
        title="No pudimos abrir las versiones"
        description={error}
        actionLabel="Reintentar"
        onAction={() => { void load(true); }}
      />
    );
  }

  return (
    <section className="border-y border-border/60 py-5" aria-labelledby="theme-release-title">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="theme-release-title" className="font-semibold">Publicación del diseño</h3>
            {published ? <Badge variant="secondary">En línea · v{published.version}</Badge> : null}
            {draft ? <Badge variant="outline">Borrador · v{draft.version}</Badge> : null}
            {hasUnsavedChanges ? <Badge variant="outline">Cambios sin guardar</Badge> : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Guardá y revisá los cambios sin alterar la tienda. Publicar reemplaza el diseño completo y conserva la versión anterior.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {draft && !hasUnsavedChanges ? (
            <Button variant="outline" asChild>
              <a href={storeThemePreviewPath(slug, draft.id)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Ver borrador
              </a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => { void saveDraft(); }} disabled={Boolean(busy)}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar borrador
          </Button>
          <Button onClick={() => { void publishDraft(); }} disabled={!draft || hasUnsavedChanges || Boolean(busy)}>
            {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publicar
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-2">
          <Label htmlFor="theme-draft-label">Nombre del borrador</Label>
          <Input
            id="theme-draft-label"
            value={label}
            maxLength={80}
            onChange={event => setLabel(event.target.value)}
            placeholder="Ej. Hot Sale septiembre"
          />
          <p className="text-xs text-muted-foreground">
            Usá un nombre reconocible para campañas o cambios de temporada.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">Historial publicado</h4>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">La primera publicación aparecerá acá.</p>
          ) : (
            <ol className="divide-y divide-border/60 border-y border-border/60">
              {history.map(version => (
                <li key={version.id} className="flex min-h-14 items-center gap-3 py-2.5">
                  {version.status === 'published'
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    : <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">v{version.version} · {version.label}</p>
                    <p className="text-xs text-muted-foreground">{versionDate(version)}</p>
                  </div>
                  {version.status !== 'published' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={`Restaurar versión ${version.version}`}
                      aria-label={`Restaurar versión ${version.version}`}
                      disabled={Boolean(busy)}
                      onClick={() => { void restoreVersion(version); }}
                    >
                      {busy === 'restore'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RotateCcw className="h-4 w-4" />}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {dialog}
    </section>
  );
}
