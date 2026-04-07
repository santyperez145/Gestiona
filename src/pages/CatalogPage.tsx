import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Package, Tag, Download, Share2 } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { toast } from "sonner";

const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };

function formatARSShort(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

interface CatalogPageProps {
  isPublic?: boolean;
  publicUserId?: string;
}

export default function CatalogPage({ isPublic, publicUserId }: CatalogPageProps) {
  const auth = useAuth();
  const userId = isPublic ? publicUserId : auth?.user?.id;
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const catalogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [pRes, sRes] = await Promise.all([
        supabase.from('products').select('*').eq('user_id', userId).gt('stock', 0).order('category').order('name'),
        supabase.from('settings').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      setProducts(pRes.data || []);
      setSettings(sRes.data);
      setLoading(false);
    })();
  }, [userId]);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    return true;
  });

  const generatePDF = useCallback(async () => {
    if (!catalogRef.current || !filtered.length) return;
    setGenerating(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { default: jsPDF } = await import('jspdf');

      const element = catalogRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#1A1A2E',
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgWidth = 210; // A4 mm
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const businessName = settings?.business_name || 'Exentry Imports';

      let heightLeft = imgHeight;
      let position = 0;
      let page = 1;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        page++;
      }

      // Add footer on each page
      const totalPages = pdf.getNumberOfPages();
      const today = new Date().toLocaleDateString('es-AR');
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`${businessName} — ${today} — Pág. ${i}/${totalPages}`, 105, 293, { align: 'center' });
      }

      pdf.save(`${businessName.replace(/\s+/g, '_')}_Catalogo.pdf`);
      toast.success('Catálogo PDF descargado');
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Error al generar el PDF');
    } finally {
      setGenerating(false);
    }
  }, [filtered, settings]);

  const shareCatalog = useCallback(async () => {
    const url = `${window.location.origin}/catalogo/${userId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings?.business_name || 'Exentry Imports'} — Catálogo`,
          text: `Mirá nuestro catálogo con ${filtered.length} productos disponibles`,
          url,
        });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link del catálogo copiado al portapapeles');
    }
  }, [filtered, settings, userId]);

  if (loading) return <TableSkeleton rows={6} cols={4} />;

  const businessName = settings?.business_name || 'Exentry Imports';

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">{isPublic ? businessName : 'Catálogo'}</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} productos disponibles</p>
        </div>
        <div className="flex gap-2">
          {!isPublic && (
            <Button variant="outline" size="sm" onClick={shareCatalog}>
              <Share2 className="w-4 h-4 mr-1" /> Compartir
            </Button>
          )}
          <Button size="sm" onClick={generatePDF} disabled={generating || !filtered.length}>
            <Download className="w-4 h-4 mr-1" />
            {generating ? 'Generando...' : 'Descargar PDF'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar producto o marca..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted border-border" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[160px] bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            <SelectItem value="perfume_arabe">Perfume Árabe</SelectItem>
            <SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem>
            <SelectItem value="vaper">Vaper</SelectItem>
            <SelectItem value="electronico">Electrónico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Package} title="No hay productos disponibles" description="No se encontraron productos con stock." />
      ) : (
        <div ref={catalogRef} className="bg-background p-4 rounded-xl">
          {/* PDF Header - visible in PDF capture */}
          <div className="text-center mb-6 pb-4 border-b border-border">
            <h2 className="text-xl font-bold text-primary">{businessName}</h2>
            <p className="text-xs text-muted-foreground">Catálogo de Productos — {new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group">
                <div className="aspect-square bg-muted flex items-center justify-center relative">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" crossOrigin="anonymous" />
                  ) : (
                    <Package className="w-12 h-12 text-muted-foreground/30" />
                  )}
                  <div className="absolute top-2 right-2 flex gap-1">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-background/80 backdrop-blur-sm font-medium">
                      {getCategoryLabel(p.category)}
                    </span>
                  </div>
                  {p.discount_price_ars && p.discount_price_ars < p.sale_price_ars && (
                    <div className="absolute top-2 left-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-destructive text-destructive-foreground font-bold flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100)}% OFF
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-semibold text-sm leading-tight flex-1">{p.name}</h3>
                    <span className="text-xs text-muted-foreground ml-1">{GENDER_ICONS[p.gender]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{p.brand}</p>
                  <div className="space-y-1">
                    {p.discount_price_ars && p.discount_price_ars < p.sale_price_ars ? (
                      <>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-base font-bold text-primary">{formatARSShort(Number(p.discount_price_ars))}</span>
                          <span className="text-[10px] text-muted-foreground line-through">{formatARSShort(Number(p.sale_price_ars))}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Efectivo / Transferencia</p>
                      </>
                    ) : (
                      <span className="text-base font-bold text-primary">{formatARSShort(Number(p.sale_price_ars))}</span>
                    )}
                    {!isPublic && (
                      <div className="flex items-center justify-between pt-1.5 border-t border-border">
                        <span className="text-[10px] text-muted-foreground">Stock: {p.stock}</span>
                        <span className="text-[10px] text-muted-foreground">{getGenderLabel(p.gender)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
