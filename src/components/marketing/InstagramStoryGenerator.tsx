import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB } from "@/lib/supabaseStore";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sparkles, Download, Image as ImageIcon, Loader2, Copy } from "lucide-react";
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
  customText?: string;
  customPrice?: string;
  ctaText?: string;
}): Promise<HTMLCanvasElement> {
  const { template, templateData, product, primaryColor, businessName, customText, customPrice, ctaText } = opts;
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

  // Product image
  let imgH = 0;
  if (product.image_url) {
    try {
      const img = await loadImage(product.image_url);
      const targetW = 820;
      const ratio = img.height / img.width;
      const targetH = Math.min(targetW * ratio, 1000);
      const finalW = targetH === 1000 ? 1000 / ratio : targetW;
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
      imgH = 900;
    }
  } else {
    // Placeholder block
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    drawRoundRect(ctx, 130, 380, 820, 820, 40);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "bold 120px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("📦", W / 2, 880);
    imgH = 1200;
  }

  const tpl = templateData || FALLBACK_TEMPLATES.find((t) => t.id === template) || FALLBACK_TEMPLATES[0];

  // Top: business name
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "600 36px Inter, sans-serif";
  ctx.fillText(businessName.toUpperCase(), W / 2, 130);

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

  // Product name (wrapped)
  ctx.fillStyle = "#fff";
  ctx.font = "800 64px Inter, sans-serif";
  const name = customText || product.name || "Producto";
  const lines = wrapText(ctx, name, W - 160);
  let y = imgH + 170;
  lines.slice(0, 2).forEach((l) => {
    ctx.fillText(l, W / 2, y);
    y += 75;
  });

  // Price
  const priceVal = customPrice || (product.sale_price_ars ? `$${Number(product.sale_price_ars).toLocaleString("es-AR")}` : "");
  if (priceVal) {
    y += 30;
    ctx.fillStyle = primaryColor;
    ctx.font = "900 110px Inter, sans-serif";
    ctx.fillText(priceVal, W / 2, y + 80);
    y += 130;
  }

  // CTA button
  const cta = ctaText || "ESCRIBINOS YA 📲";
  ctx.font = "800 44px Inter, sans-serif";
  const ctaW = ctx.measureText(cta).width + 120;
  const ctaH = 110;
  const ctaX = (W - ctaW) / 2;
  const ctaY = H - 220;
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
      if ((data as any)?.default_cta_text) setDefaultCta((data as any).default_cta_text);
    });
  }, [user, open]);

  const product = products.find((p) => p.id === productId);
  const tplData = templates.find((t) => t.id === template);

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
        customText: customText || undefined,
        customPrice: customPrice || undefined,
        ctaText: ctaText || defaultCta,
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
  }, [productId, template, customText, customPrice, ctaText, open]);

  const downloadStory = async () => {
    if (!product) return;
    const canvas = await renderStory({
      template,
      templateData: tplData,
      product,
      primaryColor: config.primaryColor,
      businessName: config.businessName,
      customText: customText || undefined,
      customPrice: customPrice || undefined,
      ctaText: ctaText || defaultCta,
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
            products: [{ name: product.name, brand: product.brand, category: product.category, price: product.sale_price_ars }],
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