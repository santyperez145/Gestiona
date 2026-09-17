import { useState, useEffect } from "react";
import { Calendar, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listInfluencerDeliverables, createDeliverable, updateDeliverable, completeDeliverable, deleteDeliverable, listInfluencers } from "@/lib/influencersDB";
import { toast } from "sonner";

/**
 * Entregables con Fechas — Tracking real desde el Core.
 */
export default function InfluencerDeliverablesPage() {
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const [d, inf] = await Promise.all([listInfluencerDeliverables(), listInfluencers()]);
      setDeliverables(d);
      setInfluencers(inf);
    } catch {
      setDeliverables([]);
      setInfluencers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const filtered = deliverables.filter((d) => {
    const q = search.toLowerCase();
    return (d.description || "").toLowerCase().includes(q) || (d.influencer_name || "").toLowerCase().includes(q) || (d.campaign_name || "").toLowerCase().includes(q);
  });

  const pending = deliverables.filter((d) => d.status === "pendiente" || d.status === "en_progreso").length;
  const completed = deliverables.filter((d) => d.status === "completado" || d.status === "entregado").length;
  const overDue = deliverables.filter((d) => new Date(d.due_date) < new Date() && d.status !== "completado" && d.status !== "entregado").length;

  const handleComplete = async (id: string) => {
    await completeDeliverable(id);
    await reload();
    toast.success("Entregable marcado como completado");
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar entregable?")) return;
    await deleteDeliverable(id);
    await reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-semibold">Entregables</h2>
          <p className="text-sm text-muted-foreground">Seguimiento de entregas con fechas reales</p>
        </div>
        <Input placeholder="Buscar entregable…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pendientes</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{pending}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Completados</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{completed}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Vencidos</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{overDue}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total</CardTitle></CardHeader><CardContent className="text-center"><p className="text-2xl font-display font-bold">{deliverables.length}</p></CardContent></Card>
      </div>

      {loading && deliverables.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">Cargando entregables desde el Core…</div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-lg font-display font-semibold">Lista de Entregables</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaña</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Influencer</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Descripción</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fecha Límite</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((d) => (
                    <tr key={d.id} className="hover:bg-muted">
                      <td className="px-4 py-3 text-sm">{d.campaign_name || d.influencer_name || "—"}</td>
                      <td className="px-4 py-3 text-sm">{d.influencer_name || "—"}</td>
                      <td className="px-4 py-3 text-sm">{d.description || "—"}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {d.due_date}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge variant={d.status === "completado" || d.status === "entregado" ? "secondary" : d.status === "en_progreso" ? "default" : "outline"}>
                          {d.status === "pendiente" ? "Pendiente" : d.status === "en_progreso" ? "En Progreso" : d.status === "completado" ? "Completado" : "Entregado"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm flex gap-2">
                        {(d.status === "pendiente" || d.status === "en_progreso") && (
                          <Button size="sm" variant="outline" onClick={() => handleComplete(d.id)}><CheckCircle className="w-3 h-3 mr-1" />Completar</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(d.id)}>Eliminar</Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No hay entregables registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}