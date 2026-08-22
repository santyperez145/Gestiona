import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

export type SupportDiagnosticReason = 'activation' | 'catalog' | 'integration' | 'inventory' | 'incident';
export type SupportDiagnosticStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type OrganizationSupportDiagnosticRequest = Database['public']['Views']['organization_support_diagnostic_requests']['Row'];
export type PlatformSupportDiagnosticRequest = Database['public']['Views']['platform_support_diagnostic_requests']['Row'];

export const SUPPORT_DIAGNOSTIC_REASONS: Array<{ value: SupportDiagnosticReason; label: string }> = [
  { value: 'activation', label: 'Activación y primera venta' },
  { value: 'catalog', label: 'Catálogo y publicaciones' },
  { value: 'integration', label: 'Integraciones' },
  { value: 'inventory', label: 'Inventario y Kardex' },
  { value: 'incident', label: 'Incidente operativo' },
];

const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  'access_token', 'refresh_token', 'api_key', 'api_url', 'private_key', 'certificate',
  'customer', 'customers', 'customer_email', 'email', 'phone', 'address',
  'product_name', 'sale_price', 'cost_usd', 'total_ars', 'last_error', 'error_message',
]);

export interface SupportDiagnosticSnapshot {
  schemaVersion: number;
  generatedAt: string;
  access: Record<string, Json | undefined>;
  organization: Record<string, Json | undefined>;
  activation: Record<string, Json | undefined>;
  businessProfile: Record<string, Json | undefined>;
  catalogQuality: Record<string, Json | undefined>;
  stockAccuracy: Record<string, Json | undefined>;
  deliveryQueue: Record<string, Json | undefined>;
  integrations: Array<Record<string, Json | undefined>>;
}

function isRecord(value: unknown): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findForbiddenDiagnosticKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const forbidden = findForbiddenDiagnosticKey(child);
      if (forbidden) return forbidden;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SNAPSHOT_KEYS.has(key.toLowerCase())) return key;
    const forbidden = findForbiddenDiagnosticKey(child);
    if (forbidden) return forbidden;
  }
  return null;
}

export function parseSupportDiagnosticSnapshot(value: Json): SupportDiagnosticSnapshot {
  const forbidden = findForbiddenDiagnosticKey(value);
  if (forbidden) throw new Error(`El diagnóstico incluyó un campo no permitido: ${forbidden}`);
  if (!isRecord(value) || value.schema_version !== 1 || typeof value.generated_at !== 'string') {
    throw new Error('El servidor devolvió un diagnóstico incompatible');
  }
  const objectSection = (key: string) => isRecord(value[key]) ? value[key] : {};
  const integrations = Array.isArray(value.integrations)
    ? value.integrations.filter(isRecord)
    : [];
  return {
    schemaVersion: value.schema_version,
    generatedAt: value.generated_at,
    access: objectSection('access'),
    organization: objectSection('organization'),
    activation: objectSection('activation'),
    businessProfile: objectSection('business_profile'),
    catalogQuality: objectSection('catalog_quality'),
    stockAccuracy: objectSection('stock_accuracy'),
    deliveryQueue: objectSection('delivery_queue'),
    integrations,
  };
}

export function diagnosticNumber(section: Record<string, Json | undefined>, key: string): number | null {
  const value = section[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function diagnosticText(section: Record<string, Json | undefined>, key: string): string | null {
  const value = section[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function diagnosticBoolean(section: Record<string, Json | undefined>, key: string): boolean | null {
  const value = section[key];
  return typeof value === 'boolean' ? value : null;
}

export async function listOrganizationSupportDiagnosticRequests(orgId: string): Promise<OrganizationSupportDiagnosticRequest[]> {
  const { data, error } = await supabase
    .from('organization_support_diagnostic_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('requested_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function listPlatformSupportDiagnosticRequests(orgId: string): Promise<PlatformSupportDiagnosticRequest[]> {
  const { data, error } = await supabase
    .from('platform_support_diagnostic_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('requested_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function requestSupportDiagnosticAccess(orgId: string, reasonCode: SupportDiagnosticReason): Promise<void> {
  const { error } = await supabase.rpc('request_support_diagnostic_access', {
    p_org_id: orgId,
    p_reason_code: reasonCode,
  });
  if (error) throw error;
}

export async function approveSupportDiagnosticAccess(requestId: string, durationMinutes: 15 | 30 | 60): Promise<void> {
  const { error } = await supabase.rpc('approve_support_diagnostic_access', {
    p_request_id: requestId,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
}

export async function revokeSupportDiagnosticAccess(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_support_diagnostic_access', { p_request_id: requestId });
  if (error) throw error;
}

export async function getSupportDiagnosticSnapshot(requestId: string): Promise<SupportDiagnosticSnapshot> {
  const { data, error } = await supabase.rpc('get_support_diagnostic_snapshot', { p_request_id: requestId });
  if (error) throw error;
  return parseSupportDiagnosticSnapshot(data);
}
