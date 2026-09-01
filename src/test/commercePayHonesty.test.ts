import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  resolve(import.meta.dirname, '..', 'pages', 'EcommerceStorePage.tsx'),
  'utf8',
);

describe('Commerce Pay honesty', () => {
  it('no ofrece Stripe ni PayPal como medio de la tienda argentina', () => {
    expect(page).toContain('id: "mercadopago"');
    expect(page).not.toMatch(/id:\s*"stripe"/);
    expect(page).not.toMatch(/id:\s*"paypal"/);
    expect(page).toContain('no hay adapter vivo');
  });

  it('el workspace se presenta como Commerce, no como módulo extra', () => {
    expect(page).toContain('title="Gestiona Commerce"');
    expect(page).toContain('label: "Publicar"');
    expect(page).toContain('label: "Pedidos"');
    expect(page).toContain('label: "Pagos y envíos"');
  });
});
