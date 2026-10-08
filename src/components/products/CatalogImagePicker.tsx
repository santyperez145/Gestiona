import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { useCatalogImages, type CatalogImageCandidate } from '@/hooks/useCatalogImages';

export default function CatalogImagePicker({ open, onOpenChange, orgId, productId, name, brand, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void; orgId: string | null; productId?: string;
  name: string; brand: string; onSelect: (url: string) => void;
}) {
  const { search, acquire, clear, loading, error, candidates } = useCatalogImages(orgId, productId, name, brand, open);
  const scope = JSON.stringify([open, orgId, productId, name, brand]);
  const [selection, setSelection] = useState<{ scope: string; candidate: CatalogImageCandidate } | null>(null);
  const selected = selection?.scope === scope ? selection.candidate : null;
  const [identityReviewed, setIdentityReviewed] = useState(false);
  const [rightsReviewed, setRightsReviewed] = useState(false);
  useEffect(() => { setSelection(null); setIdentityReviewed(false); setRightsReviewed(false); }, [open, orgId, productId, name, brand]);
  useEffect(() => { if (!open) clear(); }, [open, clear]);
  const choose = (candidate: CatalogImageCandidate) => { setSelection({ scope, candidate }); setIdentityReviewed(false); setRightsReviewed(false); };
  const apply = async () => {
    if (!selected || !identityReviewed || !rightsReviewed || loading) return;
    const url = await acquire(selected);
    if (url) { onSelect(url); onOpenChange(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Imagen del producto</DialogTitle>
          <DialogDescription>Las coincidencias de nombre no garantizan el modelo ni la variante. Revisá el artículo y los derechos en la fuente.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input value={`${brand} ${name}`.trim()} readOnly aria-label="Búsqueda de imagen" className="min-w-0 flex-1" />
          <Button type="button" className="h-10 shrink-0 gap-2" disabled={loading || name.trim().length < 3} onClick={() => { setSelection(null); void search(); }}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Buscar
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {candidates.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {candidates.map(candidate => (
            <article key={candidate.id} className={`overflow-hidden rounded-lg border bg-card ${selected?.id === candidate.id ? 'border-primary' : 'border-border'}`}>
              <img src={candidate.thumbnail} alt={candidate.title} referrerPolicy="no-referrer" loading="lazy" className="aspect-square w-full object-contain" />
              <div className="space-y-2 p-2.5">
                <p className="line-clamp-2 min-h-8 text-xs font-medium">{candidate.title}</p>
                <p className="text-[11px] text-muted-foreground">{candidate.match?.label}</p>
                <p className="text-[11px] text-muted-foreground">{candidate.license === 'cc0' ? 'CC0' : 'Dominio público'}</p>
                <Button type="button" size="sm" variant={selected?.id === candidate.id ? 'default' : 'outline'} className="h-10 w-full" disabled={loading} onClick={() => choose(candidate)}>
                  {selected?.id === candidate.id ? 'Seleccionada' : 'Revisar'}
                </Button>
              </div>
            </article>
          ))}
        </div>}
        {selected && <section className="space-y-3 border-t pt-4" aria-label="Revisión de imagen">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="break-words font-medium">{selected.creator || 'Autor no informado'}</span>
            <Button type="button" size="sm" variant="ghost" className="h-10 gap-1" asChild><a href={selected.source_url} target="_blank" rel="noopener noreferrer">Fuente<ExternalLink className="h-3 w-3" /></a></Button>
            <Button type="button" size="sm" variant="ghost" className="h-10 gap-1" asChild><a href={selected.license_url} target="_blank" rel="noopener noreferrer">Licencia<ExternalLink className="h-3 w-3" /></a></Button>
          </div>
          <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm"><Checkbox className="mt-1" checked={identityReviewed} onCheckedChange={value => setIdentityReviewed(value === true)} disabled={loading} />La imagen representa este artículo, modelo y variante.</label>
          <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm"><Checkbox className="mt-1" checked={rightsReviewed} onCheckedChange={value => setRightsReviewed(value === true)} disabled={loading} />Revisé la fuente y los derechos de uso comercial.</label>
          <Button type="button" className="h-10 w-full gap-2 sm:w-auto" disabled={!identityReviewed || !rightsReviewed || loading} onClick={() => void apply()}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}Copiar y agregar
          </Button>
        </section>}
      </DialogContent>
    </Dialog>
  );
}
