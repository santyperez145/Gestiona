import type { Json } from '@/integrations/supabase/types';
import type { StoreFormDraft } from '@/lib/storeDraft';
import { parseStorefrontLayout } from '@/lib/storeHomeLayout';

export type StoreThemeConfig = {
  theme: string;
  primary_color: string;
  font: string | null;
  logo_url: string | null;
  banner_url: string | null;
  storefront_layout: Json | null;
};

export type StoreThemeVersionStatus = 'draft' | 'published' | 'archived';

export type StoreThemeVersion = {
  id: string;
  org_id: string;
  store_id: string;
  version: number;
  label: string;
  status: StoreThemeVersionStatus;
  config: StoreThemeConfig;
  created_by: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type ThemeEditorSource = {
  primary_color: string;
  font: string | null;
  logo_url: string;
  banner_url: string;
  storefront_layout: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function storeThemeConfigFromEditor(
  selectedTheme: string,
  editor: ThemeEditorSource,
): StoreThemeConfig {
  return {
    theme: selectedTheme,
    primary_color: editor.primary_color.trim().toUpperCase(),
    font: nullableText(editor.font),
    logo_url: nullableText(editor.logo_url),
    banner_url: nullableText(editor.banner_url),
    storefront_layout: (isRecord(editor.storefront_layout)
      ? editor.storefront_layout
      : null) as Json | null,
  };
}

export function parseStoreThemeConfig(value: unknown): StoreThemeConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.theme !== 'string' || !value.theme.trim()) return null;
  if (typeof value.primary_color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.primary_color)) return null;
  const layout = value.storefront_layout;
  if (layout !== null && layout !== undefined && !isRecord(layout)) return null;
  return {
    theme: value.theme.trim().toLowerCase(),
    primary_color: value.primary_color.toUpperCase(),
    font: nullableText(value.font),
    logo_url: nullableText(value.logo_url),
    banner_url: nullableText(value.banner_url),
    storefront_layout: (layout ?? null) as Json | null,
  };
}

export function parseStoreThemeVersion(value: unknown): StoreThemeVersion | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const config = parseStoreThemeConfig(value.config);
  if (
    typeof value.id !== 'string'
    || typeof value.org_id !== 'string'
    || typeof value.store_id !== 'string'
    || typeof value.version !== 'number'
    || typeof value.label !== 'string'
    || (status !== 'draft' && status !== 'published' && status !== 'archived')
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string'
    || !config
  ) return null;

  return {
    id: value.id,
    org_id: value.org_id,
    store_id: value.store_id,
    version: value.version,
    label: value.label,
    status,
    config,
    created_by: nullableText(value.created_by),
    published_by: nullableText(value.published_by),
    created_at: value.created_at,
    updated_at: value.updated_at,
    published_at: nullableText(value.published_at),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameStoreThemeConfig(left: StoreThemeConfig, right: StoreThemeConfig): boolean {
  return stable(left) === stable(right);
}

export function applyStoreThemeConfig(
  editor: StoreFormDraft,
  config: StoreThemeConfig,
): StoreFormDraft {
  return {
    ...editor,
    primary_color: config.primary_color,
    font: config.font ?? 'sistema',
    logo_url: config.logo_url ?? '',
    banner_url: config.banner_url ?? '',
    storefront_layout: parseStorefrontLayout(config.storefront_layout),
  };
}

export function storeThemePreviewPath(slug: string, versionId: string): string {
  return `/tienda/${encodeURIComponent(slug)}/vista-previa/${encodeURIComponent(versionId)}`;
}
