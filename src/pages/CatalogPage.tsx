import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getActiveOrgId } from "@/lib/orgContext";
import { formatARS, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Package, Tag, Download, Share2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { toast } from "sonner";

const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };

function fmtARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

interface CatalogPageProps {
  isPublic?: boolean;
  publicUserId?: string;
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
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

  const fetchData = useCallback(async () => {
    if (!userId) return;
    const orgId = getActiveOrgId();
    if (!orgId) return;
    const [pRes, sRes] = await Promise.all([
      supabase.from('products').select('*').eq('org_id', orgId).gt('stock', 0).order('category').order('name'),
      supabase.from('settings').select('*').eq('org_id', orgId).maybeSingle(),
    ]);
    setProducts(pRes.data || []);
    setSettings(sRes.data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Realtime: auto-update when products or settings change
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('catalog-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchData]);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    return true;
  });

  const generatePDF = useCallback(async () => {
    if (!filtered.length) return;
    setGenerating(true);
    try {
      const { default: jsPDF } = await import('jspdf');

      const doc = new jsPDF('p', 'mm', 'a4');
      const W = doc.internal.pageSize.getWidth();   // 210
      const H = doc.internal.pageSize.getHeight();   // 297
      const businessName = settings?.business_name || 'Exentry Imports';
      const hex = settings?.primary_color || '#D4A843';
      const pR = parseInt(hex.slice(1, 3), 16);
      const pG = parseInt(hex.slice(3, 5), 16);
      const pB = parseInt(hex.slice(5, 7), 16);
      const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

      // Preload images
      const imageCache: Record<string, string | null> = {};
      const imageUrls = [...new Set(filtered.map(p => p.image_url).filter(Boolean))];
      await Promise.all(imageUrls.map(async (url) => {
        imageCache[url] = await loadImageAsBase64(url);
      }));

      const drawHeader = () => {
        doc.setFillColor(20, 20, 40);
        doc.rect(0, 0, W, 28, 'F');
        doc.setFillColor(pR, pG, pB);
        doc.rect(0, 28, W, 1.5, 'F');

        doc.setTextColor(pR, pG, pB);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(businessName.toUpperCase(), 12, 14);

        doc.setTextColor(180, 180, 190);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text('CATÁLOGO DE PRODUCTOS', 12, 21);
        doc.text(today, W - 12, 21, { align: 'right' });

        return 35; // Y after header
      };

      const drawFooter = () => {
        doc.setFillColor(20, 20, 40);
        doc.rect(0, H - 10, W, 10, 'F');
        doc.setFillColor(pR, pG, pB);
        doc.rect(0, H - 10, W, 0.4, 'F');
      };

      // Card dimensions
      const COLS = 3;
      const margin = 12;
      const gap = 5;
      const cardW = (W - margin * 2 - gap * (COLS - 1)) / COLS; // ~58.67
      const imgH = cardW * 0.7; // image area height
      const textH = 38; // text area height — more room for stacked prices
      const cardH = imgH + textH;

      // Group by category
      const categories = [...new Set(filtered.map(p => p.category))];
      let y = drawHeader();
      let pageNum = 1;

      const newPage = () => {
        drawFooter();
        doc.addPage();
        pageNum++;
        y = drawHeader();
      };

      for (const cat of categories) {
        const catProducts = filtered.filter(p => p.category === cat);

        // Category header
        if (y + 10 > H - 15) newPage();

        doc.setFillColor(pR, pG, pB);
        doc.roundedRect(margin, y, W - margin * 2, 7, 1.5, 1.5, 'F');
        doc.setTextColor(20, 20, 40);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${getCategoryLabel(cat).toUpperCase()}  —  ${catProducts.length} producto${catProducts.length > 1 ? 's' : ''}`, margin + 4, y + 5);
        y += 11;

        // Draw product cards in grid
        for (let i = 0; i < catProducts.length; i++) {
          const col = i % COLS;
          if (col === 0 && i > 0) y += cardH + gap;
          if (y + cardH > H - 15) {
            newPage();
          }

          const p = catProducts[i];
          const x = margin + col * (cardW + gap);

          // Card background
          doc.setFillColor(30, 30, 52);
          doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F');

          // Card border
          doc.setDrawColor(50, 50, 75);
          doc.setLineWidth(0.3);
          doc.roundedRect(x, y, cardW, cardH, 2, 2, 'S');

          // Image area
          doc.setFillColor(25, 25, 45);
          doc.rect(x + 0.5, y + 0.5, cardW - 1, imgH - 1, 'F');

          if (p.image_url && imageCache[p.image_url]) {
            try {
              doc.addImage(imageCache[p.image_url]!, 'JPEG', x + 1, y + 1, cardW - 2, imgH - 2);
            } catch {
              // fallback: no image
              doc.setTextColor(80, 80, 100);
              doc.setFontSize(7);
              doc.text('Sin imagen', x + cardW / 2, y + imgH / 2, { align: 'center' });
            }
          } else {
            doc.setTextColor(80, 80, 100);
            doc.setFontSize(7);
            doc.text('Sin imagen', x + cardW / 2, y + imgH / 2, { align: 'center' });
          }

          // Discount badge
          if (p.discount_price_ars && p.discount_price_ars < p.sale_price_ars) {
            const pct = Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100);
            doc.setFillColor(220, 40, 40);
            doc.roundedRect(x + 1.5, y + 1.5, 14, 5, 1, 1, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            doc.text(`-${pct}%`, x + 8.5, y + 5, { align: 'center' });
          }

          // Gender badge (for perfumes)
          const isPerfume = p.category === 'perfume_arabe' || p.category === 'perfume_diseñador';
          if (isPerfume && p.gender) {
            const gLabel = p.gender === 'masculino' ? '♂ MASC' : p.gender === 'femenino' ? '♀ FEM' : '⚥ UNI';
            const gW = doc.getTextWidth(gLabel) + 5;
            // Gender badge colors
            const gBg = p.gender === 'masculino' ? [40, 60, 120] : p.gender === 'femenino' ? [120, 40, 80] : [80, 50, 120];
            doc.setFillColor(gBg[0], gBg[1], gBg[2]);
            doc.roundedRect(x + cardW - gW - 2, y + imgH - 6.5, gW, 5, 1, 1, 'F');
            doc.setTextColor(200, 210, 255);
            doc.setFontSize(5.5);
            doc.setFont('helvetica', 'bold');
            doc.text(gLabel, x + cardW - 4, y + imgH - 3.2, { align: 'right' });
          }

          // Category pill
          const catLabel = getCategoryLabel(p.category);
          const pillW = doc.getTextWidth(catLabel) + 4;
          doc.setFillColor(20, 20, 40);
          doc.roundedRect(x + cardW - pillW - 2, y + 1.5, pillW, 4.5, 1, 1, 'F');
          doc.setTextColor(160, 160, 180);
          doc.setFontSize(5);
          doc.setFont('helvetica', 'normal');
          doc.text(catLabel, x + cardW - 3.5, y + 4.5, { align: 'right' });

          // Text area
          const tY = y + imgH + 3;

          // Product name (larger)
          doc.setTextColor(235, 235, 245);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          const nameLines = doc.splitTextToSize(p.name, cardW - 6);
          doc.text(nameLines.slice(0, 2), x + 3, tY + 3.5);
          const nameOffset = Math.min(nameLines.length, 2) * 3.8;

          // Brand + gender
          doc.setTextColor(150, 150, 170);
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.text(`${p.brand} · ${getGenderLabel(p.gender)}`, x + 3, tY + nameOffset + 4);

          // Separator line
          doc.setDrawColor(50, 50, 75);
          doc.setLineWidth(0.2);
          doc.line(x + 3, tY + nameOffset + 6.5, x + cardW - 3, tY + nameOffset + 6.5);

          // Prices — stacked vertically
          if (p.discount_price_ars && p.discount_price_ars < p.sale_price_ars) {
            // Discount price (large, primary color) — Efectivo/Transferencia
            doc.setTextColor(pR, pG, pB);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(fmtARS(Number(p.discount_price_ars)), x + 3, tY + nameOffset + 11.5);
            doc.setFontSize(5);
            doc.setFont('helvetica', 'normal');
            doc.text('Efectivo / Transferencia', x + 3, tY + nameOffset + 14.5);

            // List price (no strikethrough) — Tarjeta
            doc.setTextColor(180, 180, 195);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(fmtARS(Number(p.sale_price_ars)), x + 3, tY + nameOffset + 19);
            doc.setFontSize(5);
            doc.text('Tarjeta hasta 3 cuotas sin interés', x + 3, tY + nameOffset + 22);
          } else {
            doc.setTextColor(pR, pG, pB);
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text(fmtARS(Number(p.sale_price_ars)), x + 3, tY + nameOffset + 12.5);
          }

          // Stock (only non-public)
          if (!isPublic) {
            doc.setTextColor(100, 100, 120);
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.text(`Stock: ${p.stock}`, x + cardW - 3, tY + nameOffset + 17.5, { align: 'right' });
          }
        }

        // After last row of this category
        const lastRowItems = catProducts.length % COLS || COLS;
        if (lastRowItems > 0) y += cardH + gap;
        y += 3; // extra space between categories
      }

      drawFooter();

      // Page numbers
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setTextColor(120, 120, 140);
        doc.setFontSize(6);
        doc.text(`${businessName} · ${today}`, 12, H - 4);
        doc.text(`${i} / ${totalPages}`, W - 12, H - 4, { align: 'right' });
      }

      doc.save(`${businessName.replace(/\s+/g, '_')}_Catalogo.pdf`);
      toast.success('Catálogo PDF descargado');
    } catch (err) {
      console.error('PDF error:', err);
      toast.error('Error al generar el PDF');
    } finally {
      setGenerating(false);
    }
  }, [filtered, settings, isPublic]);

  const printQR = useCallback(() => {
    const url = `${window.location.origin}/catalogo/${userId}`;
    const name = settings?.business_name || "Catálogo";
    const svgEl = document.getElementById("catalog-qr-svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>@page{margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;padding:40px}h2{font-size:24px;font-weight:700;margin:0 0 8px}p{font-size:12px;color:#666;margin:8px 0}svg{max-width:300px;max-height:300px}</style></head>
<body><h2>${name}</h2><p>Escaneá para ver el catálogo</p>${svgData}<p>${url}</p></body></html>`;
    const w = window.open("", "_blank", "width=400,height=500");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); w.close(); }
  }, [userId, settings]);

  const shareCatalog = useCallback(async () => {
    const url = `${window.location.origin}/catalogo/${userId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings?.business_name || 'Exentry Imports'} — Catálogo`,
          text: `Mirá nuestro catálogo con ${filtered.length} productos disponibles`,
          url,
        });
      } catch { /* cancelled */ }
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
            <>
              {/* Hidden QR for printing */}
              <div className="hidden">
                <QRCodeSVG
                  id="catalog-qr-svg"
                  value={`${window.location.origin}/catalogo/${userId}`}
                  size={300}
                  level="H"
                />
              </div>
              <Button variant="outline" size="sm" onClick={printQR} title="Imprimir QR del catálogo">
                <QrCode className="w-4 h-4 mr-1" /> QR
              </Button>
              <Button variant="outline" size="sm" onClick={shareCatalog}>
                <Share2 className="w-4 h-4 mr-1" /> Compartir
              </Button>
            </>
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
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(p => (
            <div key={p.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group">
              <div className="aspect-square bg-muted flex items-center justify-center relative">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-12 h-12 text-muted-foreground/30" />
                )}
                <div className="absolute top-2 right-2">
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
                      <div>
                        <span className="text-base font-bold text-primary">{formatARS(Number(p.discount_price_ars))}</span>
                        <p className="text-[10px] text-muted-foreground">Efectivo / Transferencia</p>
                      </div>
                      <div className="mt-1">
                        <span className="text-xs text-muted-foreground">{formatARS(Number(p.sale_price_ars))}</span>
                        <p className="text-[10px] text-muted-foreground">Tarjeta hasta 3 cuotas sin interés</p>
                      </div>
                    </>
                  ) : (
                    <span className="text-base font-bold text-primary">{formatARS(Number(p.sale_price_ars))}</span>
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
      )}
    </div>
  );
}
