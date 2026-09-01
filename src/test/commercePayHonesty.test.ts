import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  resolve(import.meta.dirname, '..', 'pages', 'EcommerceStorePage.tsx'),
  'utf8',
);
const payPanel = readFileSync(
  resolve(import.meta.dirname, '..', 'components', 'integrations', 'PaymentConnectionsPanel.tsx'),
  'utf8',
);

describe('Commerce Pay honesty', () => {
  it('no ofrece Stripe ni PayPal como medio de la tienda argentina', () => {
    expect(page).toContain('id: "mercadopago"');
    expect(page).not.toMatch(/id:\s*"stripe"/);
    expect(page).not.toMatch(/id:\s*"paypal"/);
    expect(page).toContain('no hay adapter vivo');
  });

  it('activa Gestiona Pay por OAuth y no pide pegar una clave', () => {
    expect(page).toContain('PaymentConnectionsPanel');
    expect(payPanel).toContain('Activar Gestiona Pay');
    expect(payPanel).toContain('mp-connect');
    expect(payPanel).not.toContain('mp_access_token');
  });

  it('muestra el desglose de comisiones con la liquidación real, no un porcentaje escrito a mano', () => {
    expect(payPanel).toContain('GestionaPayComisiones');
    const comisiones = readFileSync(
      resolve(import.meta.dirname, '..', 'components', 'integrations', 'GestionaPayComisiones.tsx'),
      'utf8',
    );
    expect(comisiones).toContain('computeSettlement');
    expect(comisiones).toContain('resolveLivePlatformRule');
    expect(comisiones).toContain('payment_provider_fees');
    expect(comisiones).toContain('platform_commission_rules');
    expect(comisiones).toContain('El comprador paga el precio de la tienda');
    expect(comisiones).not.toMatch(/0,\s*5\s*%|0\.5%/);
  });

  it('al conectar Pay registra el medio en org_payment_providers, no sólo el token', () => {
    const mpConnect = readFileSync(
      resolve(import.meta.dirname, '..', '..', 'supabase', 'functions', 'mp-connect', 'index.ts'),
      'utf8',
    );
    expect(mpConnect).toContain('medio_de_pago_conectado');
    expect(mpConnect).toContain('org_payment_providers');
    expect(mpConnect).toContain('mp_enabled: false');
  });

  it('el workspace se presenta como Commerce, no como módulo extra', () => {
    expect(page).toContain('title="Gestiona Commerce"');
    expect(page).toContain('label: "Publicar"');
    expect(page).toContain('label: "Pedidos"');
    expect(page).toContain('label: "Pagos y envíos"');
    expect(page).toContain('PaymentConnectionsPanel');
  });
});
