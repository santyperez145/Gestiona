import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getVariantsDB } from "@/lib/supabaseStore";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sparkles, Download, Image as ImageIcon, Loader2, Copy, Wind } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listStoryTemplates } from "@/lib/marketingExtraDB";

type Template = string;

const FALLBACK_TEMPLATES: { id: Template; name: string; badge: string; emoji: string }[] = [
  { id: "promo", name: "Promoción", badge: "OFERTA", emoji: "🔥" },
  { id: "flash", name: "Oferta Flash", badge: "SOLO HOY", emoji: "⚡" },
  { id: "nuevo", name: "Nuevo Ingreso", badge: "NUEVO", emoji: "✨" },
  { id: "recomendado", name: "Recomendado", badge: "TOP VENTAS", emoji: "⭐" },
  { id: "limpio", name: "Minimalista", badge: "", emoji: "" },
];

const W = 1080;
const H = 1920;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderStory(opts: {
  template: Template;
  templateData?: { name: string; badge: string; emoji: string };
  product: any;
  primaryColor: string;
  businessName: string;
  logoUrl?: string | null;
  customText?: string;
  customPrice?: string;
  ctaText?: string;
  flavors?: string[];
}): Promise<HTMLCanvasElement> {
  const { template, templateData, product, primaryColor, businessName, logoUrl, customText, customPrice, ctaText, flavors } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0a0a14");
  grad.addColorStop(0.5, "#1a1a2e");
  grad.addColorStop(1, "#0a0a14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative blurred circle
  ctx.save();
  ctx.globalAlpha = 0.25;
  const radial = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 800);
  radial.addColorStop(0, primaryColor);
  radial.addColorStop(1, "transparent");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Layout constants — when flavors are shown we need more vertical space below the image
  const hasFlavors = !!(flavors && flavors.length > 0);
  // Max image height: reserve ~380px for brand+name+price, plus ~260px for flavor pills when present
  const MAX_IMG_H = hasFlavors ? 520 : 1000;

  // Product image
  let imgH = 0;
  if (product.image_url) {
    try {
      const img = await loadImage(product.image_url);
      const targetW = 820;
      const ratio = img.height / img.width;
      const targetH = Math.min(targetW * ratio, MAX_IMG_H);
      const finalW = targetH === MAX_IMG_H ? MAX_IMG_H / ratio : targetW;
      const x = (W - finalW) / 2;
      const y = 380;
      // soft shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 60;
      ctx.shadowOffsetY = 20;
      drawRoundRect(ctx, x, y, finalW, targetH, 40);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.restore();
      ctx.save();
      drawRoundRect(ctx, x, y, finalW, targetH, 40);
      ctx.clip();
      ctx.drawImage(img, x, y, finalW, targetH);
      ctx.restore();
      imgH = y + targetH;
    } catch {
      imgH = hasFlavors ? 780 : 900;
    }
  } else {
    // Placeholder block — smaller when flavors need room
    const placeholderH = hasFlavors ? 520 : 820;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    drawRoundRect(ctx, 130, 380, 820, placeholderH, 40);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "bold 120px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("📦", W / 2, 380 + placeholderH / 2 + 44);
    imgH = 380 + placeholderH;
  }

  const tpl = templateData || FALLBACK_TEMPLATES.find((t) => t.id === template) || FALLBACK_TEMPLATES[0];

  // Top: logo or business name
  ctx.textAlign = "center";
  if (logoUrl) {
    try {
      const logoImg = await loadImage(logoUrl);
      const maxLogoH = 90;
      const maxLogoW = 400;
      const ratio = logoImg.width / logoImg.height;
      const logoH = Math.min(maxLogoH, logoImg.height);
      const logoW = Math.min(maxLogoW, logoH * ratio);
      const lx = (W - logoW) / 2;
      const ly = 60;
      // Subtle glow behind logo
      ctx.save();
      ctx.shadowColor = "rgba(212,168,67,0.4)";
      ctx.shadowBlur = 30;
      ctx.drawImage(logoImg, lx, ly, logoW, logoH);
      ctx.restore();
    } catch {
      // fallback to text
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "600 36px Inter, sans-serif";
      ctx.fillText(businessName.toUpperCase(), W / 2, 130);
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 36px Inter, sans-serif";
    ctx.fillText(businessName.toUpperCase(), W / 2, 130);
  }

  // Badge
  if (tpl.badge && template !== "limpio") {
    ctx.font = "900 56px Inter, sans-serif";
    const badgeText = `${tpl.emoji} ${tpl.badge}`;
    const tw = ctx.measureText(badgeText).width;
    const padX = 50;
    const bx = (W - tw - padX * 2) / 2;
    const by = 180;
    ctx.fillStyle = primaryColor;
    drawRoundRect(ctx, bx, by, tw + padX * 2, 100, 50);
    ctx.fill();
    ctx.fillStyle = "#0a0a14";
    ctx.fillText(badgeText, W / 2, by + 70);
  }

  // Brand
  if (product.brand) {
    ctx.fillStyle = primaryColor;
    ctx.font = "700 38px Inter, sans-serif";
    ctx.fillText(String(product.brand).toUpperCase(), W / 2, imgH + 90);
  }

  // Product name (wrapped) — slightly smaller when flavors need room
  const nameFontSize = hasFlavors ? 56 : 64;
  const nameLineH = hasFlavors ? 65 : 75;
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${nameFontSize}px Inter, sans-serif`;
  const name = customText || product.name || "Producto";
  const lines = wrapText(ctx, name, W - 160);
  let y = imgH + (hasFlavors ? 140 : 170);
  lines.slice(0, 2).forEach((l) => {
    ctx.fillText(l, W / 2, y);
    y += nameLineH;
  });

  // Price — slightly smaller when flavors need room
  const priceFontSize = hasFlavors ? 90 : 110;
  const priceBlockH = hasFlavors ? 110 : 130;
  const rawPrice = product.sale_price_ars ? Number(product.sale_price_ars) : 0;
  const priceVal = customPrice || (rawPrice ? `$${rawPrice.toLocaleString("es-AR")}` : "");
  if (priceVal) {
    y += hasFlavors ? 20 : 30;
    // "1 unidad" label above main price
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `500 26px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("1 UNIDAD", W / 2, y + 10);
    // Main price
    ctx.fillStyle = primaryColor;
    ctx.font = `900 ${priceFontSize}px Inter, sans-serif`;
    ctx.fillText(priceVal, W / 2, y + (hasFlavors ? 80 : 95));
    y += priceBlockH;
    // Price x2 — shown only when we have a real numeric price and space allows
    const ctaYCheck = H - 220;
    if (rawPrice > 0 && !customPrice && y + 70 < ctaYCheck - 20) {
      const price2 = rawPrice * 2;
      const price2Str = `$${price2.toLocaleString("es-AR")}`;
      const price2FontSize = Math.round(priceFontSize * 0.52);
      ctx.font = `700 ${price2FontSize}px Inter, sans-serif`;
      // Pill background
      const p2W = ctx.measureText(`2 × ${price2Str}`).width + 60;
      const p2H = price2FontSize + 28;
      const p2X = (W - p2W) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      drawRoundRect(ctx, p2X, y, p2W, p2H, p2H / 2);
      ctx.fill();
      ctx.strokeStyle = primaryColor + "55";
      ctx.lineWidth = 1.5;
      drawRoundRect(ctx, p2X, y, p2W, p2H, p2H / 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.textAlign = "center";
      ctx.fillText(`2 × ${price2Str}`, W / 2, y + p2H * 0.66);
      y += p2H + 10;
    }
  }

  // Flavor pills (only for vaper products) — adaptive layout that never exceeds CTA area
  const ctaY = H - 220;
  if (flavors && flavors.length > 0) {
    // Space from current y to CTA (leave 20px margin before CTA)
    const blockStart = y + 16;
    const blockEnd = ctaY - 20;
    const available = blockEnd - blockStart;

    // Thin gold separator between price and flavors
    if (available > 40) {
      const sepY = blockStart - 8;
      const sepW = 200;
      const sepX = (W - sepW) / 2;
      const sepGrad = ctx.createLinearGradient(sepX, 0, sepX + sepW, 0);
      sepGrad.addColorStop(0, "transparent");
      sepGrad.addColorStop(0.5, primaryColor + "80");
      sepGrad.addColorStop(1, "transparent");
      ctx.strokeStyle = sepGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sepX, sepY);
      ctx.lineTo(sepX + sepW, sepY);
      ctx.stroke();
    }

    if (available > 60) {
      // Adaptive sizing: fewer flavors → bigger pills, more flavors → smaller
      const count = flavors.length;
      const pillH = count > 14 ? 40 : count > 9 ? 48 : 56;
      const pillFontSize = count > 14 ? 22 : count > 9 ? 25 : 28;
      const pillPad = count > 14 ? 18 : count > 9 ? 22 : 26;
      const pillGap = count > 14 ? 8 : 11;
      const rowGap = count > 14 ? 10 : 13;
      const maxPerRow = count > 14 ? 5 : 4;
      const labelH = 46; // label text + gap below

      const pillFont = `700 ${pillFontSize}px Inter, sans-serif`;
      ctx.font = pillFont;
      const pillWidths = flavors.map((f) => ctx.measureText(f).width + pillPad * 2);

      // Build rows greedily, capping at what fits vertically
      const rowH = pillH + rowGap;
      const maxRows = Math.max(1, Math.floor((available - labelH) / rowH));

      const rows: { text: string; w: number }[][] = [[]];
      let rowW = 0;
      let clipped = false;

      for (let i = 0; i < flavors.length; i++) {
        const pill = { text: flavors[i], w: pillWidths[i] };
        const testW = rowW + (rows[rows.length - 1].length > 0 ? pillGap : 0) + pill.w;
        const needsNewRow = rows[rows.length - 1].length >= maxPerRow || testW > W - 80;
        if (needsNewRow) {
          if (rows.length >= maxRows) { clipped = true; break; }
          rows.push([pill]);
          rowW = pill.w;
        } else {
          rows[rows.length - 1].push(pill);
          rowW = testW;
        }
      }

      // Total height: label + rows
      const extraLine = clipped ? rowH : 0;
      const totalH = labelH + rows.length * rowH + extraLine;

      // Vertically center the block in available space
      const offsetY = Math.max(0, (available - totalH) / 2);
      let drawY = blockStart + offsetY;

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.font = `600 ${Math.round(pillFontSize * 0.85)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("SABORES DISPONIBLES", W / 2, drawY + pillFontSize);
      drawY += labelH;

      // Draw each row
      ctx.font = pillFont;
      for (const row of rows) {
        const totalRowW = row.reduce((s, p) => s + p.w, 0) + (row.length - 1) * pillGap;
        let px = (W - totalRowW) / 2;
        for (const { text, w } of row) {
          // Pill bg (semi-transparent dark)
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          drawRoundRect(ctx, px, drawY, w, pillH, pillH / 2);
          ctx.fill();
          // Gold border
          ctx.strokeStyle = primaryColor + "70";
          ctx.lineWidth = 2;
          drawRoundRect(ctx, px, drawY, w, pillH, pillH / 2);
          ctx.stroke();
          // Label
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.fillText(text, px + w / 2, drawY + pillH * 0.64);
          px += w + pillGap;
        }
        drawY += rowH;
      }

      // "y N más..." line if clipped
      if (clipped) {
        const shown = rows.flat().length;
        const extra = flavors.length - shown;
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = `400 ${Math.round(pillFontSize * 0.8)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(`+ ${extra} sabor${extra !== 1 ? "es" : ""} más`, W / 2, drawY + 6);
      }
    }
  }

  // CTA button — always fixed at bottom, never displaced by flavors
  const cta = ctaText || "ESCRIBINOS YA 📲";
  ctx.font = "800 44px Inter, sans-serif";
  const ctaW = ctx.measureText(cta).width + 120;
  const ctaH = 110;
  const ctaX = (W - ctaW) / 2;
  ctx.fillStyle = primaryColor;
  drawRoundRect(ctx, ctaX, ctaY, ctaW, ctaH, 55);
  ctx.fill();
  ctx.fillStyle = "#0a0a14";
  ctx.textBaseline = "middle";
  ctx.fillText(cta, W / 2, ctaY + ctaH / 2);
  ctx.textBaseline = "alphabetic";

  return canvas;
}

export function InstagramStoryGenerator() {
  const { user } = useAuth();
  const config = useBusinessConfig();
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [templates, setTemplates] = useState<{ id: Template; name: string; badge: string; emoji: string }[]>(FALLBACK_TEMPLATES);
  const [template, setTemplate] = useState<Template>("promo");
  const [customText, setCustomText] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [defaultCta, setDefaultCta] = useState("ESCRIBINOS YA 📲");
  const [aiCaption, setAiCaption] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [rendering, setRendering] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  // Vaper flavors
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !open) return;
    getProductsDB(user.id).then((p) => {
      const inStock = p.filter((x: any) => x.stock > 0);
      setProducts(inStock);
      if (inStock.length && !productId) setProductId(inStock[0].id);
    });
    // Load templates + default CTA from DB (no hardcode)
    listStoryTemplates().then((rows) => {
      if (rows && rows.length > 0) {
        const mapped = rows.map((r: any) => ({ id: r.code, name: r.name, badge: r.badge_text || '', emoji: r.emoji || '' }));
        setTemplates(mapped);
        const def = rows.find((r: any) => r.is_default) || rows[0];
        if (def) setTemplate(def.code);
      }
    });
    supabase.from('settings').select('default_cta_text').limit(1).maybeSingle().then(({ data }) => {
      if (data?.default_cta_text) setDefaultCta(data.default_cta_text);
    });
  }, [user, open]);

  // Load variants when product changes
  useEffect(() => {
    if (!productId) { setVariants([]); setSelectedFlavors([]); return; }
    const prod = products.find((p) => p.id === productId);
    if (prod?.category === 'vaper') {
      getVariantsDB(productId).then((v) => {
        const active = v.filter((x: any) => x.active !== false);
        setVariants(active);
        // Pre-select all flavors
        setSelectedFlavors(active.map((x: any) => x.variant_name));
      });
    } else {
      setVariants([]);
      setSelectedFlavors([]);
    }
  }, [productId, products]);

  const product = products.find((p) => p.id === productId);
  const tplData = templates.find((t) => t.id === template);
  const isVaper = product?.category === 'vaper';

  const generatePreview = async () => {
    if (!product) return;
    setRendering(true);
    try {
      const canvas = await renderStory({
        template,
        templateData: tplData,
        product,
        primaryColor: config.primaryColor,
        businessName: config.businessName,
        logoUrl: config.logoUrl,
        customText: customText || undefined,
        customPrice: customPrice || undefined,
        ctaText: ctaText || defaultCta,
        flavors: selectedFlavors.length > 0 ? selectedFlavors : undefined,
      });
      setPreviewUrl(canvas.toDataURL("image/png"));
    } catch (e: any) {
      toast.error("Error generando preview: " + e.message);
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (product && open) generatePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, template, customText, customPrice, ctaText, open, selectedFlavors]);

  const downloadStory = async () => {
    if (!product) return;
    const canvas = await renderStory({
      template,
      templateData: tplData,
      product,
      primaryColor: config.primaryColor,
      businessName: config.businessName,
      logoUrl: config.logoUrl,
      customText: customText || undefined,
      customPrice: customPrice || undefined,
      ctaText: ctaText || defaultCta,
      flavors: selectedFlavors.length > 0 ? selectedFlavors : undefined,
    });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historia-${product.name?.replace(/\s+/g, "-").toLowerCase() || "producto"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("¡Historia descargada! Subila a Instagram 📲");
    }, "image/png");
  };

  const generateAiCaption = async () => {
    if (!product) return;
    setLoadingAi(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analysis", {
        body: {
          type: "marketing_copy",
          data: {
            products: [{ name: product.name, brand: product.brand, category: product.category, price: product.sale_price_ars, flavors: selectedFlavors.length > 0 ? selectedFlavors : undefined }],
            postType: "story",
            theme: tplData?.name || "promoción",
          },
        },
      });
      if (error) throw error;
      setAiCaption(data.content || "");
      toast.success("Copy generado con IA");
    } catch (e: any) {
      toast.error(e.message || "Error generando copy");
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-primary/40">
          <ImageIcon className="w-4 h-4 mr-2" />
          Historia Instagram
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" />
            Generador de Historias para Instagram
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Controls */}
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Producto</label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Elegí un producto" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.brand ? `· ${p.brand}` : ""} {p.stock > 0 ? `(${p.stock})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Vaper flavors selector */}
            {isVaper && variants.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium flex items-center gap-1.5 text-primary">
                    <Wind className="w-3.5 h-3.5" />
                    Sabores a mostrar en la historia
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedFlavors(variants.map((v: any) => v.variant_name))}
                      className="text-[10px] px-2 py-0.5 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFlavors([])}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {variants.map((v: any) => {
                    const active = selectedFlavors.includes(v.variant_name);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setSelectedFlavors((prev) =>
                            active ? prev.filter((f) => f !== v.variant_name) : [...prev, v.variant_name]
                          )
                        }
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {v.variant_name}
                        {v.stock != null && (
                          <span className={`ml-1 opacity-60 text-[10px]`}>({v.stock})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedFlavors.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {selectedFlavors.length} sabor{selectedFlavors.length !== 1 ? "es" : ""} seleccionado{selectedFlavors.length !== 1 ? "s" : ""} — aparecerán en la historia
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Plantilla</label>
              <div className="grid grid-cols-3 gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplate(t.id)}
                    className={`text-xs p-2 rounded border transition-colors ${
                      template === t.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:border-primary/40"
                    }`}
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Texto principal (opcional)</label>
              <Input
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={product?.name || "Nombre del producto"}
                className="bg-muted border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground">Precio (opcional)</label>
                <Input
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder={product?.sale_price_ars ? `$${product.sale_price_ars}` : "$0"}
                  className="bg-muted border-border"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Botón CTA</label>
                <Input
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  placeholder={defaultCta}
                  className="bg-muted border-border"
                />
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">Copy con IA (para el sticker de texto)</label>
                <Button size="sm" variant="outline" onClick={generateAiCaption} disabled={loadingAi || !product}>
                  {loadingAi ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  <span className="ml-1">Generar</span>
                </Button>
              </div>
              <Textarea
                value={aiCaption}
                onChange={(e) => setAiCaption(e.target.value)}
                placeholder="Texto para acompañar la historia..."
                rows={4}
                className="bg-muted border-border text-xs"
              />
              {aiCaption && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  onClick={() => {
                    navigator.clipboard.writeText(aiCaption);
                    toast.success("Copiado");
                  }}
                >
                  <Copy className="w-3 h-3 mr-1" /> Copiar texto
                </Button>
              )}
            </div>

            <Button
              onClick={downloadStory}
              disabled={!product || rendering}
              className="w-full gradient-gold text-primary-foreground font-semibold shadow-gold"
            >
              <Download className="w-4 h-4 mr-2" />
              Descargar Historia (1080x1920)
            </Button>
          </div>

          {/* Preview */}
          <div ref={previewRef} className="flex justify-center items-start">
            <div
              className="relative bg-black rounded-2xl overflow-hidden border-2 border-border shadow-2xl"
              style={{ width: 270, height: 480 }}
            >
              {rendering && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Elegí un producto
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}