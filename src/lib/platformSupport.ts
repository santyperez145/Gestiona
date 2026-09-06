import { supabase } from "@/integrations/supabase/client";

export type SupportCategory = "general" | "technical" | "billing" | "account" | "integration";
export type SupportPriority = "normal" | "high" | "urgent";
export type SupportStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";

export interface PlatformSupportThread {
  id: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  created_by: string;
  requester_name: string;
  assigned_to: string | null;
  assigned_name: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  unread_count: number;
  latest_message: string | null;
}

export interface PlatformSupportMessage {
  id: string;
  sender_kind: "merchant" | "support" | "system";
  sender_name: string;
  body: string;
  created_at: string;
}

function supportError(error: unknown): Error {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("permiso")) return new Error("No tenés permiso para usar el soporte de esta organización.");
  if (normalized.includes("organización no pertenece")) return new Error("La organización seleccionada ya no está disponible.");
  if (normalized.includes("asunto debe")) return new Error("El asunto debe tener entre 5 y 120 caracteres.");
  if (normalized.includes("mensaje debe") || normalized.includes("contanos el problema")) return new Error("Escribí un mensaje antes de enviarlo.");
  if (normalized.includes("categoría elegida")) return new Error("Elegí una categoría válida para la consulta.");
  if (normalized.includes("prioridad elegida")) return new Error("Elegí una prioridad válida para la consulta.");
  if (normalized.includes("estado elegido")) return new Error("No pudimos aplicar ese estado. Actualizá la bandeja e intentá nuevamente.");
  if (normalized.includes("sólo el equipo de soporte")) return new Error("Tu cuenta no puede administrar conversaciones de soporte.");
  if (normalized.includes("conversación no existe")) return new Error("La conversación ya no está disponible. Actualizá la bandeja.");
  return new Error("No pudimos comunicarnos con soporte. Intentá nuevamente en unos minutos.");
}

export async function listPlatformSupportThreads(orgId: string | null) {
  const { data, error } = await supabase.rpc("list_platform_support_threads", { p_org_id: orgId ?? undefined });
  if (error) throw supportError(error);
  return (data ?? []).map(row => ({ ...row, unread_count: Number(row.unread_count ?? 0) })) as PlatformSupportThread[];
}

export async function listPlatformSupportMessages(threadId: string) {
  const { data, error } = await supabase.rpc("list_platform_support_messages", { p_thread_id: threadId });
  if (error) throw supportError(error);
  return (data ?? []) as PlatformSupportMessage[];
}

export async function createPlatformSupportThread(input: {
  orgId: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  message: string;
}) {
  const { data, error } = await supabase.rpc("create_platform_support_thread", {
    p_org_id: input.orgId,
    p_subject: input.subject,
    p_category: input.category,
    p_priority: input.priority,
    p_message: input.message,
  });
  if (error) throw supportError(error);
  return data as string;
}

export async function sendPlatformSupportMessage(threadId: string, message: string) {
  const { error } = await supabase.rpc("send_platform_support_message", {
    p_thread_id: threadId,
    p_message: message,
  });
  if (error) throw supportError(error);
}

export async function updatePlatformSupportThread(
  threadId: string,
  status: SupportStatus,
  assignToMe = false,
) {
  const { error } = await supabase.rpc("update_platform_support_thread", {
    p_thread_id: threadId,
    p_status: status,
    p_assign_to_me: assignToMe,
  });
  if (error) throw supportError(error);
}

export async function markPlatformSupportThreadRead(threadId: string) {
  const { error } = await supabase.rpc("mark_platform_support_thread_read", { p_thread_id: threadId });
  if (error) throw supportError(error);
}
