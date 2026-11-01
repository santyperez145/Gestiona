import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { rutaDelAviso } from "@/lib/rutaDelAviso";
import { Bell, Package, AlertTriangle, DollarSign, Info, Check, Trash2, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { topicUsuario, useTopicEvent } from "@/lib/orgRealtime";
import { toast } from "sonner";
const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  stock_bajo: { icon: Package, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  deuda_vencida: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
  venta_grande: { icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  tiendanube: { icon: ShoppingBag, color: 'text-[#2f6ee4]', bg: 'bg-[#2f6ee4]/10' },
  sistema: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  /** 'ruta' + una ruta del panel: el aviso lleva adonde se resuelve. */
  entity_type?: string | null;
  entity_id?: string | null;
}

/**
 * Lista y total sin leer en una sola consulta compartida (2026-10-31). El
 * barrido con datos midió 6 pedidos a `notifications` en cada pantalla: la
 * campanita está dos veces (barra lateral y encabezado del teléfono) y cada
 * una pedía la lista y dos veces el mismo contador. Con React Query las dos
 * leen la misma entrada; el total sale del `count` de la misma consulta, que
 * no respeta el límite de 30 (el contador no se queda clavado en 30).
 */
interface DatosCampanita { lista: Notification[]; sinLeer: number }
const claveCampanita = (userId: string | undefined) => ["campanita", userId ?? ""] as const;

async function leerCampanita(userId: string): Promise<DatosCampanita> {
  const { data, count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return { lista: (data ?? []) as Notification[], sinLeer: count ?? 0 };
}

export default function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clave = claveCampanita(user?.id);
  const { data, error: errorDeLectura } = useQuery({
    queryKey: clave,
    queryFn: () => leerCampanita(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });
  // Sin esto, «no tengo permiso» y «no hay nada» se ven igual.
  useEffect(() => {
    if (errorDeLectura) console.error('No se pudieron leer las notificaciones', errorDeLectura);
  }, [errorDeLectura]);
  const notifications = data?.lista ?? [];
  const unreadCount = data?.sinLeer ?? 0;
  const actualizar = (cambio: (d: DatosCampanita) => DatosCampanita) =>
    queryClient.setQueryData<DatosCampanita>(clave, d => cambio(d ?? { lista: [], sinLeer: 0 }));

  // Realtime: las dos campanitas reciben el mismo evento; sólo suma lo que
  // todavía no estaba en la lista.
  useTopicEvent(topicUsuario(user?.id), 'notificacion', payload => {
    const nuevas = (payload.notificaciones as Notification[] | undefined) ?? [];
    if (!nuevas.length) return;
    actualizar(d => {
      const realmenteNuevas = nuevas.filter(n => !d.lista.some(x => x.id === n.id));
      return {
        lista: [...realmenteNuevas, ...d.lista].slice(0, 30),
        sinLeer: d.sinLeer + realmenteNuevas.length,
      };
    });
  });

  const markAllRead = async () => {
    if (!user) return;
    // ⚠️ Antes no se miraba el error: si la base rechazaba, la campanita
    // mostraba todo leído y al recargar volvían todas.
    const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    if (error) {
      console.error('[notificaciones] no se pudieron marcar como leídas:', error);
      toast.error('No se pudieron marcar como leídas. Probá de nuevo.');
      return;
    }
    actualizar(d => ({ lista: d.lista.map(n => ({ ...n, read: true })), sinLeer: 0 }));
  };

  const markOneRead = async (id: string) => {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) {
      console.error('[notificaciones] no se pudo marcar como leída:', error);
      return;
    }
    actualizar(d => ({
      lista: d.lista.map(n => n.id === id ? { ...n, read: true } : n),
      sinLeer: d.lista.some(n => n.id === id && !n.read) ? Math.max(0, d.sinLeer - 1) : d.sinLeer,
    }));
  };

  const clearAll = async () => {
    if (!user) return;
    const { error } = await supabase.from('notifications').delete().eq('user_id', user.id);
    if (error) {
      console.error('[notificaciones] no se pudieron borrar:', error);
      toast.error('No se pudieron borrar las notificaciones. Probá de nuevo.');
      return;
    }
    actualizar(() => ({ lista: [], sinLeer: 0 }));
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Ahora';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`relative ${collapsed ? 'w-full justify-center' : 'w-full justify-start'} text-sidebar-foreground hover:bg-sidebar-accent`}
          title={collapsed ? `Notificaciones (${unreadCount})` : undefined}
        >
          <Bell className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="ml-2 text-sm">Notificaciones</span>}
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

          <PopoverContent side="right" align="end" sideOffset={8} className="w-80 max-h-[min(420px,calc(100vh-2rem))] p-0 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="font-display font-semibold text-sm">Notificaciones</h3>
              <div className="flex gap-1">
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={markAllRead}>
                    <Check className="w-3 h-3" /> Leer todo
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button aria-label="Eliminar" title="Eliminar" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearAll}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Sin notificaciones</p>
                </div>
              ) : (
                notifications.map(n => {
                  const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.sistema;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!n.read) markOneRead(n.id);
                        const ruta = rutaDelAviso(n);
                        if (ruta) { setOpen(false); navigate(ruta); }
                      }}
                      className={`px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${!n.read ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex gap-3">
                        <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                          <Icon className={`w-4 h-4 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-medium truncate ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {n.title}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        </div>
                        {!n.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </PopoverContent>
    </Popover>
  );
}
