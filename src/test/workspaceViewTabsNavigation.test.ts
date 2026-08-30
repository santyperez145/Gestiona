import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const component = readFileSync(
  resolve(root, 'src/components/shared/WorkspaceViewTabs.tsx'),
  'utf8',
);

describe('navegación compartida de vistas', () => {
  it('lleva la pestaña activa completamente al área visible', () => {
    expect(component).toContain('tabRefs.current[activeTab]?.scrollIntoView({');
    expect(component).toContain('block: "nearest"');
    expect(component).toContain('inline: "nearest"');
    expect(component).toContain('tabRefs.current[id] = node');
  });
});
