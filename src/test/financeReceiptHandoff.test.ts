import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPurchaseOrderHandoffPath,
  isPurchaseOrderReceivable,
  parsePurchaseOrderHandoff,
} from '@/lib/purchaseOrderHandoff';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const financePage = read('src/pages/FinanceDocumentsPage.tsx');
const ordersPage = read('src/pages/PurchaseOrdersPage.tsx');

const ORDER_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('handoff de Finance a recepción', () => {
  it('construye un enlace explícito a la recepción de la orden aprobada', () => {
    const path = buildPurchaseOrderHandoffPath(ORDER_ID, 'receive');
    expect(path).toContain('/ordenes-compra?');
    expect(path).toContain(`purchaseOrder=${ORDER_ID}`);
    expect(path).toContain('action=receive');
    expect(path).toContain('source=finance');
    expect(financePage).toContain("buildPurchaseOrderHandoffPath(drafts.purchase.purchaseOrderId, 'receive')");
    expect(financePage).toContain('Ir a recibir mercadería');
  });

  it('descarta ids manipulados y degrada a la lista segura', () => {
    expect(buildPurchaseOrderHandoffPath('../otra-organizacion', 'receive')).toBe('/ordenes-compra');
    expect(parsePurchaseOrderHandoff(new URLSearchParams('purchaseOrder=no-es-uuid&action=receive'))).toBeNull();
  });

  it('sólo reconoce la acción de recepción, cualquier otra abre en consulta', () => {
    expect(parsePurchaseOrderHandoff(new URLSearchParams(`purchaseOrder=${ORDER_ID}&action=receive`))?.action).toBe('receive');
    expect(parsePurchaseOrderHandoff(new URLSearchParams(`purchaseOrder=${ORDER_ID}&action=delete`))?.action).toBe('view');
  });

  it('abre recepción únicamente en estados físicamente recibibles', () => {
    expect(isPurchaseOrderReceivable('confirmed')).toBe(true);
    expect(isPurchaseOrderReceivable('partially_received')).toBe(true);
    expect(isPurchaseOrderReceivable('received')).toBe(false);
    expect(isPurchaseOrderReceivable('cancelled')).toBe(false);
  });

  it('enfoca únicamente una orden ya cargada bajo organización y RLS', () => {
    expect(ordersPage).toContain('.eq("org_id", orgId)');
    expect(ordersPage).toContain('orders.find(candidate => candidate.id === handoff.orderId && candidate.org_id === orgId)');
    expect(ordersPage).not.toMatch(/\.from\("purchase_orders"\)[\s\S]{0,120}\.eq\("id", handoff\.orderId\)/);
  });

  it('conserva la autoridad física en el RPC idempotente existente', () => {
    expect(ordersPage).toContain('receive_purchase_order_idem');
    expect(ordersPage).not.toMatch(/\.from\(["']products["']\)\.update\(/);
    expect(ordersPage).toContain('El stock cambia recién cuando confirmás esta recepción.');
  });
});
