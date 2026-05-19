import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
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
import PageHeader from "@/components/shared/PageHeader";

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
    const channel = safeChannel('catalog-realtime', userId)
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
      // ─── detect vaper-only catalog ───────────────────────────────────────────
      const isVaperMode = filtered.every(p => p.category === 'vaper') || filterCat === 'vaper';
      const doc = new jsPDF('p', 'mm', 'a4');
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const bName = settings?.business_name || 'Exentry Imports';
      const hex = settings?.primary_color || '#D4A843';
      const pR = parseInt(hex.slice(1, 3), 16);
      const pG = parseInt(hex.slice(3, 5), 16);
      const pB = parseInt(hex.slice(5, 7), 16);
      const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
      const publicUrl = `${window.location.origin}/catalogo/${userId}`;
      const catLabel = filterCat !== 'all' ? getCategoryLabel(filterCat) : 'Todos los productos';

      // QR code → canvas → PNG
      let qrDataUrl: string | null = null;
      try {
        const svgEl = document.getElementById('catalog-qr-svg');
        if (svgEl) {
          const svgData = new XMLSerializer().serializeToString(svgEl);
          const canvas = document.createElement('canvas');
          canvas.width = 300; canvas.height = 300;
          const ctx = canvas.getContext('2d')!;
          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => { ctx.drawImage(img, 0, 0, 300, 300); res(); };
            img.onerror = rej;
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
          });
          qrDataUrl = canvas.toDataURL('image/png');
        }
      } catch { /* no QR */ }

      // Preload product images
      const imageCache: Record<string, string | null> = {};
      const imageUrls = [...new Set(filtered.map(p => p.image_url).filter(Boolean))];
      await Promise.all(imageUrls.map(async (url) => {
        imageCache[url] = await loadImageAsBase64(url);
      }));

      // ── COVER PAGE ───────────────────────────────────────────────────────
      doc.setFillColor(14, 14, 28);
      doc.rect(0, 0, W, H, 'F');

      // Top accent bar
      doc.setFillColor(pR, pG, pB);
      doc.rect(0, 0, W, 3, 'F');

      // Decorative circle top-right
      doc.setFillColor(Math.round(pR * 0.08 + 14), Math.round(pG * 0.08 + 14), Math.round(pB * 0.08 + 28));
      doc.circle(W + 28, -28, 88, 'F');
      doc.setFillColor(14, 14, 28);
      doc.circle(W + 28, -28, 70, 'F');

      // Business name — last word in primary color
      const nameParts = bName.trim().split(' ');
      const lastWord = nameParts.pop() || '';
      const firstPart = nameParts.join(' ');
      doc.setFontSize(40);
      doc.setFont('helvetica', 'bold');
      const fullW = doc.getTextWidth((firstPart ? firstPart + ' ' : '') + lastWord);
      const nameStartX = W / 2 - fullW / 2;
      if (firstPart) {
        doc.setTextColor(235, 235, 248);
        doc.text(firstPart + ' ', nameStartX, 110);
        doc.setTextColor(pR, pG, pB);
        doc.text(lastWord, nameStartX + doc.getTextWidth(firstPart + ' '), 110);
      } else {
        doc.setTextColor(pR, pG, pB);
        doc.text(lastWord, W / 2, 110, { align: 'center' });
      }

      // Subtitle
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(155, 155, 178);
      doc.text('CATÁLOGO DE PRODUCTOS', W / 2, 121, { align: 'center' });

      // Separator
      doc.setFillColor(pR, pG, pB);
      doc.rect(W / 2 - 20, 126, 40, 0.7, 'F');

      // Category pill
      doc.setFillColor(pR, pG, pB);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const pillTxt = catLabel.toUpperCase();
      const pillW = doc.getTextWidth(pillTxt) + 14;
      doc.roundedRect(W / 2 - pillW / 2, 131, pillW, 9, 2.5, 2.5, 'F');
      doc.setTextColor(14, 14, 28);
      doc.text(pillTxt, W / 2, 137.2, { align: 'center' });

      // Count + date
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(175, 175, 198);
      doc.text(`${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`, W / 2, 149, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(115, 115, 138);
      doc.text(today, W / 2, 157, { align: 'center' });

      // QR bottom-right
      if (qrDataUrl) {
        const qrS = 36;
        const qrX = W - 18 - qrS;
        const qrY = H - 20 - qrS;
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(qrX - 3, qrY - 3, qrS + 6, qrS + 6, 3, 3, 'F');
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrS, qrS);
        doc.setFontSize(5.5);
        doc.setTextColor(115, 115, 138);
        doc.text('Catálogo online', qrX + qrS / 2, qrY + qrS + 6, { align: 'center' });
      }

      // Footer bar
      doc.setFillColor(20, 20, 36);
      doc.rect(0, H - 14, W, 14, 'F');
      doc.setFillColor(pR, pG, pB);
      doc.rect(0, H - 14, W, 0.5, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(155, 155, 178);
      doc.text(publicUrl, W / 2, H - 5.5, { align: 'center' });

      // ── PRODUCT PAGES ────────────────────────────────────────────────────
      if (isVaperMode) {
        // Load flavor variants
        const variantRows: any[] = [];
        const { data: vData } = await supabase
          .from('product_variants').select('*')
          .in('product_id', filtered.map(p => p.id)).order('variant_name');
        if (vData) variantRows.push(...vData);
        const variantsByProduct: Record<string, any[]> = {};
        for (const v of variantRows) {
          if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
          variantsByProduct[v.product_id].push(v);
        }

        // ── Layout constants ──────────────────────────────────────────────────
        const BG: [number, number, number] = [10, 12, 40];   // dark navy
        const gM = 9;                                         // side margin
        const GCOLS = 4;
        const gGap = 4;
        const cellW  = (W - gM * 2 - gGap * (GCOLS - 1)) / GCOLS;   // ≈ 45 mm
        const cellImgH = 40;
        const cellTextH = 14;
        const cellH = cellImgH + cellTextH;
        const rowGap = 5;

        const HEADER_H1 = 78;   // first page header height
        const HEADER_HC = 28;   // continuation header height
        const FOOTER_H  = 28;
        const GRID_PAD  = 4;    // gap above/below grid

        const rowsFirstPage = Math.floor((H - HEADER_H1 - GRID_PAD * 2 - FOOTER_H) / (cellH + rowGap));
        const rowsContPage  = Math.floor((H - HEADER_HC - GRID_PAD * 2 - FOOTER_H) / (cellH + rowGap));

        // Social handle for footer
        const socialHandle = `@${bName.replace(/\s+/g, '').toUpperCase()}`;

        // ── Helpers ───────────────────────────────────────────────────────────
        const fillBg = () => {
          doc.setFillColor(...BG);
          doc.rect(0, 0, W, H, 'F');
        };

        const drawFirstHeader = (brand: string, model: string, puffs: string | null, eff: number, twoX: number) => {
          // Brand box (white rounded rect centered)
          doc.setFontSize(26);
          doc.setFont('helvetica', 'bold');
          const bTxt = brand;
          const bBoxW = doc.getTextWidth(bTxt) + 24;
          const bBoxX = W / 2 - bBoxW / 2;
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(bBoxX, 10, bBoxW, 20, 3, 3, 'F');
          doc.setTextColor(15, 15, 15);
          doc.text(bTxt, W / 2, 24, { align: 'center' });

          // Model name (accent color)
          let curY = 40;
          if (model) {
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(pR, pG, pB);
            doc.text(model, W / 2, curY, { align: 'center' });
            curY += 9;
          }

          // Puffs
          if (puffs) {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(195, 195, 220);
            doc.text(puffs, W / 2, curY, { align: 'center' });
            curY += 9;
          }

          // Separator
          curY += 2;
          doc.setDrawColor(50, 52, 80);
          doc.setLineWidth(0.4);
          doc.line(W / 2 - 35, curY, W / 2 + 35, curY);
          curY += 7;

          // 1X price (accent color, large)
          doc.setFontSize(20);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(pR, pG, pB);
          doc.text(`1X  ${fmtARS(eff)}`, W / 2, curY, { align: 'center' });
          curY += 12;

          // 2X price (white, large)
          doc.setFontSize(20);
          doc.setTextColor(230, 230, 250);
          doc.text(`2X  ${fmtARS(twoX)}`, W / 2, curY, { align: 'center' });
        };

        const drawContHeader = (brand: string, model: string) => {
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          doc.text(`${brand} ${model}`, W / 2, 16, { align: 'center' });
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(pR, pG, pB);
          doc.text('continuación', W / 2, 23, { align: 'center' });
        };

        const drawFooter = () => {
          // Social handle
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(pR, pG, pB);
          doc.text(socialHandle, W / 2, H - 14, { align: 'center' });
          // URL / date
          doc.setFontSize(6.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 82, 115);
          doc.text(publicUrl, W / 2, H - 6, { align: 'center' });
        };

        // ── SOLD OUT diagonal stamp ───────────────────────────────────────────
        const drawSoldOutStamp = (cx: number, cy: number, cw: number, ch: number) => {
          // Thick diagonal red band (thick stroke line)
          doc.setDrawColor(210, 25, 25);
          doc.setLineWidth(13);
          doc.line(cx + 4, cy + ch - 4, cx + cw - 4, cy + 4);
          // Thinner white outline lines for contrast
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.6);
          const offset = 7;
          doc.line(cx + 4 - offset * 0.6, cy + ch - 4 + offset * 0.8,
                   cx + cw - 4 - offset * 0.6, cy + 4 + offset * 0.8);
          doc.line(cx + 4 + offset * 0.6, cy + ch - 4 - offset * 0.8,
                   cx + cw - 4 + offset * 0.6, cy + 4 - offset * 0.8);
          // "SOLD OUT" text at angle
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(9.5);
          doc.setFont('helvetica', 'bold');
          const angle = Math.atan2(ch - 8, cw - 8) * 180 / Math.PI;
          doc.text('SOLD OUT', cx + cw / 2, cy + ch / 2 + 2, { align: 'center', angle });
        };

        // ── Draw flavor grid rows ─────────────────────────────────────────────
        const drawGridRows = (
          variants: any[],
          startIdx: number,
          maxRows: number,
          gridY: number,
          productImgData: string | null
        ) => {
          let idx = startIdx;
          for (let row = 0; row < maxRows && idx < variants.length; row++) {
            for (let col = 0; col < GCOLS && idx < variants.length; col++) {
              const v = variants[idx++];
              const inStock = v.stock > 0;
              const cellX = gM + col * (cellW + gGap);
              const cellY = gridY + row * (cellH + rowGap);

              // Cell image bg (slightly lighter than page bg)
              doc.setFillColor(22, 25, 55);
              doc.roundedRect(cellX, cellY, cellW, cellImgH, 3, 3, 'F');

              // Product image
              if (productImgData) {
                try {
                  doc.addImage(productImgData, 'JPEG', cellX, cellY, cellW, cellImgH);
                } catch { /* */ }
              }

              // SOLD OUT diagonal stamp
              if (!inStock) {
                drawSoldOutStamp(cellX, cellY, cellW, cellImgH);
              }

              // Flavor name centered below image
              const flavorY = cellY + cellImgH + 3;
              doc.setFontSize(6.5);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(inStock ? 240 : 100, inStock ? 240 : 100, inStock ? 255 : 120);
              const fLines = doc.splitTextToSize((v.variant_name as string).toUpperCase(), cellW - 2);
              doc.text(fLines.slice(0, 2), cellX + cellW / 2, flavorY + 5, { align: 'center' });

              if (!isPublic) {
                doc.setFontSize(5);
                doc.setTextColor(70, 72, 105);
                doc.text(`${v.stock}u`, cellX + cellW - 1, flavorY + 5, { align: 'right' });
              }
            }
          }
          return idx;
        };

        // ── Render each product ───────────────────────────────────────────────
        for (const p of filtered) {
          const variants = variantsByProduct[p.id] || [];
          const effPrice = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)
            ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
          const twoXPrice = p.price_2x_ars ? Number(p.price_2x_ars) : effPrice * 2;

          const puffsMatch = p.name.match(/(\d+\.?\d*)\s*[Kk]\b/);
          const puffsNum = puffsMatch ? parseFloat(puffsMatch[1]) * 1000 : null;
          const puffsLabel = puffsNum
            ? `${new Intl.NumberFormat('es-AR').format(puffsNum)} PUFFS`
            : null;
          const brandWord = (p.brand || '').toUpperCase() || p.name.split(/\s+/)[0].toUpperCase();
          const modelWord = p.name.replace(new RegExp(`^${(p.brand || '').trim()}\\s*`, 'i'), '').toUpperCase();
          const imgData = p.image_url ? (imageCache[p.image_url] ?? null) : null;

          let variantIdx = 0;
          let isFirstPage = true;

          do {
            doc.addPage();
            fillBg();

            const hH = isFirstPage ? HEADER_H1 : HEADER_HC;
            if (isFirstPage) {
              drawFirstHeader(brandWord, modelWord, puffsLabel, effPrice, twoXPrice);
            } else {
              drawContHeader(brandWord, modelWord);
            }

            const gridY = hH + GRID_PAD;
            const maxRows = isFirstPage ? rowsFirstPage : rowsContPage;

            if (variants.length === 0) {
              // No variants — large centered product image
              const sW = 90, sH = 110;
              const sX = W / 2 - sW / 2, sY = gridY + 8;
              doc.setFillColor(22, 25, 55);
              doc.roundedRect(sX, sY, sW, sH, 4, 4, 'F');
              if (imgData) {
                try { doc.addImage(imgData, 'JPEG', sX, sY, sW, sH); } catch { /* */ }
              }
              if (!isPublic) {
                doc.setFontSize(7);
                doc.setTextColor(80, 82, 115);
                doc.text(`Stock: ${p.stock} u.`, W / 2, sY + sH + 9, { align: 'center' });
              }
            } else {
              variantIdx = drawGridRows(variants, variantIdx, maxRows, gridY, imgData);
            }

            drawFooter();
            isFirstPage = false;
          } while (variantIdx < variants.length);
        }

        // Page numbers on vaper product pages (skip cover + back cover)
        const totalVP = doc.getNumberOfPages();
        for (let i = 2; i <= totalVP - 1; i++) {
          doc.setPage(i);
          doc.setFontSize(6);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 62, 95);
          doc.text(`${i - 1} / ${totalVP - 2}`, W / 2, H - 1, { align: 'center' });
        }

      } else {
        // ── Standard 2-column grid layout ────────────────────────────────────
        const COLS = 2;
        const margin = 12;
        const gap = 6;
        const cardW = (W - margin * 2 - gap) / COLS;
        const imgH = 64;
        const textH = 46;
        const cardH = imgH + textH;
        const headerH = 32;
        const footerH = 10;

        const drawPageHeader = () => {
          doc.setFillColor(20, 20, 40);
          doc.rect(0, 0, W, headerH, 'F');
          doc.setFillColor(pR, pG, pB);
          doc.rect(0, headerH, W, 1.2, 'F');
          doc.setTextColor(pR, pG, pB);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text(bName.toUpperCase(), 12, 16);
          doc.setTextColor(175, 175, 198);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.text('CATÁLOGO DE PRODUCTOS', 12, 24);
          doc.setTextColor(115, 115, 138);
          doc.text(today, W - 12, 24, { align: 'right' });
        };

        const drawPageFooter = (pageN: number, total: number) => {
          doc.setFillColor(20, 20, 40);
          doc.rect(0, H - footerH, W, footerH, 'F');
          doc.setFillColor(pR, pG, pB);
          doc.rect(0, H - footerH, W, 0.4, 'F');
          doc.setFontSize(6);
          doc.setTextColor(115, 115, 138);
          doc.text(`${bName} · ${today}`, 12, H - 3.2);
          doc.text(`${pageN} / ${total}`, W - 12, H - 3.2, { align: 'right' });
        };

        doc.addPage();
        drawPageHeader();
        let y = headerH + 5;

        const newPage = () => {
          doc.addPage();
          drawPageHeader();
          y = headerH + 5;
        };

        const categories = [...new Set(filtered.map(p => p.category))];

        for (const cat of categories) {
          const catProducts = filtered.filter(p => p.category === cat);

          if (y + 12 > H - footerH - 5) newPage();
          doc.setFillColor(pR, pG, pB);
          doc.roundedRect(margin, y, W - margin * 2, 9, 2, 2, 'F');
          doc.setTextColor(14, 14, 28);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text(
            `${getCategoryLabel(cat).toUpperCase()}  —  ${catProducts.length} producto${catProducts.length > 1 ? 's' : ''}`,
            margin + 5, y + 6
          );
          y += 14;

          for (let i = 0; i < catProducts.length; i++) {
            const col = i % COLS;
            if (col === 0 && i > 0) y += cardH + gap;
            if (y + cardH > H - footerH - 3) newPage();

            const p = catProducts[i];
            const x = margin + col * (cardW + gap);

            // Shadow
            doc.setFillColor(10, 10, 20);
            doc.roundedRect(x + 1.5, y + 1.5, cardW, cardH, 3, 3, 'F');

            // Card bg
            doc.setFillColor(22, 22, 38);
            doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F');
            doc.setDrawColor(45, 45, 70);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, y, cardW, cardH, 3, 3, 'S');

            // Image area
            doc.setFillColor(18, 18, 32);
            doc.roundedRect(x + 0.5, y + 0.5, cardW - 1, imgH - 1, 3, 3, 'F');

            if (p.image_url && imageCache[p.image_url]) {
              try {
                doc.addImage(imageCache[p.image_url]!, 'JPEG', x + 1, y + 1, cardW - 2, imgH - 2);
              } catch {
                doc.setTextColor(70, 70, 95);
                doc.setFontSize(8);
                doc.text('Sin imagen', x + cardW / 2, y + imgH / 2, { align: 'center' });
              }
            } else {
              doc.setTextColor(70, 70, 95);
              doc.setFontSize(8);
              doc.text('Sin imagen', x + cardW / 2, y + imgH / 2, { align: 'center' });
            }

            // Discount badge
            if (p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)) {
              const pct = Math.round((1 - Number(p.discount_price_ars) / Number(p.sale_price_ars)) * 100);
              doc.setFillColor(215, 38, 38);
              doc.roundedRect(x + 2, y + 2, 19, 7.5, 1.5, 1.5, 'F');
              doc.setTextColor(255, 255, 255);
              doc.setFontSize(8.5);
              doc.setFont('helvetica', 'bold');
              doc.text(`-${pct}%`, x + 11.5, y + 7.2, { align: 'center' });
            }

            // Category pill top-right
            const cLab = getCategoryLabel(p.category);
            const cpW = doc.getTextWidth(cLab) + 5;
            doc.setFillColor(14, 14, 26);
            doc.roundedRect(x + cardW - cpW - 2, y + 2, cpW, 5.5, 1, 1, 'F');
            doc.setTextColor(160, 160, 182);
            doc.setFontSize(5.5);
            doc.setFont('helvetica', 'normal');
            doc.text(cLab, x + cardW - 3.5, y + 6.2, { align: 'right' });

            // Text area
            const tY = y + imgH + 4;

            // Product name
            doc.setTextColor(235, 235, 248);
            doc.setFontSize(10.5);
            doc.setFont('helvetica', 'bold');
            const nameLines = doc.splitTextToSize(p.name, cardW - 8);
            doc.text(nameLines.slice(0, 2), x + 4, tY + 5);
            const nameH = Math.min(nameLines.length, 2) * 5;

            // Brand
            doc.setTextColor(135, 135, 160);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'normal');
            doc.text(p.brand || '', x + 4, tY + nameH + 6.5);

            // Description / flavor notes
            const desc: string = p.description || p.flavor_notes || p.notes || '';
            if (desc) {
              doc.setTextColor(110, 110, 138);
              doc.setFontSize(6.5);
              const descLines = doc.splitTextToSize(desc, cardW - 8);
              doc.text(descLines.slice(0, 2), x + 4, tY + nameH + 12);
            }

            // Separator
            doc.setDrawColor(45, 45, 70);
            doc.setLineWidth(0.2);
            doc.line(x + 4, tY + nameH + 15, x + cardW - 4, tY + nameH + 15);

            // Prices
            const priceY = tY + nameH + 20.5;
            if (p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)) {
              doc.setTextColor(pR, pG, pB);
              doc.setFontSize(13);
              doc.setFont('helvetica', 'bold');
              doc.text(fmtARS(Number(p.discount_price_ars)), x + 4, priceY);
              doc.setFontSize(5.5);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(Math.round(pR * 0.8), Math.round(pG * 0.8), Math.round(pB * 0.8));
              doc.text('Efectivo / Transferencia', x + 4, priceY + 4.5);
              doc.setTextColor(145, 145, 168);
              doc.setFontSize(9.5);
              doc.setFont('helvetica', 'normal');
              doc.text(fmtARS(Number(p.sale_price_ars)), x + 4, priceY + 10.5);
              doc.setFontSize(5.5);
              doc.text('Tarjeta 3 cuotas s/interés', x + 4, priceY + 14.5);
            } else {
              doc.setTextColor(pR, pG, pB);
              doc.setFontSize(13);
              doc.setFont('helvetica', 'bold');
              doc.text(fmtARS(Number(p.sale_price_ars)), x + 4, priceY);
            }

            if (!isPublic) {
              doc.setTextColor(85, 85, 112);
              doc.setFontSize(6);
              doc.setFont('helvetica', 'normal');
              doc.text(`Stock: ${p.stock}`, x + cardW - 4, priceY + 10, { align: 'right' });
            }
          }

          const lastRowItems = catProducts.length % COLS || COLS;
          if (lastRowItems > 0) y += cardH + gap;
          y += 5;
        }

        // Page numbers on product pages only (skip cover and back cover)
        const totalPages = doc.getNumberOfPages();
        for (let i = 2; i <= totalPages - 1; i++) {
          doc.setPage(i);
          drawPageFooter(i - 1, totalPages - 2);
        }
      }

      // ── BACK COVER ───────────────────────────────────────────────────────
      doc.addPage();
      doc.setFillColor(14, 14, 28);
      doc.rect(0, 0, W, H, 'F');

      // Concentric decorative rings
      const cx = W / 2, cy = H / 2;
      for (let r = 115; r >= 25; r -= 14) {
        const t = (115 - r) / 90;
        doc.setDrawColor(
          Math.round(14 + t * (pR - 14) * 0.25),
          Math.round(14 + t * (pG - 14) * 0.25),
          Math.round(28 + t * 18)
        );
        doc.setLineWidth(0.35);
        doc.circle(cx, cy, r, 'S');
      }

      doc.setFontSize(30);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(232, 232, 248);
      doc.text('Catálogo', cx, cy - 70, { align: 'center' });
      doc.setTextColor(pR, pG, pB);
      doc.text('Online', cx, cy - 53, { align: 'center' });

      if (qrDataUrl) {
        const qrS = 60;
        const qrX = cx - qrS / 2;
        const qrY = cy - 26;
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(qrX - 5, qrY - 5, qrS + 10, qrS + 10, 4, 4, 'F');
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrS, qrS);
      }

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(175, 175, 198);
      doc.text('Escaneá para ver el catálogo completo', cx, cy + 46, { align: 'center' });
      doc.setFontSize(8.5);
      doc.setTextColor(115, 115, 138);
      doc.text(publicUrl, cx, cy + 55, { align: 'center' });

      doc.setFillColor(20, 20, 36);
      doc.rect(0, H - 18, W, 18, 'F');
      doc.setFillColor(pR, pG, pB);
      doc.rect(0, H - 18, W, 0.5, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(pR, pG, pB);
      doc.text(bName.toUpperCase(), cx, H - 9, { align: 'center' });
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(115, 115, 138);
      doc.text(today, cx, H - 4, { align: 'center' });

      doc.save(`${bName.replace(/\s+/g, '_')}_Catalogo.pdf`);
      toast.success('Catálogo PDF descargado');
    } catch (err) {
      console.error('PDF error:', err);
      toast.error('Error al generar el PDF');
    } finally {
      setGenerating(false);
    }
  }, [filtered, settings, isPublic, filterCat, userId]);

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
    <div className="space-y-5">
      {/* Hidden QR for printing */}
      <div className="hidden">
        <QRCodeSVG
          id="catalog-qr-svg"
          value={`${window.location.origin}/catalogo/${userId}`}
          size={300}
          level="H"
        />
      </div>
      <PageHeader
        icon={Package}
        title={isPublic ? businessName : 'Catálogo'}
        description={`${filtered.length} productos disponibles`}
        actions={
          <div className="flex gap-2">
            {!isPublic && (
              <>
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
        }
      />

      {/* Stats bar */}
      {products.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Productos", value: products.length, color: "text-foreground" },
            { label: "Categorías", value: [...new Set(products.map(p => p.category))].length, color: "text-foreground" },
            { label: "Marcas", value: [...new Set(products.map(p => p.brand).filter(Boolean))].length, color: "text-foreground" },
            { label: "En oferta", value: products.filter(p => p.discount_price_ars && p.discount_price_ars < p.sale_price_ars).length, color: "text-primary" },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-xl px-4 py-3 text-center">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar producto o marca..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted border-border" />
        </div>
        {/* Dynamic category pills */}
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 'all', label: 'Todos', count: products.length },
            ...[...new Set(products.map(p => p.category))].map(c => ({
              value: c,
              label: getCategoryLabel(c),
              count: products.filter(p => p.category === c).length,
            })),
          ].map(cat => (
            <button
              key={cat.value}
              onClick={() => setFilterCat(cat.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                filterCat === cat.value
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-muted border-border hover:border-primary/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat.label} <span className="opacity-60">({cat.count})</span>
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Package} title="No hay productos disponibles" description="No se encontraron productos con stock." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(p => {
            const hasDiscount = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars);
            const discountPct = hasDiscount ? Math.round((1 - Number(p.discount_price_ars) / Number(p.sale_price_ars)) * 100) : 0;
            return (
            <div key={p.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-200 group">
              <div className="aspect-square bg-muted/60 flex items-center justify-center relative overflow-hidden">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                ) : (
                  <Package className="w-12 h-12 text-muted-foreground/20" />
                )}
                {/* Badges */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  {hasDiscount && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-destructive text-destructive-foreground font-bold flex items-center gap-1">
                      <Tag className="w-3 h-3" />-{discountPct}%
                    </span>
                  )}
                </div>
                <div className="absolute top-2 right-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-background/80 backdrop-blur-sm font-medium border border-border/40">
                    {getCategoryLabel(p.category)}
                  </span>
                </div>
                {/* Low stock warning */}
                {!isPublic && p.stock <= 3 && p.stock > 0 && (
                  <div className="absolute bottom-2 left-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/80 text-white font-bold backdrop-blur-sm">
                      ¡{p.stock} u.!
                    </span>
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between mb-0.5">
                  <h3 className="font-semibold text-sm leading-tight flex-1 line-clamp-2">{p.name}</h3>
                  <span className="text-xs text-muted-foreground ml-1 shrink-0">{GENDER_ICONS[p.gender]}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2.5">{p.brand}</p>
                <div className="space-y-1.5">
                  {hasDiscount ? (
                    <>
                      <div className="bg-primary/8 border border-primary/15 rounded-lg px-2.5 py-2">
                        <span className="text-base font-bold text-primary">{formatARS(Number(p.discount_price_ars))}</span>
                        <p className="text-[10px] text-primary/70 mt-0.5">Efectivo / Transferencia</p>
                      </div>
                      <div className="px-1">
                        <span className="text-xs text-muted-foreground line-through">{formatARS(Number(p.sale_price_ars))}</span>
                        <p className="text-[10px] text-muted-foreground/60">Tarjeta 3 cuotas s/interés</p>
                      </div>
                    </>
                  ) : (
                    <div className="bg-primary/8 border border-primary/15 rounded-lg px-2.5 py-2">
                      <span className="text-base font-bold text-primary">{formatARS(Number(p.sale_price_ars))}</span>
                    </div>
                  )}
                  {!isPublic && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/60">
                      <span className={`text-[10px] font-medium ${p.stock === 0 ? 'text-destructive' : p.stock <= 3 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        Stock: {p.stock}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{getGenderLabel(p.gender)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
