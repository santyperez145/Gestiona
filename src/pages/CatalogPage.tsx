import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useCuotasDelComercio, textoDeCuotas } from "@/lib/cuotasDelComercio";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { getActiveOrgId } from "@/lib/orgContext";
import { formatARS, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { loadActivePromotions, loadPublicPromotions, bestPromoPrice, type Promotion } from "@/lib/promotions";
import { FAMILIAS_OLFATIVAS, NOTAS_COMUNES, OCASIONES, GENEROS, taxLabel, type TaxItem } from "@/lib/scentTaxonomy";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Package, Tag, Download, Share2, QrCode, Layers, Percent, MessageCircle, SlidersHorizontal } from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import { QRCodeSVG } from "qrcode.react";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

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
  usePageTitle("Catálogo Online");
  const auth = useAuth();
  const userId = isPublic ? publicUserId : auth?.user?.id;
  const [products, setProducts] = useState<any[]>([]);
  /**
   * ⚠️ El catálogo prometía «Tarjeta 3 cuotas sin interés» escrito a mano, en
   * la pantalla y en el PDF que se manda por WhatsApp. Sin mirar nada. Un
   * comercio que no ofrece cuotas las prometía igual, y uno que ofrece más
   * quedaba subestimado.
   */
  const cuotasOfrecidas = useCuotasDelComercio(getActiveOrgId());
  const [settings, setSettings] = useState<any>(null);
  const [catalogPromos, setCatalogPromos] = useState<Promotion[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [perfumeDetails, setPerfumeDetails] = useState<Record<string, any>>({});
  const [facetFamilia, setFacetFamilia] = useState<string[]>([]);
  const [facetNotas, setFacetNotas] = useState<string[]>([]);
  const [facetOcasion, setFacetOcasion] = useState<string[]>([]);
  const [facetGenero, setFacetGenero] = useState<string[]>([]);
  const [showFacets, setShowFacets] = useState(false);
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
    // El catálogo público lee las promos por RPC security-definer: la RLS de
    // `promotions` exige auth, pero el precio que ve el cliente tiene que ser
    // el mismo que se le cobra después en el POS.
    (isPublic ? loadPublicPromotions(orgId) : loadActivePromotions(orgId))
      .then(setCatalogPromos)
      .catch(() => {});
    supabase.from("product_perfume_details").select("*").eq("org_id", orgId).then(({ data }) => {
      const m: Record<string, any> = {};
      (data ?? []).forEach((d: any) => { m[d.product_id] = d; });
      setPerfumeDetails(m);
    }, () => {});
  }, [userId, isPublic]);

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
    // ── Facetas de perfume. El PDF se arma desde `filtered`, así que
    //    exportar respeta exactamente lo que se ve en pantalla.
    if (facetGenero.length && !facetGenero.includes(p.gender)) return false;
    if (facetFamilia.length || facetNotas.length || facetOcasion.length) {
      const d = perfumeDetails[p.id];
      if (!d) return false;
      if (facetFamilia.length && !facetFamilia.includes(d.familia_olfativa)) return false;
      if (facetOcasion.length && !facetOcasion.some((o: string) => (d.ocasion ?? []).includes(o))) return false;
      if (facetNotas.length) {
        const todas = [...(d.notas_salida ?? []), ...(d.notas_corazon ?? []), ...(d.notas_fondo ?? [])];
        if (!facetNotas.some((n: string) => todas.includes(n))) return false;
      }
    }
    return true;
  });
  const facetCount = facetFamilia.length + facetNotas.length + facetOcasion.length + facetGenero.length;

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
      const bName = settings?.business_name || '';

      // ── Brand colors (primary = accent/prices, bg = cover/page bg, card = product cards)
      const hexPrimary = settings?.primary_color || '#D4A843';
      const hexBg      = settings?.catalog_bg_color   || '#0E0E1C';
      const hexCard    = settings?.catalog_card_color  || '#16163A';
      const hexAccent  = settings?.catalog_accent_color || hexPrimary;

      const parseHex = (h: string): [number, number, number] => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      const [pR, pG, pB] = parseHex(hexPrimary);
      const [bgR, bgG, bgB] = parseHex(hexBg);
      const [cdR, cdG, cdB] = parseHex(hexCard);
      const [acR, acG, acB] = parseHex(hexAccent);
      // Legacy alias so existing PDF code keeps working
      const hex = hexPrimary;
      const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
      const publicUrl = `${window.location.origin}/catalogo/${userId}`;
      // Título de portada: refleja la categoría y las facetas activas, así el
      // PDF exportado dice exactamente qué selección contiene.
      const facetLabels = [
        ...facetGenero.map(v => taxLabel(GENEROS, v)),
        ...facetFamilia.map(v => taxLabel(FAMILIAS_OLFATIVAS, v)),
        ...facetOcasion.map(v => taxLabel(OCASIONES, v)),
        ...facetNotas.map(v => taxLabel(NOTAS_COMUNES, v)),
      ];
      const baseCatLabel = filterCat !== 'all' ? getCategoryLabel(filterCat) : 'Todos los productos';
      const catLabel = facetLabels.length
        ? `${filterCat !== 'all' ? baseCatLabel + ' · ' : ''}${facetLabels.slice(0, 4).join(' · ')}${facetLabels.length > 4 ? ` +${facetLabels.length - 4}` : ''}`
        : baseCatLabel;

      // Preload logo for cover page
      const coverLogoUrl = settings?.logo_url || `${window.location.origin}/exentry-logo.png`;
      const coverLogoBase64 = await loadImageAsBase64(coverLogoUrl).catch(() => null);

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
      doc.setFillColor(bgR, bgG, bgB);
      doc.rect(0, 0, W, H, 'F');

      // Top accent bar
      doc.setFillColor(pR, pG, pB);
      doc.rect(0, 0, W, 3, 'F');

      // Decorative circle top-right
      doc.setFillColor(Math.round(bgR * 1.4 + pR * 0.1), Math.round(bgG * 1.4 + pG * 0.1), Math.round(bgB * 1.4 + pB * 0.1));
      doc.circle(W + 28, -28, 88, 'F');
      doc.setFillColor(bgR, bgG, bgB);
      doc.circle(W + 28, -28, 70, 'F');

      // Cover logo or text business name
      if (coverLogoBase64) {
        // Render logo centered — white rounded rect background so it reads on dark cover
        const logoMaxW = 110;
        const logoMaxH = 40;
        // Approximate aspect ratio 3:1 (landscape logo)
        const logoW = logoMaxW;
        const logoH = logoMaxH;
        const logoX = W / 2 - logoW / 2;
        const logoY = 88;
        // White pill background
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(logoX - 6, logoY - 5, logoW + 12, logoH + 10, 6, 6, 'F');
        doc.addImage(coverLogoBase64, 'PNG', logoX, logoY, logoW, logoH);
      } else {
        // Fallback: stylized text business name
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
      }

      // Subtitle (Y adjusts depending on whether logo or text name was used)
      const subtitleY = coverLogoBase64 ? 143 : 121;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(155, 155, 178);
      doc.text('CATÁLOGO DE PRODUCTOS', W / 2, subtitleY, { align: 'center' });

      // Separator
      doc.setFillColor(pR, pG, pB);
      doc.rect(W / 2 - 20, subtitleY + 5, 40, 0.7, 'F');

      // Category pill
      doc.setFillColor(pR, pG, pB);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const pillTxt = catLabel.toUpperCase();
      const pillW = doc.getTextWidth(pillTxt) + 14;
      doc.roundedRect(W / 2 - pillW / 2, subtitleY + 10, pillW, 9, 2.5, 2.5, 'F');
      doc.setTextColor(14, 14, 28);
      doc.text(pillTxt, W / 2, subtitleY + 16.2, { align: 'center' });

      // Count + date
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(175, 175, 198);
      doc.text(`${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`, W / 2, subtitleY + 27, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(115, 115, 138);
      doc.text(today, W / 2, subtitleY + 35, { align: 'center' });

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
      doc.setFillColor(Math.min(bgR + 10, 40), Math.min(bgG + 10, 40), Math.min(bgB + 20, 55));
      doc.rect(0, H - 14, W, 14, 'F');
      doc.setFillColor(pR, pG, pB);
      doc.rect(0, H - 14, W, 0.5, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(155, 155, 178);
      doc.text(publicUrl, W / 2, H - 5.5, { align: 'center' });

      // ── PRODUCT PAGES ────────────────────────────────────────────────────
      if (isVaperMode) {
        // ── Load variants ─────────────────────────────────────────────────────
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

        // ── Preload variant-level images ──────────────────────────────────────
        const variantImgCache: Record<string, string | null> = {};
        const variantImgUrls = [...new Set(variantRows.map(v => v.image_url).filter(Boolean) as string[])];
        await Promise.all(variantImgUrls.map(async (url) => {
          variantImgCache[url] = await loadImageAsBase64(url);
        }));

        // ── Constants ─────────────────────────────────────────────────────────
        // Background: use catalog_bg_color from settings (outer bgR/bgG/bgB from parseHex above)
        // vaper mode aliases (no shadowing — same vars from outer scope)

        // Grid: 4 columns, ~44mm wide cells
        const gM    = 9;
        const GCOLS = 4;
        const gGap  = 5;
        const cellW   = (W - gM * 2 - gGap * (GCOLS - 1)) / GCOLS;   // ≈ 44.25 mm
        const cellImgH = 44;   // nearly square
        const cellTextH = 15;  // 2 lines of flavor name
        const cellH    = cellImgH + cellTextH;
        const rowGap   = 6;

        // Header heights
        const HDR1 = 76;    // first page
        const HDRC = 26;    // continuation
        const FTR  = 36;    // footer
        const PAD  = 3;     // grid top/bottom padding

        const maxRowsP1   = Math.floor((H - HDR1 - PAD * 2 - FTR) / (cellH + rowGap)); // ≥ 3
        const maxRowsCont = Math.floor((H - HDRC - PAD * 2 - FTR) / (cellH + rowGap));

        // Contact info
        const waNumber = (settings?.whatsapp_number || '').replace(/\D/g, '');
        const spacedWA = waNumber.split('').join(' ');   // "3 8 0 4 2 4 9 7 7 2"
        const handle   = `@${bName.replace(/\s+/g, '').toUpperCase()}`;

        // ── fillBg ────────────────────────────────────────────────────────────
        const fillBgV = () => {
          doc.setFillColor(bgR, bgG, bgB);
          doc.rect(0, 0, W, H, 'F');
        };

        // ── drawFirstHeader ───────────────────────────────────────────────────
        const drawFirstHeader = (
          brand: string, model: string,
          puffs: string | null,
          eff: number, twoX: number
        ) => {
          // ── Brand box ──────────────────────────────────────────
          doc.setFontSize(28);
          doc.setFont('helvetica', 'bold');
          const bw = doc.getTextWidth(brand) + 28;
          const bx = W / 2 - bw / 2;
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(bx, 9, bw, 22, 3, 3, 'F');
          doc.setTextColor(10, 10, 10);
          doc.text(brand, W / 2, 24.5, { align: 'center' });

          // ── Model name ─────────────────────────────────────────
          let y = 38;
          if (model) {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(pR, pG, pB);
            doc.text(model, W / 2, y, { align: 'center' });
            y += 9;
          }

          // ── Puffs ──────────────────────────────────────────────
          if (puffs) {
            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(190, 192, 225);
            doc.text(puffs, W / 2, y, { align: 'center' });
            y += 9;
          }

          // ── 1X price ───────────────────────────────────────────
          y += 2;
          doc.setFontSize(21);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(pR, pG, pB);
          doc.text(`1X  ${fmtARS(eff)}`, W / 2, y, { align: 'center' });
          y += 13;

          // ── 2X price ───────────────────────────────────────────
          doc.setFontSize(21);
          doc.setTextColor(235, 236, 255);
          doc.text(`2X  ${fmtARS(twoX)}`, W / 2, y, { align: 'center' });
        };

        // ── drawContHeader ────────────────────────────────────────────────────
        const drawContHeader = (brand: string, model: string) => {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(235, 236, 255);
          doc.text(`${brand}  ${model}`, W / 2, 15, { align: 'center' });
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(pR, pG, pB);
          doc.text('continuación', W / 2, 22, { align: 'center' });
        };

        // ── drawFooter ────────────────────────────────────────────────────────
        const drawVaperFooter = () => {
          if (spacedWA) {
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(pR, pG, pB);
            doc.text(spacedWA, W / 2, H - 22, { align: 'center' });
          }
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(225, 226, 255);
          doc.text(handle, W / 2, H - 10, { align: 'center' });
        };

        // ── SOLD OUT rubber stamp ─────────────────────────────────────────────
        // Rectangular stamp style (like a real red rubber stamp), rotated -15°
        const drawSoldOut = (x: number, y: number, cw: number, ch: number) => {
          const mx = x + cw / 2;
          const my = y + ch / 2;

          const sw = cw - 5;   // stamp width  (leave 2.5mm each side)
          const sh = 13;        // stamp height mm
          const bw = 2.2;       // border thickness mm
          const θ = -15 * Math.PI / 180;
          const cosA = Math.cos(θ), sinA = Math.sin(θ);

          const rot = (px: number, py: number): [number, number] => [
            mx + px * cosA - py * sinA,
            my + px * sinA + py * cosA,
          ];

          // Outer red rectangle corners
          const [oTLx, oTLy] = rot(-sw / 2, -sh / 2);
          const [oTRx, oTRy] = rot( sw / 2, -sh / 2);
          const [oBRx, oBRy] = rot( sw / 2,  sh / 2);
          const [oBLx, oBLy] = rot(-sw / 2,  sh / 2);

          // Inner cutout corners (inset by bw to create thick border)
          const [iTLx, iTLy] = rot(-sw / 2 + bw, -sh / 2 + bw);
          const [iTRx, iTRy] = rot( sw / 2 - bw, -sh / 2 + bw);
          const [iBRx, iBRy] = rot( sw / 2 - bw,  sh / 2 - bw);
          const [iBLx, iBLy] = rot(-sw / 2 + bw,  sh / 2 - bw);

          // Draw outer filled red rect (two triangles)
          doc.setFillColor(205, 18, 18);
          doc.triangle(oTLx, oTLy, oTRx, oTRy, oBRx, oBRy, 'F');
          doc.triangle(oTLx, oTLy, oBRx, oBRy, oBLx, oBLy, 'F');

          // Draw inner dark rect to punch out the border → creates frame effect
          doc.setFillColor(bgR, bgG, bgB);
          doc.triangle(iTLx, iTLy, iTRx, iTRy, iBRx, iBRy, 'F');
          doc.triangle(iTLx, iTLy, iBRx, iBRy, iBLx, iBLy, 'F');

          // Red "SOLD OUT" text centred inside the stamp
          doc.setTextColor(205, 18, 18);
          doc.setFontSize(10.5);
          doc.setFont('helvetica', 'bold');
          doc.text('SOLD OUT', mx, my + 1, { align: 'center', angle: -15 });
        };

        // ── drawGridRows ──────────────────────────────────────────────────────
        const drawGridRows = (
          variants: any[], startIdx: number,
          maxRows: number, gridStartY: number,
          imgData: string | null
        ): number => {
          let idx = startIdx;
          for (let row = 0; row < maxRows && idx < variants.length; row++) {
            for (let col = 0; col < GCOLS && idx < variants.length; col++) {
              const v = variants[idx++];
              const inStock = (v.stock ?? 0) > 0;
              const cx = gM + col * (cellW + gGap);
              const cy = gridStartY + row * (cellH + rowGap);

              // Image background
              doc.setFillColor(18, 20, 52);
              doc.roundedRect(cx, cy, cellW, cellImgH, 2, 2, 'F');

              // Per-variant image if available, else fall back to product image
              const varImgData = v.image_url ? (variantImgCache[v.image_url] ?? null) : null;
              const cellImgData = varImgData || imgData;
              if (cellImgData) {
                try { doc.addImage(cellImgData, 'JPEG', cx, cy, cellW, cellImgH); } catch { /* */ }
              }

              // SOLD OUT stamp
              if (!inStock) drawSoldOut(cx, cy, cellW, cellImgH);

              // Flavor name — white bold, 2 lines max
              const labelY = cy + cellImgH + 4;
              doc.setFontSize(6.8);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(
                inStock ? 238 : 110,
                inStock ? 238 : 110,
                inStock ? 255 : 130
              );
              const fLines = doc.splitTextToSize(
                (v.variant_name as string).toUpperCase(), cellW - 1
              );
              doc.text(fLines.slice(0, 2), cx + cellW / 2, labelY + 4.5, { align: 'center' });

              // Stock (internal only)
              if (!isPublic) {
                doc.setFontSize(4.8);
                doc.setTextColor(55, 57, 95);
                doc.text(`${v.stock}u`, cx + cellW - 0.5, labelY + 4.5, { align: 'right' });
              }
            }
          }
          return idx;
        };

        // ── Render ────────────────────────────────────────────────────────────
        for (const p of filtered) {
          const variants  = variantsByProduct[p.id] || [];
          const effPrice  = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)
            ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
          const twoXPrice = p.price_2x_ars ? Number(p.price_2x_ars) : effPrice * 2;

          const puffsMatch = p.name.match(/(\d+\.?\d*)\s*[Kk]\b/);
          const puffsNum   = puffsMatch ? parseFloat(puffsMatch[1]) * 1000 : null;
          const puffsLabel = puffsNum
            ? `${new Intl.NumberFormat('es-AR').format(puffsNum)} PUFFS`
            : null;
          const brandWord = (p.brand || p.name.split(/\s+/)[0]).toUpperCase();
          const modelWord = p.name
            .replace(new RegExp(`^${(p.brand || '').trim()}\\s*`, 'i'), '')
            .toUpperCase();
          const imgData = p.image_url ? (imageCache[p.image_url] ?? null) : null;

          let vidx = 0;
          let firstPage = true;

          do {
            doc.addPage();
            fillBgV();

            if (firstPage) {
              drawFirstHeader(brandWord, modelWord, puffsLabel, effPrice, twoXPrice);
            } else {
              drawContHeader(brandWord, modelWord);
            }

            const gridY  = (firstPage ? HDR1 : HDRC) + PAD;
            const maxR   = firstPage ? maxRowsP1 : maxRowsCont;

            if (variants.length === 0) {
              // No flavors — show large centered product image
              const iw = 88, ih = 108;
              const ix = W / 2 - iw / 2, iy = gridY + 6;
              doc.setFillColor(18, 20, 52);
              doc.roundedRect(ix, iy, iw, ih, 3, 3, 'F');
              if (imgData) {
                try { doc.addImage(imgData, 'JPEG', ix, iy, iw, ih); } catch { /* */ }
              }
              if (!isPublic) {
                doc.setFontSize(7);
                doc.setTextColor(70, 72, 110);
                doc.text(`Stock: ${p.stock} u.`, W / 2, iy + ih + 9, { align: 'center' });
              }
            } else {
              vidx = drawGridRows(variants, vidx, maxR, gridY, imgData);
            }

            drawVaperFooter();
            firstPage = false;
          } while (vidx < variants.length);
        }

        // Page numbers (tiny, bottom center, skip cover & back cover)
        const tvp = doc.getNumberOfPages();
        for (let i = 2; i <= tvp - 1; i++) {
          doc.setPage(i);
          doc.setFontSize(5.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(45, 47, 80);
          doc.text(`${i - 1} / ${tvp - 2}`, W / 2, H - 1, { align: 'center' });
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
          doc.setFillColor(Math.min(bgR + 8, 40), Math.min(bgG + 8, 40), Math.min(bgB + 15, 60));
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
          doc.setFillColor(Math.min(bgR + 8, 40), Math.min(bgG + 8, 40), Math.min(bgB + 15, 60));
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
            doc.setFillColor(Math.max(bgR - 6, 0), Math.max(bgG - 6, 0), Math.max(bgB - 6, 0));
            doc.roundedRect(x + 1.5, y + 1.5, cardW, cardH, 3, 3, 'F');

            // Card bg
            doc.setFillColor(cdR, cdG, cdB);
            doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F');
            doc.setDrawColor(
              Math.min(cdR + 25, 255),
              Math.min(cdG + 25, 255),
              Math.min(cdB + 30, 255)
            );
            doc.setLineWidth(0.3);
            doc.roundedRect(x, y, cardW, cardH, 3, 3, 'S');

            // Image area
            doc.setFillColor(
              Math.max(cdR - 6, 0),
              Math.max(cdG - 6, 0),
              Math.max(cdB - 6, 0)
            );
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
            doc.setDrawColor(
              Math.min(cdR + 30, 255), Math.min(cdG + 30, 255), Math.min(cdB + 35, 255)
            );
            doc.setLineWidth(0.2);
            doc.line(x + 4, tY + nameH + 15, x + cardW - 4, tY + nameH + 15);

            // Prices
            const priceY = tY + nameH + 20.5;
            if (p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)) {
              doc.setTextColor(acR, acG, acB);
              doc.setFontSize(13);
              doc.setFont('helvetica', 'bold');
              doc.text(fmtARS(Number(p.discount_price_ars)), x + 4, priceY);
              doc.setFontSize(5.5);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(Math.round(acR * 0.8), Math.round(acG * 0.8), Math.round(acB * 0.8));
              doc.text('Efectivo / Transferencia', x + 4, priceY + 4.5);
              doc.setTextColor(145, 145, 168);
              doc.setFontSize(9.5);
              doc.setFont('helvetica', 'normal');
              doc.text(fmtARS(Number(p.sale_price_ars)), x + 4, priceY + 10.5);
              doc.setFontSize(5.5);
              {
                const texto = textoDeCuotas(cuotasOfrecidas, Number(p.sale_price_ars), fmtARS);
                if (texto) doc.text(`Tarjeta ${texto}`, x + 4, priceY + 14.5);
              }
            } else {
              doc.setTextColor(acR, acG, acB);
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
      doc.setFillColor(bgR, bgG, bgB);
      doc.rect(0, 0, W, H, 'F');

      // Concentric decorative rings
      const cx = W / 2, cy = H / 2;
      for (let r = 115; r >= 25; r -= 14) {
        const t = (115 - r) / 90;
        doc.setDrawColor(
          Math.round(bgR + t * (pR - bgR) * 0.3),
          Math.round(bgG + t * (pG - bgG) * 0.3),
          Math.round(bgB + t * (pB - bgB) * 0.3 + t * 12)
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

      doc.setFillColor(Math.min(bgR + 10, 40), Math.min(bgG + 10, 40), Math.min(bgB + 20, 55));
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
  }, [filtered, settings, isPublic, filterCat, userId, facetGenero, facetFamilia, facetOcasion, facetNotas]);

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
          title: `${settings?.business_name || ''} — Catálogo`,
          text: `Mirá nuestro catálogo con ${filtered.length} productos disponibles`,
          url,
        });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link del catálogo copiado al portapapeles');
    }
  }, [filtered, settings, userId]);

  const sendCatalogWhatsApp = useCallback(() => {
    const url = `${window.location.origin}/catalogo/${userId}`;
    const name = settings?.business_name || '';
    const msg = `Hola! 👋 Mirá el catálogo${name ? ` de ${name}` : ''} con ${filtered.length} productos disponibles:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }, [filtered, settings, userId]);

  const sendPriceListWhatsApp = useCallback(() => {
    const url = `${window.location.origin}/catalogo/${userId}`;
    const name = settings?.business_name || '';
    const inStock = filtered.filter(p => p.stock > 0);
    const CAP = 40; // límite práctico para no exceder el largo de wa.me
    const lines = inStock.slice(0, CAP).map(p => {
      const eff = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars)
        ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
      return `• ${p.name} — ${formatARS(eff)}`;
    });
    let msg = `📋 *Lista de precios${name ? ` — ${name}` : ''}*\n\n${lines.join('\n')}`;
    if (inStock.length > CAP) msg += `\n\n…y ${inStock.length - CAP} productos más en el catálogo:\n${url}`;
    else msg += `\n\nCatálogo completo: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }, [filtered, settings, userId]);

  if (loading) return <TableSkeleton rows={6} cols={4} />;

  const businessName = settings?.business_name || '';

  return (
    <div className="space-y-5 pb-12">
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
          <div className="flex flex-wrap gap-2">
            {!isPublic && (
              <>
                <Button variant="outline" size="sm" onClick={printQR} title="Imprimir QR del catálogo">
                  <QrCode className="w-4 h-4 mr-1" /> QR
                </Button>
                <Button variant="outline" size="sm" onClick={sendCatalogWhatsApp} title="Enviar catálogo por WhatsApp" className="text-emerald-500 hover:text-emerald-400">
                  <MessageCircle className="w-4 h-4 mr-1" /> Catálogo WA
                </Button>
                <Button variant="outline" size="sm" onClick={sendPriceListWhatsApp} title="Enviar lista de precios por WhatsApp" className="text-emerald-500 hover:text-emerald-400">
                  <MessageCircle className="w-4 h-4 mr-1" /> Precios WA
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Productos" value={products.length} icon={Package} color="primary" sub={`${filtered.length} mostrando`} />
          <KPICard label="Categorías" value={[...new Set(products.map(p => p.category))].length} icon={Layers} color="blue" sub="tipos distintos" />
          <KPICard label="Marcas" value={[...new Set(products.map(p => p.brand).filter(Boolean))].length} icon={Tag} color="purple" sub="en catálogo" />
          <KPICard label="En oferta" value={products.filter(p => p.discount_price_ars && p.discount_price_ars < p.sale_price_ars).length} icon={Percent} color={products.filter(p => p.discount_price_ars && p.discount_price_ars < p.sale_price_ars).length > 0 ? "success" : "primary"} sub="con descuento activo" />
        </div>
      )}

      <div className="flex flex-col gap-3">
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

        {/* Facetas de perfume — el PDF se exporta desde `filtered`, así que
            lo que se filtra acá es exactamente lo que sale en el PDF. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showFacets ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFacets(v => !v)}
            className="gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtros de perfume
            {facetCount > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 text-primary px-1.5 text-[10px] font-bold">{facetCount}</span>
            )}
          </Button>
          {facetCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setFacetFamilia([]); setFacetNotas([]); setFacetOcasion([]); setFacetGenero([]); }}
              className="text-xs text-muted-foreground"
            >
              Limpiar filtros
            </Button>
          )}
          {facetCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'producto' : 'productos'} — el PDF exporta solo estos
            </span>
          )}
        </div>

        {showFacets && (
          <div className="rounded-xl border border-border bg-card/50 p-3 sm:p-4 space-y-4">
            {([
              { title: 'Género', items: GENEROS, sel: facetGenero, set: setFacetGenero },
              { title: 'Familia olfativa', items: FAMILIAS_OLFATIVAS, sel: facetFamilia, set: setFacetFamilia },
              { title: 'Ocasión', items: OCASIONES, sel: facetOcasion, set: setFacetOcasion },
              { title: 'Notas', items: NOTAS_COMUNES, sel: facetNotas, set: setFacetNotas },
            ] as { title: string; items: TaxItem[]; sel: string[]; set: (v: string[]) => void }[]).map(group => (
              <div key={group.title}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{group.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map(it => {
                    const active = group.sel.includes(it.value);
                    return (
                      <button
                        key={it.value}
                        type="button"
                        onClick={() => group.set(active ? group.sel.filter(v => v !== it.value) : [...group.sel, it.value])}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                      >
                        {it.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Los filtros por familia, ocasión y notas solo alcanzan productos con ficha de perfume cargada.
            </p>
          </div>
        )}
      </div>

      {!filtered.length ? (
        <EmptyState icon={Package} title="No hay productos disponibles" description="No se encontraron productos con stock." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(p => {
            const promo = bestPromoPrice(p, catalogPromos);
            const manualDisc = p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars) ? Number(p.discount_price_ars) : null;
            const effDiscPrice = promo ? promo.price : manualDisc;   // promo ya es ≤ descuento manual
            const hasDiscount = effDiscPrice != null && effDiscPrice < Number(p.sale_price_ars);
            const discountPct = hasDiscount ? Math.round((1 - (effDiscPrice as number) / Number(p.sale_price_ars)) * 100) : 0;
            return (
            <div key={p.id} className="bg-card border border-border/60 rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-200 group">
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
                        <span className="text-base font-bold text-primary">{formatARS(Number(effDiscPrice))}</span>
                        <p className="text-[10px] text-primary/70 mt-0.5">{promo ? promo.promo.name : 'Efectivo / Transferencia'}</p>
                      </div>
                      <div className="px-1">
                        <span className="text-xs text-muted-foreground line-through">{formatARS(Number(p.sale_price_ars))}</span>
                        {textoDeCuotas(cuotasOfrecidas, Number(p.sale_price_ars), formatARS) && (
                          <p className="text-[10px] text-muted-foreground/60">
                            Tarjeta {textoDeCuotas(cuotasOfrecidas, Number(p.sale_price_ars), formatARS)}
                          </p>
                        )}
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
