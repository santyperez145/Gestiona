import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guardia de autenticación de las Edge Functions.
 *
 * `verify_jwt` en el gateway de Supabase parece una barrera y no lo es: la clave
 * anónima es un JWT firmado y válido, y viaja dentro del bundle del navegador.
 * Cualquier visitante puede extraerla y llamar una función "protegida" sólo por
 * verify_jwt.
 *
 * Para una función que consume crédito de un proveedor externo eso es abuso de
 * costo directo. Este test falla si aparece una función nueva que gasta plata sin
 * exigir un usuario real.
 */

const FUNCTIONS_DIR = resolve(process.cwd(), 'supabase/functions');
const SNAPSHOT_CONTRACT = resolve(FUNCTIONS_DIR, '_shared', 'organizationSnapshot.ts');

/** Proveedores donde una llamada de más se paga en pesos. */
const PAID_PROVIDERS = [
  'ANTHROPIC_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'RESEND_API_KEY',
];

/**
 * Funciones que legítimamente gastan sin usuario, con el motivo. Agregar algo
 * acá tiene que ser una decisión consciente y revisable, no un descuido.
 */
const ALLOWED_WITHOUT_USER: Record<string, string> = {
  // Crons: los dispara el scheduler, no una persona
  'check-alerts': 'cron',
  'check-overdue-debts': 'cron',
  'check-stock-alerts': 'cron',
  'daily-kpi-alert': 'cron',
  'daily-whatsapp-digest': 'cron',
  'weekly-performance-digest': 'cron',
  'send-scheduled-campaigns': 'cron',
  'send-drip-emails': 'cron',
  'send-birthday-whatsapp': 'cron',
  'customer-reactivation-alerts': 'cron',
  'auto-recurring-expenses': 'cron',
  'recover-abandoned-carts': 'cron',
  'notify-back-in-stock': 'cron',
  'execute-automations': 'cron',
  'run-automation-flows': 'cron',
  'fetch-usd-rate': 'cron',
  'precio-suscripcion': 'cron: avisa y aplica cambios de precio de suscripción',
  'avisos-por-correo': 'cron: manda por mail los avisos ya marcados',
  // Webhooks: los llama un tercero que firma el request
  'stripe-webhook': 'webhook firmado',
  'mercadopago-webhook': 'webhook firmado',
  'resend-webhook': 'webhook firmado',
  'meli-webhook': 'webhook: revalida la orden oficial con OAuth del vendedor',
  // Storefront: el comprador no tiene sesión; validan todo server-side
  'store-order-email': 'storefront público',
  'store-pay': 'storefront público',
  'shipping-quote': 'storefront público',
  // Devuelve el listado de cuotas y nada más: la clave del comercio se usa
  // para preguntarle a MercadoPago y nunca sale en la respuesta. El org se
  // resuelve por el slug, así que no se pueden pedir las cuotas de otra
  // organización.
  'mp-installments': 'storefront público',
  // Otros
  'send-push': 'invocada server-side',
  'drip-unsubscribe': 'link público de un solo uso',
  'send-webhook': 'invocada server-side',
};

interface FnInfo {
  name: string;
  source: string;
}

function listFunctions(): FnInfo[] {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'))
    .map(d => ({ name: d.name, path: resolve(FUNCTIONS_DIR, d.name, 'index.ts') }))
    .filter(f => existsSync(f.path))
    .map(f => ({ name: f.name, source: readFileSync(f.path, 'utf8') }));
}

/** Distingue una verificación real de usuario de un simple leer el header. */
function requiresRealUser(source: string): boolean {
  return source.includes('auth.getUser')
    || source.includes('requireUser')
    || source.includes('getAuthedUser');
}

function spendsMoney(source: string): boolean {
  return PAID_PROVIDERS.some(p => source.includes(p));
}

describe('autenticación de Edge Functions', () => {
  const functions = listFunctions();

  it('encuentra las funciones en el repo', () => {
    expect(functions.length).toBeGreaterThan(10);
  });

  it('toda función que gasta crédito exige un usuario real', () => {
    const desprotegidas = functions
      .filter(f => spendsMoney(f.source))
      .filter(f => !requiresRealUser(f.source))
      .filter(f => !(f.name in ALLOWED_WITHOUT_USER))
      .map(f => f.name);

    expect(
      desprotegidas,
      'gastan plata sin verificar usuario. Usá requireUser() de _shared, o ' +
      'documentá el motivo en ALLOWED_WITHOUT_USER si es un cron o un webhook',
    ).toEqual([]);
  });

  it('la lista de excepciones no tiene entradas muertas', () => {
    const nombres = new Set(functions.map(f => f.name));
    const huerfanas = Object.keys(ALLOWED_WITHOUT_USER).filter(n => !nombres.has(n));
    expect(
      huerfanas,
      'excepciones que ya no corresponden a ninguna función: si alguien crea ' +
      'una función con ese nombre, heredaría la excepción sin revisión',
    ).toEqual([]);
  });

  it('weekly-backup exige owner o secreto de cron y no finge una restauración', () => {
    const weeklyBackup = functions.find(f => f.name === 'weekly-backup');
    expect(weeklyBackup).toBeDefined();
    expect(weeklyBackup?.source).toContain('requireUser');
    expect(weeklyBackup?.source).toContain('ownerCanAccess');
    expect(weeklyBackup?.source).toContain('backupIsEntitled');
    expect(weeklyBackup?.source).toContain('BACKUP_CRON_SECRET');
    expect(weeklyBackup?.source).toContain('secretsMatch');
    expect(weeklyBackup?.source).toContain('snapshotIsComplete');
    expect(weeklyBackup?.source).toContain('validateSnapshot');
    expect(weeklyBackup?.source).not.toContain('user_roles');
  });

  it('retira todo enlace de sesión visible y envía onboarding directo por email', () => {
    const platformAction = functions.find(f => f.name === 'platform-admin-action');
    expect(platformAction).toBeDefined();
    expect(platformAction?.source).toContain('action === "generateMagicLink"');
    expect(platformAction?.source).toContain('impersonation_retired');
    expect(platformAction?.source.match(/auth\.admin\.generateLink/g) || []).toHaveLength(0);
    expect(platformAction?.source).toContain('mailAuth.auth.signInWithOtp');
    expect(platformAction?.source).toContain('token_exposed_to_staff: false');
  });

  it('el export portable exige dueño y nunca devuelve credenciales de acceso', () => {
    const exportOrg = functions.find(f => f.name === 'export-organization-data');
    expect(exportOrg).toBeDefined();
    expect(exportOrg?.source).toContain('requireUser');
    expect(exportOrg?.source).toContain('membership?.role !== "owner"');
    expect(exportOrg?.source).toContain('collectOrganizationSnapshot');
    const snapshotContract = readFileSync(SNAPSHOT_CONTRACT, 'utf8');
    expect(snapshotContract).toContain('EXCLUDED_CREDENTIAL_STORES');
    expect(snapshotContract).toContain('SECRET_SETTINGS_COLUMNS');
    expect(snapshotContract).toContain('SETTINGS_SNAPSHOT_COLUMNS');
    expect(snapshotContract).toContain('count: "exact"');
    expect(snapshotContract).toContain('count === null');
  });

  // Nota: no hay acá un test de "filtra la service_role key al cliente".
  // Se intentó por regex y daba falsos positivos en cualquier función que crea
  // un cliente admin y devuelve una respuesta cerca — que son casi todas. Un
  // test que grita en falso se termina ignorando, y entonces no protege nada.
  // Ese riesgo se cubre en revisión de código y con `checkSecrets`, que devuelve
  // booleanos y nunca valores.
});
