import { supabase } from '@/integrations/supabase/client';

export type AuditAction = 'create' | 'update' | 'delete' | 'settings_change' | 'price_change' | 'role_change';
export type EntityType = 'product' | 'sale' | 'purchase' | 'debt' | 'settings' | 'user_role' | 'marketing_post';

export async function logAudit(
  userId: string,
  action: AuditAction,
  entityType: EntityType,
  entityId?: string,
  details?: Record<string, any>
) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || {},
    });
  } catch {
    // Silently fail - audit logging should never break the app
  }
}
