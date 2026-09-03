import { BRAND_DOMAIN } from './brand.js';

export const STORE_DOMAIN_STATUSES = [
  'none',
  'pending_verification',
  'pending_dns',
  'active',
  'misconfigured',
  'provider_error',
] as const;

export type StoreDomainStatus = typeof STORE_DOMAIN_STATUSES[number];

const LABEL = /^(?:[a-z0-9]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9]))$/;
const PUBLIC_SUFFIX = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function normalizeCustomStoreDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function validateCustomStoreDomain(value: string): {
  domain: string;
  valid: boolean;
  error?: string;
} {
  const domain = normalizeCustomStoreDomain(value);
  if (!domain) return { domain, valid: false, error: 'Ingresá un dominio.' };
  if (domain.length > 253 || domain.includes('://') || /[/:?#@\s]/.test(domain)) {
    return { domain, valid: false, error: 'Escribí sólo el dominio, sin https://, rutas ni puertos.' };
  }

  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !LABEL.test(label))) {
    return { domain, valid: false, error: 'El dominio no tiene un formato válido.' };
  }
  if (!PUBLIC_SUFFIX.test(labels.at(-1) ?? '')) {
    return { domain, valid: false, error: 'Usá un dominio público válido.' };
  }

  const platform = normalizeCustomStoreDomain(BRAND_DOMAIN);
  if (
    domain === platform || domain.endsWith(`.${platform}`)
    || domain === 'vercel.app' || domain.endsWith('.vercel.app')
  ) {
    return { domain, valid: false, error: 'Ese dominio está reservado por la plataforma.' };
  }

  return { domain, valid: true };
}

/**
 * Sólo entra acá un host externo. localhost, IPs, previews y todos los hosts
 * Nerqia conservan sus rutas normales; no se consulta la base por ellos.
 */
export function isPotentialCustomStoreHostname(hostname: string): boolean {
  const host = normalizeCustomStoreDomain(hostname.replace(/:\d+$/, ''));
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return validateCustomStoreDomain(host).valid;
}

export function storeDomainStatusCopy(status: string | null | undefined) {
  switch (status) {
    case 'active':
      return { label: 'Conectado', tone: 'success' as const, detail: 'DNS, titularidad y TLS verificados.' };
    case 'pending_verification':
      return { label: 'Verificar titularidad', tone: 'warning' as const, detail: 'Falta publicar el TXT de verificación.' };
    case 'pending_dns':
      return { label: 'Configurar DNS', tone: 'warning' as const, detail: 'La titularidad está verificada; el dominio todavía no apunta a Nerqia.' };
    case 'misconfigured':
      return { label: 'Revisar DNS', tone: 'danger' as const, detail: 'El proveedor detectó una configuración incompatible con TLS.' };
    case 'provider_error':
      return { label: 'No se pudo comprobar', tone: 'danger' as const, detail: 'La conexión quedó guardada para poder reintentar sin perder el diagnóstico.' };
    default:
      return { label: 'Sin dominio propio', tone: 'neutral' as const, detail: 'La dirección incluida de Nerqia sigue funcionando.' };
  }
}

export interface StoreDomainDnsRecord {
  type: 'TXT' | 'A' | 'CNAME';
  name: string;
  value: string;
  purpose: 'ownership' | 'routing';
}

/** Lee únicamente el contrato sanitizado que persiste la Edge Function. */
export function storeDomainDnsRecords(value: unknown): StoreDomainDnsRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  return records.flatMap((record): StoreDomainDnsRecord[] => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    const raw = record as Record<string, unknown>;
    const type = String(raw.type ?? '').toUpperCase();
    const name = String(raw.name ?? '').trim();
    const recordValue = String(raw.value ?? '').trim();
    const purpose = raw.purpose === 'ownership' ? 'ownership' : 'routing';
    if (!['TXT', 'A', 'CNAME'].includes(type) || !name || !recordValue) return [];
    return [{ type: type as StoreDomainDnsRecord['type'], name, value: recordValue, purpose }];
  });
}
