import type { Database } from "@/integrations/supabase/types";

export type AnnouncementTone = "info" | "maintenance" | "warning" | "success";
export type AnnouncementLifecycle = "draft" | "scheduled" | "published" | "expired" | "archived";

export interface PlatformAnnouncement {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  cta_label: string | null;
  cta_url: string | null;
  starts_at: string;
  ends_at: string | null;
  published_at: string | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type PlatformAnnouncementRow = Database["public"]["Tables"]["platform_announcements"]["Row"];

const TONES = new Set<AnnouncementTone>(["info", "maintenance", "warning", "success"]);

export function isAnnouncementTone(value: string): value is AnnouncementTone {
  return TONES.has(value as AnnouncementTone);
}

export function announcementToneLabel(tone: AnnouncementTone): string {
  switch (tone) {
    case "maintenance": return "Mantenimiento";
    case "warning": return "Importante";
    case "success": return "Novedad";
    default: return "Información";
  }
}

/**
 * Las CTAs se validan también en SQL. La segunda validación evita que una fila
 * mal cargada en una consola llegue a convertirse en navegación externa.
 */
export function isInternalAnnouncementPath(value: string | null | undefined): value is string {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/\s/.test(value);
}

export function announcementLifecycle(announcement: Pick<PlatformAnnouncement, "published_at" | "archived_at" | "starts_at" | "ends_at">, now = new Date()): AnnouncementLifecycle {
  if (announcement.archived_at) return "archived";
  if (!announcement.published_at) return "draft";
  const startsAt = new Date(announcement.starts_at);
  const endsAt = announcement.ends_at ? new Date(announcement.ends_at) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) return "draft";
  if (startsAt > now) return "scheduled";
  if (endsAt && endsAt <= now) return "expired";
  return "published";
}

export function announcementLifecycleLabel(status: AnnouncementLifecycle): string {
  switch (status) {
    case "scheduled": return "Programado";
    case "published": return "Publicado";
    case "expired": return "Vencido";
    case "archived": return "Archivado";
    default: return "Borrador";
  }
}

/** Convierte el ISO de Postgres al control local datetime-local sin cambiar la hora que ve el operador. */
export function toAnnouncementDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function toAnnouncementIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatAnnouncementDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "Sin vencimiento";
}
