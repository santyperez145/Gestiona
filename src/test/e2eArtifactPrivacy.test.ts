import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('evidencia CI sin sesiones ni datos privados del panel', () => {
  it('usa lista permitida de proyectos publicos, no todo test-results', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const upload = workflow.slice(workflow.indexOf('- name: Preserve E2E failure evidence'), workflow.indexOf('  security:'));
    expect(upload).toContain('test-results/*-chromium/**');
    expect(upload).toContain('test-results/*-mobile/**');
    expect(upload).not.toMatch(/path:\s*test-results\/\s*\n/);
    expect(upload).not.toContain('*-panel/**');
    expect(upload).not.toContain('e2e/.auth');
  });
});
