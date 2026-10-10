/**
 * Realtime por Broadcast desde la base (20261010001100_realtime_broadcast).
 *
 * La base avisa con realtime.send en topics privados:
 *   org:<org_id>        venta · stock · stock_bajo · deuda · campana ·
 *                       integracion · solicitud · soporte
 *   user:<user_id>      notificacion
 *   plataforma:soporte  soporte (staff)
 *
 * Un solo canal por topic para toda la app, con contador de referencias: diez
 * pantallas escuchando la misma organización comparten una conexión. Antes
 * cada componente abría su canal de Postgres Changes —y varios escuchaban
 * tablas que ni estaban publicadas—.
 */
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Handler = (payload: Record<string, unknown>) => void;
type Suscripcion = { channel: RealtimeChannel; handlers: Map<string, Set<Handler>> };

const topics = new Map<string, Suscripcion>();

function abrir(topic: string): Suscripcion {
  const existente = topics.get(topic);
  if (existente) return existente;
  const handlers = new Map<string, Set<Handler>>();
  const channel = supabase.channel(topic, { config: { private: true } });
  channel.on("broadcast", { event: "*" }, (mensaje: { event?: string; payload?: Record<string, unknown> }) => {
    const lista = mensaje.event ? handlers.get(mensaje.event) : undefined;
    lista?.forEach(handler => {
      try { handler(mensaje.payload ?? {}); } catch (error) { console.error("[realtime]", topic, mensaje.event, error); }
    });
  });
  const suscripcion = { channel, handlers };
  topics.set(topic, suscripcion);
  // Los topics privados se autorizan con el token de la sesión.
  void supabase.realtime.setAuth().finally(() => {
    if (topics.get(topic) === suscripcion) channel.subscribe();
  });
  return suscripcion;
}

/** Escucha `evento` en `topic`; devuelve la función para dejar de escuchar. */
export function escucharTopic(topic: string, evento: string, handler: Handler): () => void {
  const s = abrir(topic);
  const lista = s.handlers.get(evento) ?? new Set<Handler>();
  lista.add(handler);
  s.handlers.set(evento, lista);
  return () => {
    lista.delete(handler);
    if (!lista.size) s.handlers.delete(evento);
    if (!s.handlers.size) {
      topics.delete(topic);
      void supabase.removeChannel(s.channel);
    }
  };
}

/** Hook: el handler puede cambiar en cada render sin resuscribir. */
export function useTopicEvent(topic: string | null | undefined, evento: string, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!topic) return;
    return escucharTopic(topic, evento, payload => ref.current(payload));
  }, [topic, evento]);
}

export const topicOrg = (orgId: string | null | undefined) => (orgId ? `org:${orgId}` : null);
export const topicUsuario = (userId: string | null | undefined) => (userId ? `user:${userId}` : null);

export type VentaAviso = { id: string; product_name: string | null; customer_name: string | null; total_ars: number | null; date: string | null; created_at: string | null };
