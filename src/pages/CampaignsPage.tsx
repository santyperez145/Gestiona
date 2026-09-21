import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Megaphone, Plus, RefreshCw, Users2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createInfluencerCampaign, listInfluencerCampaigns, type CreateInfluencerCampaign, type InfluencerCampaign } from "@/lib/influencersDB";

const STATUS: Record<InfluencerCampaign["status"], string> = {
  draft: "Borrador", recruiting: "Buscando creadores", active: "Activa",
  review: "En revisión", completed: "Completada", cancelled: "Cancelada",
};

const emptyForm: CreateInfluencerCampaign = {
  name: "", objective: "", channel: "instagram", budget_ars: 0,
  starts_on: null, ends_on: null,
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<InfluencerCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateInfluencerCampaign>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setCampaigns(await listInfluencerCampaigns()); }
    catch (cause) { setCampaigns([]); setError(cause instanceof Error ? cause.message : "No pudimos cargar las campañas."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    active: campaigns.filter(campaign => ["recruiting", "active", "review"].includes(campaign.status)).length,
    creators: campaigns.reduce((sum, campaign) => sum + (campaign.creator_count || 0), 0),
    budget: campaigns.filter(campaign => campaign.status !== "cancelled").reduce((sum, campaign) => sum + Number(campaign.budget_ars || 0), 0),
  }), [campaigns]);

  const submit = async () => {
    if (form.name.trim().length < 3 || form.objective.trim().length < 3 || !Number.isFinite(form.budget_ars) || form.budget_ars < 0) {
      toast.error("Completá nombre, objetivo y un presupuesto válido."); return;
    }
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      toast.error("La fecha de cierre no puede ser anterior al inicio."); return;
    }
    setSaving(true);
    try {
      await createInfluencerCampaign(form);
      toast.success("Campaña creada como borrador");
      setOpen(false); setForm(emptyForm); await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No pudimos crear la campaña.");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Influencers · Operación</p>
          <h1 className="mt-1 text-2xl font-display font-bold">Campañas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Presupuesto, objetivo, calendario e invitaciones en una única fuente de verdad.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</Button>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Nueva campaña</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Megaphone} label="En curso" value={String(totals.active)} />
        <Metric icon={Users2} label="Creadores invitados" value={String(totals.creators)} />
        <Metric icon={WalletCards} label="Presupuesto planificado" value={formatARS(totals.budget)} />
      </div>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Reintentar</Button></div>}
      {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cargando campañas…</div>
        : !error && campaigns.length === 0 ? <EmptyCampaigns onCreate={() => setOpen(true)} />
        : !error && <div className="grid gap-3 lg:grid-cols-2">{campaigns.map(campaign => <CampaignCard key={campaign.id} campaign={campaign} />)}</div>}

      <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Nueva campaña</DialogTitle><DialogDescription>Se guarda como borrador. Después podés invitar creadores desde Descubrir.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-1.5 text-sm font-medium">Nombre<Input value={form.name} maxLength={120} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Lanzamiento primavera" /></label>
            <label className="grid gap-1.5 text-sm font-medium">Objetivo<Textarea value={form.objective} maxLength={1000} onChange={event => setForm(current => ({ ...current, objective: event.target.value }))} placeholder="Qué resultado de negocio y contenido buscamos" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">Canal<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.channel} onChange={event => setForm(current => ({ ...current, channel: event.target.value as CreateInfluencerCampaign["channel"] }))}><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="multicanal">Multicanal</option></select></label>
              <label className="grid gap-1.5 text-sm font-medium">Presupuesto ARS<Input type="number" min={0} step="0.01" value={form.budget_ars} onChange={event => setForm(current => ({ ...current, budget_ars: Number(event.target.value) }))} /></label>
              <label className="grid gap-1.5 text-sm font-medium">Inicio<Input type="date" value={form.starts_on || ""} onChange={event => setForm(current => ({ ...current, starts_on: event.target.value || null }))} /></label>
              <label className="grid gap-1.5 text-sm font-medium">Cierre<Input type="date" value={form.ends_on || ""} onChange={event => setForm(current => ({ ...current, ends_on: event.target.value || null }))} /></label>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear borrador</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Megaphone; label: string; value: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"><Icon className="h-4 w-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></div></CardContent></Card>;
}
function CampaignCard({ campaign }: { campaign: InfluencerCampaign }) {
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{campaign.name}</h2><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{campaign.objective}</p></div><Badge variant="outline">{STATUS[campaign.status]}</Badge></div><div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/70 pt-4 text-xs"><span><b className="block text-sm text-foreground">{formatARS(campaign.budget_ars)}</b><span className="text-muted-foreground">Presupuesto</span></span><span><b className="block text-sm text-foreground">{campaign.creator_count || 0}</b><span className="text-muted-foreground">Creadores</span></span><span><b className="block text-sm capitalize text-foreground">{campaign.channel}</b><span className="text-muted-foreground">Canal</span></span></div>{(campaign.starts_on || campaign.ends_on) && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{campaign.starts_on || "Sin inicio"} — {campaign.ends_on || "Sin cierre"}</p>}</CardContent></Card>;
}
function EmptyCampaigns({ onCreate }: { onCreate: () => void }) {
  return <div className="rounded-xl border border-dashed border-border p-10 text-center"><Megaphone className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-3 font-semibold">Creá la primera campaña</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Definí el objetivo y presupuesto; luego invitá creadores y seguí cada colaboración.</p><Button size="sm" className="mt-4" onClick={onCreate}><Plus className="mr-2 h-4 w-4" />Nueva campaña</Button></div>;
}
function formatARS(value: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
