import { supabase } from '@/integrations/supabase/client';
import { getActiveOrgId } from './orgContext';

export type AuditAction = 'create' | 'update' | 'delete' | 'settings_change' | 'price_change' | 'role_change';
export type EntityType = 'product' | 'sale' | 'purchase' | 'debt' | 'settings' | 'user_role' | 'marketing_post' | 'exchange' | 'expense';
export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Severidad por defecto según la acción, para que la vista de auditoría de
 * AdminPage pueda filtrar sin que cada llamador la especifique.
 */
function defaultSeverity(action: AuditAction): AuditSeverity {
  if (action === 'delete' || action === 'role_change') return 'critical';
  if (action === 'settings_change' || action === 'price_change') return 'warning';
  return 'info';
}

export interface AuditOptions {
  /** Nombre legible de la entidad (ej: el nombre del producto). */
  entityLabel?: string;
  severity?: AuditSeverity;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export async function logAudit(
  userId: string,
  action: AuditAction,
  entityType: EntityType,
  entityId?: string,
  details?: Record<string, any>,
  options?: AuditOptions,
) {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    await supabase.from('audit_logs').insert({
      user_id: userId,
      org_id: getActiveOrgId() || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || {},
      user_email: userRes?.user?.email ?? null,
      entity_label: options?.entityLabel ?? null,
      severity: options?.severity ?? defaultSeverity(action),
      old_values: (options?.oldValues ?? null) as any,
      new_values: (options?.newValues ?? null) as any,
      tags: options?.tags ?? [],
      metadata: (options?.metadata ?? {}) as any,
    });
  } catch {
    // Silently fail - audit logging should never break the app
  }
}
