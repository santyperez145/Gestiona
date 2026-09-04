import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreThemePublishingPanel from '@/components/ecommerce/StoreThemePublishingPanel';
import type { StoreThemeConfig } from '@/lib/storeThemePublishing';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ask: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ ask: mocks.ask, dialog: null }),
}));

const publishedConfig: StoreThemeConfig = {
  theme: 'minimal',
  primary_color: '#111111',
  font: 'sistema',
  logo_url: null,
  banner_url: null,
  storefront_layout: { sections: [] },
};

const draftConfig: StoreThemeConfig = {
  ...publishedConfig,
  theme: 'pastel',
  primary_color: '#AA44CC',
};

const versions = [
  {
    id: 'draft-id', org_id: 'org-id', store_id: 'store-id', version: 2,
    label: 'Hot Sale', status: 'draft', config: draftConfig,
    created_by: 'user-id', published_by: null,
    created_at: '2026-09-04T12:00:00Z', updated_at: '2026-09-04T12:00:00Z', published_at: null,
  },
  {
    id: 'published-id', org_id: 'org-id', store_id: 'store-id', version: 1,
    label: 'Diseño inicial', status: 'published', config: publishedConfig,
    created_by: null, published_by: 'user-id',
    created_at: '2026-09-03T12:00:00Z', updated_at: '2026-09-03T12:00:00Z', published_at: '2026-09-03T12:00:00Z',
  },
];

function mockHistory() {
  const order = vi.fn().mockResolvedValue({ data: versions, error: null });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select });
}

describe('StoreThemePublishingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory();
    mocks.ask.mockResolvedValue(true);
  });

  it('carga el borrador, muestra la versión viva y ofrece preview segura', async () => {
    const onLoadDraft = vi.fn();
    render(
      <StoreThemePublishingPanel
        storeId="store-id"
        slug="mi-tienda"
        config={draftConfig}
        onLoadDraft={onLoadDraft}
        onPublished={vi.fn()}
      />,
    );

    expect(await screen.findByText('En línea · v1')).toBeVisible();
    expect(screen.getByText('Borrador · v2')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver borrador' }))
      .toHaveAttribute('href', '/tienda/mi-tienda/vista-previa/draft-id');
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeEnabled();
    expect(onLoadDraft).toHaveBeenCalledWith(draftConfig);
  });

  it('obliga a guardar antes de publicar un cambio nuevo', async () => {
    render(
      <StoreThemePublishingPanel
        storeId="store-id"
        slug="mi-tienda"
        config={{ ...draftConfig, primary_color: '#BB55DD' }}
        onLoadDraft={vi.fn()}
        onPublished={vi.fn()}
      />,
    );

    expect(await screen.findByText('Cambios sin guardar')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Ver borrador' })).toBeNull();
  });

  it('publica la versión guardada mediante la autoridad server-side', async () => {
    const onPublished = vi.fn();
    mocks.rpc.mockResolvedValueOnce({
      data: { config: draftConfig, version: versions[0] },
      error: null,
    });
    render(
      <StoreThemePublishingPanel
        storeId="store-id"
        slug="mi-tienda"
        config={draftConfig}
        onLoadDraft={vi.fn()}
        onPublished={onPublished}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('publish_store_theme_draft', {
      p_store_id: 'store-id',
      p_draft_id: 'draft-id',
      p_expected_updated_at: '2026-09-04T12:00:00Z',
    }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(draftConfig));
  });
});
