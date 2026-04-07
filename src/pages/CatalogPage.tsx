import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSettingsDB, formatARS, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Package, Tag, Download, FileText, Share2 } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { toast } from "sonner";

const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };

function formatARSPlain(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export default function CatalogPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id)]);
      setProducts(p.filter(x => x.stock > 0));
      setSettings(s);
      setLoading(false);
    })();
  }, [user]);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    return true;
  });

  const generatePDF = useCallback(async () => {
    setGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      await import('jspdf-autotable');

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const businessName = settings?.business_name || 'Exentry Imports';
      const primaryColor = settings?.primary_color || '#D4A843';
      const r = parseInt(primaryColor.slice(1, 3), 16);
      const g = parseInt(primaryColor.slice(3, 5), 16);
      const b = parseInt(primaryColor.slice(5, 7), 16);

      // Header
      doc.setFillColor(26, 26, 46);
      doc.rect(0, 0, pageW, 35, 'F');
      doc.setFillColor(r, g, b);
      doc.rect(0, 35, pageW, 2, 'F');

      doc.setTextColor(r, g, b);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text(businessName, 15, 18);

      doc.setTextColor(200, 200, 200);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('CATÁLOGO DE PRODUCTOS', 15, 26);

      const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(8);
      doc.text(today, pageW - 15, 26, { align: 'right' });
      doc.text(`${filtered.length} productos disponibles`, pageW - 15, 31, { align: 'right' });

      // Group by category
      const categories = [...new Set(filtered.map(p => p.category))];
      let startY = 45;

      for (const cat of categories) {
        const catProducts = filtered.filter(p => p.category === cat);

        // Category header
        if (startY > 260) {
          doc.addPage();
          startY = 20;
        }

        doc.setFillColor(r, g, b);
        doc.roundedRect(15, startY - 4, pageW - 30, 8, 1, 1, 'F');
        doc.setTextColor(26, 26, 46);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`  ${getCategoryLabel(cat).toUpperCase()}  (${catProducts.length})`, 18, startY + 1.5);
        startY += 10;

        // Table
        const tableData = catProducts.map(p => [
          p.name,
          p.brand,
          getGenderLabel(p.gender),
          formatARSPlain(Number(p.sale_price_ars)),
          p.discount_price_ars ? formatARSPlain(Number(p.discount_price_ars)) : '—',
          `${p.stock}`,
        ]);

        (doc as any).autoTable({
          startY,
          head: [['Producto', 'Marca', 'Género', 'Precio Lista', 'Precio Oferta', 'Stock']],
          body: tableData,
          margin: { left: 15, right: 15 },
          styles: {
            fontSize: 8.5,
            cellPadding: 2.5,
            textColor: [220, 220, 220],
            fillColor: [30, 30, 50],
            lineColor: [50, 50, 70],
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: [40, 40, 65],
            textColor: [r, g, b],
            fontStyle: 'bold',
            fontSize: 8,
          },
          alternateRowStyles: {
            fillColor: [25, 25, 42],
          },
          columnStyles: {
            0: { cellWidth: 50, fontStyle: 'bold' },
            1: { cellWidth: 30 },
            2: { cellWidth: 22, halign: 'center' },
            3: { cellWidth: 30, halign: 'right' },
            4: { cellWidth: 30, halign: 'right', textColor: p => p ? [r, g, b] : [150, 150, 150] },
            5: { cellWidth: 15, halign: 'center' },
          },
          didParseCell: (data: any) => {
            // Highlight discount prices
            if (data.column.index === 4 && data.cell.raw !== '—') {
              data.cell.styles.textColor = [r, g, b];
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });

        startY = (doc as any).lastAutoTable.finalY + 10;
      }

      // Footer on each page
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pH = doc.internal.pageSize.getHeight();
        doc.setFillColor(26, 26, 46);
        doc.rect(0, pH - 12, pageW, 12, 'F');
        doc.setFillColor(r, g, b);
        doc.rect(0, pH - 12, pageW, 0.5, 'F');
        doc.setTextColor(150, 150, 150);
        doc.setFontSize(7);
        doc.text(`${businessName} — Catálogo generado el ${today}`, 15, pH - 5);
        doc.text(`Página ${i} de ${pageCount}`, pageW - 15, pH - 5, { align: 'right' });
      }

      doc.save(`${businessName.replace(/\s+/g, '_')}_Catalogo_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('Catálogo PDF generado exitosamente');
    } catch (err) {
      console.error(err);
      toast.error('Error al generar el PDF');
    } finally {
      setGenerating(false);
    }
  }, [filtered, settings]);

  const shareCatalog = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings?.business_name || 'Exentry Imports'} — Catálogo`,
          text: `Mirá nuestro catálogo con ${filtered.length} productos disponibles`,
          url: window.location.href,
        });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link del catálogo copiado al portapapeles');
    }
  }, [filtered, settings]);

  if (loading) return <TableSkeleton rows={6} cols={4} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Catálogo</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} productos disponibles</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={shareCatalog}>
            <Share2 className="w-4 h-4 mr-1" /> Compartir
          </Button>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group">
              <div className="aspect-square bg-muted flex items-center justify-center relative">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-12 h-12 text-muted-foreground/30" />
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-background/80 backdrop-blur-sm font-medium">
                    {getCategoryLabel(p.category)}
                  </span>
                </div>
                {p.discount_price_ars && (
                  <div className="absolute top-2 left-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-destructive text-destructive-foreground font-bold flex items-center gap-1">
                      <Tag className="w-3 h-3" />OFERTA
                    </span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm leading-tight flex-1">{p.name}</h3>
                  <span className="text-xs text-muted-foreground ml-2">{GENDER_ICONS[p.gender]}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{p.brand}</p>
                <div className="space-y-1">
                  {p.discount_price_ars ? (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-primary">{formatARS(Number(p.discount_price_ars))}</span>
                        <span className="text-xs text-muted-foreground line-through">{formatARS(Number(p.sale_price_ars))}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Efectivo / Transferencia</p>
                    </>
                  ) : (
                    <span className="text-lg font-bold text-primary">{formatARS(Number(p.sale_price_ars))}</span>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">Stock: {p.stock} uds</span>
                    {getGenderLabel(p.gender) && (
                      <span className="text-[10px] text-muted-foreground">{getGenderLabel(p.gender)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
