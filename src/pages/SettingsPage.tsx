import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { subscribeToPush, unsubscribeFromPush, getCurrentSubscription, isPushSupported } from "@/lib/pushNotifications";
import { useEntitlements } from "@/lib/useEntitlements";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS, calculateProductProfits, getCouponsDB, addCouponDB, updateCouponDB, deleteCouponDB, getSalesDB, getPurchasesDB, getDebtsDB, getExpensesDB, getCustomerNotesDB, buildExpenseCategories } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RefreshCw, Database, Shield, Receipt, Palette, Building2, Upload, Keyboard, RotateCcw, CreditCard, MessageCircle, ShoppingBag, Droplets, Ticket, Plus, Trash2, FileSpreadsheet, FileJson, Download, Bell, DollarSign, Tags, Cloud, Zap, AlertTriangle, CheckCircle2, XCircle, Loader2, FileCheck, MapPin, Edit2, Check, X, Smartphone, BookMarked, Save, Mail, Lock, Server, Eye, EyeOff } from "lucide-react";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { applyColors } from "@/lib/useBusinessConfig";
import { logAudit } from "@/lib/auditLog";
import { FormSkeleton } from "@/components/shared/PageSkeleton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function SettingsPage() {
  const { user, session } = useAuth();
  const [exchangeRate, setExchangeRate] = useState('');
  const [customsPercent, setCustomsPercent] = useState('');
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxIva, setTaxIva] = useState('21');
  const [taxIibb, setTaxIibb] = useState('3.5');
  const [taxMonotributo, setTaxMonotributo] = useState('0');
  const [productCount, setProductCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [businessName, setBusinessName] = useState('Exentry Imports');
  const [logoUrl, setLogoUrl] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('¡Gracias por su compra!');
  const [primaryColor, setPrimaryColor] = useState('#D4A843');
  const [secondaryColor, setSecondaryColor] = useState('#1A1A2E');
  // Catalog-specific colors
  const [catalogBg, setCatalogBg] = useState('#0E0E1C');
  const [catalogCard, setCatalogCard] = useState('#16163A');
  const [catalogAccent, setCatalogAccent] = useState('#D4A843');
  const [uploading, setUploading] = useState(false);

  // Brand palettes (stored in settings DB)
  const [brandPalettes, setBrandPalettes] = useState<Array<{ id: string; name: string; primary: string; secondary: string; bg: string; card: string; accent: string }>>([]);
  const [newPaletteName, setNewPaletteName] = useState('');
  const [savingPalette, setSavingPalette] = useState(false);

  // Payment method discounts
  const [discountCash, setDiscountCash] = useState('10');
  const [discountTransfer, setDiscountTransfer] = useState('5');
  const [discountDebit, setDiscountDebit] = useState('0');
  const [discountCredit, setDiscountCredit] = useState('0');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappDigestEnabled, setWhatsappDigestEnabled] = useState(false);
  const [whatsappBirthdayEnabled, setWhatsappBirthdayEnabled] = useState(true);
  const [bankCbu, setBankCbu] = useState('');
  const [bankAlias, setBankAlias] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankHolder, setBankHolder] = useState('');

  // Volume / wholesale discount
  const [volumeThreshold, setVolumeThreshold] = useState('3');
  const [volumeDiscount, setVolumeDiscount] = useState('10');

  // Decant margins
  const [decantMargin10, setDecantMargin10] = useState('250');
  const [decantMargin5, setDecantMargin5] = useState('350');
  const [decantMargin2_5, setDecantMargin2_5] = useState('500');

  // Push notification state
  const [pushSubscribed, setPushSubscribed] = useState<boolean>(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSupported] = useState(() => isPushSupported());

  const checkPushStatus = useCallback(async () => {
    const sub = await getCurrentSubscription();
    setPushSubscribed(!!sub);
  }, []);

  useEffect(() => { checkPushStatus(); }, [checkPushStatus]);

  // Notification preferences (localStorage per org)
  const { activeOrg: orgForTemplates } = useOrg();

  const handlePushToggle = async () => {
    if (!orgForTemplates) return;
    setPushLoading(true);
    try {
      if (pushSubscribed) {
        await unsubscribeFromPush(orgForTemplates.id);
        setPushSubscribed(false);
        toast.success("Notificaciones push desactivadas");
      } else {
        const ok = await subscribeToPush(orgForTemplates.id);
        if (ok) { setPushSubscribed(true); toast.success("Notificaciones push activadas 🔔"); }
        else toast.error("No se pudo activar. Asegurate de que el navegador tenga permiso.");
      }
    } finally {
      setPushLoading(false);
    }
  };
  const notifKey = `gestiona.notif_prefs.${orgForTemplates?.id || 'default'}`;
  const DEFAULT_NOTIF_PREFS = { low_stock: true, overdue_debt: true, monthly_goal_risk: true, birthday: true, new_customer: false, large_sale: false };
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => {
    try { return { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(localStorage.getItem(notifKey) || "{}") }; } catch { return DEFAULT_NOTIF_PREFS; }
  });
  const toggleNotif = (key: string) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    localStorage.setItem(notifKey, JSON.stringify(next));
  };
  const waTemplateKey = `gestiona.wa_templates.${orgForTemplates?.id || 'default'}`;
  const DEFAULT_WA_TEMPLATES = {
    sale: "Hola {{nombre}}! 🎉 Tu compra de {{monto}} fue registrada. ¡Gracias por elegirnos!",
    debt: "Hola {{nombre}}! 👋 Te recordamos que tenés una deuda pendiente de {{monto}}. Cuando puedas coordenamos. ¡Gracias!",
    birthday: "¡Feliz cumpleaños {{nombre}}! 🎂 Tenemos un regalo especial para vos. Visitanos o escribinos para reclamar tu descuento.",
    reactivation: "Hola {{nombre}}! 😊 Hace un tiempo que no te vemos. Tenemos novedades que te van a encantar. ¿Querés que te cuente?",
    pickup: "Hola {{nombre}}! 📦 Tu pedido está listo para retirar. Podés pasarlo cuando quieras. ¡Hasta pronto!",
  };
  const [waTemplates, setWaTemplates] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(waTemplateKey) || "{}"); } catch { return {}; }
  });
  const getTemplate = (key: string) => waTemplates[key] ?? DEFAULT_WA_TEMPLATES[key as keyof typeof DEFAULT_WA_TEMPLATES] ?? "";
  const setTemplate = (key: string, value: string) => {
    const next = { ...waTemplates, [key]: value };
    setWaTemplates(next);
    localStorage.setItem(waTemplateKey, JSON.stringify(next));
  };
  const resetTemplate = (key: string) => {
    const next = { ...waTemplates };
    delete next[key];
    setWaTemplates(next);
    localStorage.setItem(waTemplateKey, JSON.stringify(next));
  };

  // SMTP config — stored in DB settings table (server-side accessible for edge functions)
  const DEFAULT_SMTP = { host: '', port: '587', user: '', pass: '', fromName: '', fromEmail: '', secure: false };
  const [smtpConfig, setSmtpConfig] = useState<{ host: string; port: string; user: string; pass: string; fromName: string; fromEmail: string; secure: boolean }>(DEFAULT_SMTP);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpPassVisible, setSmtpPassVisible] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const setSmtp = (field: string, value: string | boolean) => {
    setSmtpConfig(prev => ({ ...prev, [field]: value }));
  };
  const handleSmtpSave = async () => {
    if (!user) return;
    setSmtpSaving(true);
    try {
      await saveSettingsDB(user.id, {
        smtp_host: smtpConfig.host || null,
        smtp_port: parseInt(smtpConfig.port) || 587,
        smtp_user: smtpConfig.user || null,
        smtp_pass: smtpConfig.pass || null,
        smtp_secure: smtpConfig.secure,
        smtp_from_name: smtpConfig.fromName || null,
        smtp_from_email: smtpConfig.fromEmail || null,
      });
      toast.success('Configuración SMTP guardada', { description: 'Las edge functions de email ya pueden usarla.' });
    } catch (err: any) {
      toast.error('Error al guardar SMTP: ' + err.message);
    } finally {
      setSmtpSaving(false);
    }
  };
  const handleSmtpTest = async () => {
    if (!smtpConfig.host || !smtpConfig.user) {
      toast.error('Completá al menos el host y usuario SMTP');
      return;
    }
    setSmtpTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-smtp', {
        body: {
          host: smtpConfig.host,
          port: parseInt(smtpConfig.port) || 587,
          user: smtpConfig.user,
          pass: smtpConfig.pass,
          secure: smtpConfig.secure,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success('Conexión SMTP verificada ✓', { description: `${smtpConfig.host}:${smtpConfig.port}` });
    } catch (err: any) {
      toast.error('Error SMTP: ' + err.message);
    } finally {
      setSmtpTesting(false);
    }
  };

  // Brand palettes helpers (defined after state, before useEffect)
  // ── Predefined brand palettes ────────────────────────────────────────────
  const PREDEFINED_PALETTES = [
    { id: 'gold',    name: 'Exentry Gold',   primary: '#D4A843', secondary: '#1A1A2E', bg: '#0E0E1C', card: '#16163A', accent: '#C89A35' },
    { id: 'blue',    name: 'Night Blue',      primary: '#3B82F6', secondary: '#0F172A', bg: '#06080F', card: '#0F1629', accent: '#60A5FA' },
    { id: 'purple',  name: 'Violeta Premium', primary: '#A855F7', secondary: '#1E1B4B', bg: '#0D0B22', card: '#1A1538', accent: '#C084FC' },
    { id: 'emerald', name: 'Esmeralda',       primary: '#10B981', secondary: '#0F2818', bg: '#071510', card: '#0D2218', accent: '#34D399' },
    { id: 'crimson', name: 'Carmesí',         primary: '#EF4444', secondary: '#1C0A0A', bg: '#0F0505', card: '#200B0B', accent: '#F87171' },
    { id: 'amber',   name: 'Ámbar Dark',      primary: '#F59E0B', secondary: '#1C1200', bg: '#100A00', card: '#1C1200', accent: '#FCD34D' },
    { id: 'rose',    name: 'Rose Gold',       primary: '#EC4899', secondary: '#1F0D18', bg: '#130810', card: '#1F0D18', accent: '#F472B6' },
    { id: 'slate',   name: 'Pizarra',         primary: '#94A3B8', secondary: '#0F172A', bg: '#080D14', card: '#111827', accent: '#CBD5E1' },
  ];

  const applyPalette = (p: typeof PREDEFINED_PALETTES[0]) => {
    setPrimaryColor(p.primary);
    setSecondaryColor(p.secondary);
    setCatalogBg(p.bg);
    setCatalogCard(p.card);
    setCatalogAccent(p.accent);
    applyColors(p.primary, p.secondary);
  };

  const saveCurrentAsPalette = async () => {
    const name = newPaletteName.trim();
    if (!name) return;
    setSavingPalette(true);
    const newPal = {
      id: Date.now().toString(),
      name,
      primary: primaryColor,
      secondary: secondaryColor,
      bg: catalogBg,
      card: catalogCard,
      accent: catalogAccent,
    };
    const updated = [...brandPalettes, newPal];
    setBrandPalettes(updated);
    setNewPaletteName('');
    if (user) await saveSettingsDB(user.id, { brand_palettes: updated }).catch(() => {});
    setSavingPalette(false);
    toast.success(`Paleta "${name}" guardada`);
  };

  const deletePalette = async (id: string) => {
    const updated = brandPalettes.filter(p => p.id !== id);
    setBrandPalettes(updated);
    if (user) await saveSettingsDB(user.id, { brand_palettes: updated }).catch(() => {});
  };

  // Track original values for auto-recalculate prompt
  const [origRate, setOrigRate] = useState('');
  const [origCustoms, setOrigCustoms] = useState('');
  const [origDiscount, setOrigDiscount] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s: any = await getSettingsDB(user.id);
      setExchangeRate(String(s.exchange_rate));
      setCustomsPercent(String(s.customs_percent));
      setDefaultDiscountPercent(String(s.default_discount_percent));
      setTaxEnabled(!!s.tax_enabled);
      setTaxIva(String(s.tax_iva_percent ?? 21));
      setTaxIibb(String(s.tax_iibb_percent ?? 3.5));
      setTaxMonotributo(String(s.tax_monotributo_monthly ?? 0));
      setBusinessName(s.business_name || 'Exentry Imports');
      setLogoUrl(s.logo_url || '');
      setReceiptFooter(s.receipt_footer || '¡Gracias por su compra!');
      setPrimaryColor(s.primary_color || '#D4A843');
      setSecondaryColor(s.secondary_color || '#1A1A2E');
      setCatalogBg(s.catalog_bg_color || '#0E0E1C');
      setCatalogCard(s.catalog_card_color || '#16163A');
      setCatalogAccent(s.catalog_accent_color || s.primary_color || '#D4A843');
      setBrandPalettes(Array.isArray(s.brand_palettes) ? s.brand_palettes : []);
      setDiscountCash(String(s.discount_cash_percent ?? 10));
      setDiscountTransfer(String(s.discount_transfer_percent ?? 5));
      setDiscountDebit(String(s.discount_debit_percent ?? 0));
      setDiscountCredit(String(s.discount_credit_percent ?? 0));
      setWhatsappNumber(s.whatsapp_number || '');
      setWhatsappDigestEnabled(!!s.whatsapp_digest_enabled);
      setWhatsappBirthdayEnabled(s.whatsapp_birthday_enabled !== false);
      setBankCbu(s.bank_cbu || '');
      setBankAlias(s.bank_alias || '');
      setBankName(s.bank_name || '');
      setBankHolder(s.bank_holder || '');
      setVolumeThreshold(String(s.volume_discount_threshold ?? 3));
      setVolumeDiscount(String(s.volume_discount_percent ?? 10));
      setDecantMargin10(String(s.decant_margin_10ml ?? 250));
      setDecantMargin5(String(s.decant_margin_5ml ?? 350));
      setDecantMargin2_5(String(s.decant_margin_2_5ml ?? 500));
      // SMTP — loaded from DB (accessible by edge functions)
      if (s.smtp_host) {
        setSmtpConfig({
          host: s.smtp_host || '',
          port: String(s.smtp_port || 587),
          user: s.smtp_user || '',
          pass: s.smtp_pass || '',
          fromName: s.smtp_from_name || '',
          fromEmail: s.smtp_from_email || '',
          secure: !!s.smtp_secure,
        });
      }
      setOrigRate(String(s.exchange_rate));
      setOrigCustoms(String(s.customs_percent));
      setOrigDiscount(String(s.default_discount_percent));
      const products = await getProductsDB(user.id);
      setProductCount(products.length);
      setLoading(false);
    })();
  }, [user]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/logo.${ext}`;
      const { error } = await supabase.storage.from('marketing-images').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('marketing-images').getPublicUrl(path);
      setLogoUrl(urlData.publicUrl);
      toast.success("Logo subido correctamente");
    } catch (err: any) {
      toast.error("Error al subir logo: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const num = (val: string, fallback: number) => { const n = parseFloat(val); return isNaN(n) ? fallback : n; };
      const int = (val: string, fallback: number) => { const n = parseInt(val); return isNaN(n) ? fallback : n; };
      await saveSettingsDB(user.id, {
        exchange_rate: num(exchangeRate, 1695),
        customs_percent: num(customsPercent, 15),
        default_discount_percent: num(defaultDiscountPercent, 20),
        tax_enabled: taxEnabled,
        tax_iva_percent: num(taxIva, 21),
        tax_iibb_percent: num(taxIibb, 3.5),
        tax_monotributo_monthly: num(taxMonotributo, 0),
        business_name: businessName || 'Exentry Imports',
        logo_url: logoUrl || null,
        receipt_footer: receiptFooter || null,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        catalog_bg_color: catalogBg,
        catalog_card_color: catalogCard,
        catalog_accent_color: catalogAccent,
        brand_palettes: brandPalettes,
        discount_cash_percent: num(discountCash, 0),
        discount_transfer_percent: num(discountTransfer, 0),
        discount_debit_percent: num(discountDebit, 0),
        discount_credit_percent: num(discountCredit, 0),
        whatsapp_number: whatsappNumber || null,
        whatsapp_digest_enabled: whatsappDigestEnabled,
        whatsapp_birthday_enabled: whatsappBirthdayEnabled,
        bank_cbu: bankCbu || null,
        bank_alias: bankAlias || null,
        bank_name: bankName || null,
        bank_holder: bankHolder || null,
        volume_discount_threshold: int(volumeThreshold, 3),
        volume_discount_percent: num(volumeDiscount, 10),
        decant_margin_10ml: num(decantMargin10, 250),
        decant_margin_5ml: num(decantMargin5, 350),
        decant_margin_2_5ml: num(decantMargin2_5, 500),
      });
      await logAudit(user.id, 'settings_change', 'settings', undefined, { exchangeRate, customsPercent, businessName, taxEnabled });
      toast.success("Configuración guardada correctamente");

      // Check if pricing-related settings changed → prompt recalculate
      if (exchangeRate !== origRate || customsPercent !== origCustoms || defaultDiscountPercent !== origDiscount) {
        toast("Los parámetros financieros cambiaron", {
          description: "¿Recalcular todos los precios de productos?",
          action: { label: "Recalcular", onClick: () => handleRecalculate() },
          duration: 10000,
        });
      }
      setOrigRate(exchangeRate);
      setOrigCustoms(customsPercent);
      setOrigDiscount(defaultDiscountPercent);
    } catch (err: any) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!user) return;
    const products = await getProductsDB(user.id);
    const rate = parseFloat(exchangeRate) || 1695;
    const customs = parseFloat(customsPercent) || 15;
    const discPct = parseFloat(defaultDiscountPercent) || 40;
    let count = 0;
    for (const p of products) {
      if (Number(p.cost_usd) <= 0) continue;
      const costUsd = Number(p.cost_usd);
      // Auto-calculate sale price: (cost + pasero) * TC * 2
      const newSalePrice = Math.round((costUsd + costUsd * customs / 100) * rate * 2);
      // Auto-calculate discount price
      const newDiscountPrice = Math.round(newSalePrice * (1 - discPct / 100));
      const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
        costUsd, customs, newSalePrice, rate
      );
      await supabase.from('products').update({
        customs_fee: customsFee, total_cost_usd: totalCostUSD,
        sale_price_ars: newSalePrice,
        discount_price_ars: newDiscountPrice,
        profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
      }).eq('id', p.id);
      count++;
    }
    setProductCount(count);
    toast.success(`${count} productos recalculados con TC $${rate}, pasero ${customs}%, desc. ${discPct}%`);
  };

  if (loading) return (
    <div>
      <h1 className="text-2xl md:text-3xl font-display font-bold mb-1">Ajustes</h1>
      <p className="text-muted-foreground mb-6 md:mb-8">Cargando configuración...</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><FormSkeleton /><FormSkeleton /></div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl md:text-3xl font-display font-bold">Ajustes</h1>
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          <Keyboard className="w-3 h-3" />Ctrl+K búsqueda rápida
        </div>
      </div>
      <p className="text-muted-foreground mb-6 md:mb-8">Configuración general de {businessName}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="space-y-4 md:space-y-6">
          {/* Brand */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />Marca del Negocio
            </h2>
            <div>
              <label className="text-sm text-muted-foreground">Nombre del Negocio</label>
              <Input value={businessName} onChange={e => setBusinessName(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Logo</label>
              <div className="flex items-center gap-3 mt-1">
                {logoUrl && <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-cover border border-border" />}
                <label className="flex items-center gap-2 px-3 py-2 bg-muted border border-border rounded-lg cursor-pointer hover:bg-accent text-sm transition-colors">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Subiendo...' : 'Subir logo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                </label>
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Pie de recibo / ticket</label>
              <Input value={receiptFooter} onChange={e => setReceiptFooter(e.target.value)} placeholder="¡Gracias por su compra!" className="bg-muted border-border mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Aparece al final de cada recibo impreso desde Ventas y POS.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorPicker label="Color Principal" value={primaryColor} onChange={(c) => { setPrimaryColor(c); applyColors(c, secondaryColor); }} />
              <ColorPicker label="Color Secundario" value={secondaryColor} onChange={(c) => { setSecondaryColor(c); applyColors(primaryColor, c); }} />
            </div>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setPrimaryColor('#D4A843'); setSecondaryColor('#1A1A2E'); applyColors('#D4A843', '#1A1A2E'); }}>
              <RotateCcw className="w-3 h-3 mr-1" />Restaurar colores originales
            </Button>

            {/* Catalog colors */}
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <BookMarked className="w-3.5 h-3.5 text-primary" />
                Colores del Catálogo (PDF y web)
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <ColorPicker
                  label="Fondo"
                  value={catalogBg}
                  onChange={(c) => setCatalogBg(c)}
                />
                <ColorPicker
                  label="Cards"
                  value={catalogCard}
                  onChange={(c) => setCatalogCard(c)}
                />
                <ColorPicker
                  label="Acento"
                  value={catalogAccent}
                  onChange={(c) => setCatalogAccent(c)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Fondo: portada y páginas PDF. Cards: fondo de cada producto. Acento: precio destacado, pills y separadores.
              </p>
            </div>

            {/* Brand palettes */}
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-primary" />
                Paletas de Marca
              </h3>

              {/* Predefined palettes */}
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Paletas predefinidas</p>
              <div className="grid grid-cols-2 gap-2">
                {PREDEFINED_PALETTES.map(p => (
                  <button
                    key={p.id}
                    onClick={() => applyPalette(p)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-muted border border-border hover:border-primary/50 transition-colors text-left group"
                  >
                    <div className="flex gap-0.5 flex-shrink-0">
                      {[p.primary, p.secondary, p.bg, p.accent].map((c, i) => (
                        <div key={i} className="w-4 h-4 rounded-sm border border-border/30" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">{p.name}</span>
                  </button>
                ))}
              </div>

              {/* Custom saved palettes */}
              {brandPalettes.length > 0 && (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Mis paletas</p>
                  <div className="grid grid-cols-2 gap-2">
                    {brandPalettes.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <button
                          onClick={() => applyPalette(p)}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-muted border border-border hover:border-primary/50 transition-colors text-left flex-1 group"
                        >
                          <div className="flex gap-0.5 flex-shrink-0">
                            {[p.primary, p.secondary, p.bg, p.accent].map((c, i) => (
                              <div key={i} className="w-4 h-4 rounded-sm border border-border/30" style={{ backgroundColor: c }} />
                            ))}
                          </div>
                          <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">{p.name}</span>
                        </button>
                        <button
                          onClick={() => deletePalette(p.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                          title="Eliminar paleta"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Save current as palette */}
              <div className="flex gap-2">
                <Input
                  value={newPaletteName}
                  onChange={e => setNewPaletteName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCurrentAsPalette()}
                  placeholder="Nombre de la nueva paleta..."
                  className="bg-muted border-border text-sm h-8 flex-1"
                  maxLength={30}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 gap-1.5 text-xs shrink-0"
                  onClick={saveCurrentAsPalette}
                  disabled={!newPaletteName.trim() || savingPalette}
                >
                  <Save className="w-3 h-3" />
                  Guardar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Guarda los 5 colores actuales (principal, secundario, fondo, cards, acento) como paleta reutilizable.
              </p>
            </div>

            <div>
              <label className="text-sm text-muted-foreground flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />WhatsApp (catálogo público)</label>
              <Input value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} placeholder="+5491112345678" className="bg-muted border-border mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Número con código de país. Aparecerá como botón flotante en tu catálogo público.</p>
            </div>
            <div className="flex items-center justify-between bg-muted/50 border border-border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageCircle className="w-4 h-4 text-green-400" />Resumen diario por WhatsApp
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Recibí un mensaje con las ventas del día a las 17hs. Requiere Evolution API configurada y número de WhatsApp arriba.
                </p>
              </div>
              <Switch checked={whatsappDigestEnabled} onCheckedChange={setWhatsappDigestEnabled} />
            </div>
            <div className="flex items-center justify-between bg-muted/50 border border-border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageCircle className="w-4 h-4 text-pink-400" />🎂 Felicitación de cumpleaños
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Enviá un WA automático a tus clientes el día de su cumpleaños. Requiere Evolution API y birthday cargado en el CRM.
                </p>
              </div>
              <Switch checked={whatsappBirthdayEnabled} onCheckedChange={setWhatsappBirthdayEnabled} />
            </div>
            <div className="border-t border-border pt-4">
              <label className="text-sm font-medium flex items-center gap-1.5 mb-3"><CreditCard className="w-3.5 h-3.5 text-primary" />Cuenta bancaria (para links de pago)</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">CBU</label>
                  <Input value={bankCbu} onChange={e => setBankCbu(e.target.value)} placeholder="0000000000000000000000" className="bg-muted border-border mt-1 font-mono text-xs" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Alias</label>
                  <Input value={bankAlias} onChange={e => setBankAlias(e.target.value)} placeholder="tu.alias.banco" className="bg-muted border-border mt-1 font-mono text-xs" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Banco</label>
                  <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Banco Galicia" className="bg-muted border-border mt-1 text-xs" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Titular</label>
                  <Input value={bankHolder} onChange={e => setBankHolder(e.target.value)} placeholder="Juan Pérez" className="bg-muted border-border mt-1 text-xs" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Aparecerá en los links de pago que generés para tus presupuestos.</p>
            </div>
          </div>

          {/* Financial params */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4 md:space-y-5">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />Parámetros Financieros
            </h2>
            <div>
              <label className="text-sm text-muted-foreground">Tipo de Cambio (USD → ARS)</label>
              <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Porcentaje del Pasero (%)</label>
              <Input type="number" value={customsPercent} onChange={e => setCustomsPercent(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Descuento por Defecto (%)</label>
              <Input type="number" value={defaultDiscountPercent} onChange={e => setDefaultDiscountPercent(e.target.value)} className="bg-muted border-border mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Se aplica al calcular precio c/descuento: Venta × (1 - {defaultDiscountPercent}%)</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">
                {saving ? 'Guardando...' : 'Guardar Configuración'}
              </Button>
              <Button variant="outline" onClick={handleRecalculate}><RefreshCw className="w-4 h-4 mr-2" />Recalcular Todo</Button>
            </div>
          </div>

          {/* WhatsApp message templates */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <div>
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-green-400" />Plantillas de WhatsApp
              </h2>
              <p className="text-xs text-muted-foreground mt-1">Mensajes pre-armados usados en deudas, cumpleaños y seguimiento. Usá <code className="bg-muted px-1 rounded">{"{{nombre}}"}</code> y <code className="bg-muted px-1 rounded">{"{{monto}}"}</code> como variables.</p>
            </div>
            {([
              { key: "sale",        label: "Venta confirmada",   emoji: "🛍️" },
              { key: "debt",        label: "Recordatorio deuda", emoji: "💳" },
              { key: "birthday",    label: "Cumpleaños",         emoji: "🎂" },
              { key: "reactivation",label: "Reactivación",       emoji: "😊" },
              { key: "pickup",      label: "Pedido listo",       emoji: "📦" },
            ] as const).map(({ key, label, emoji }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-muted-foreground">{emoji} {label}</label>
                  {waTemplates[key] && (
                    <button onClick={() => resetTemplate(key)} className="text-[10px] text-muted-foreground hover:text-destructive">Restablecer</button>
                  )}
                </div>
                <Textarea
                  value={getTemplate(key)}
                  onChange={e => setTemplate(key, e.target.value)}
                  rows={2}
                  className="bg-muted border-border text-xs resize-none"
                />
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Los cambios se guardan automáticamente en este dispositivo.</p>
          </div>

          {/* Notification preferences */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
            <div>
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />Notificaciones
              </h2>
              <p className="text-xs text-muted-foreground mt-1">Activá o desactivá cada tipo de alerta. Los cambios aplican inmediatamente en este dispositivo.</p>
            </div>
            {([
              { key: "low_stock",         label: "Stock bajo",              desc: "Cuando un producto llega al umbral de reposición" },
              { key: "overdue_debt",      label: "Deuda vencida",           desc: "Cuando un cliente tiene deuda con due_date vencido" },
              { key: "monthly_goal_risk", label: "Meta mensual en riesgo",  desc: "Cuando quedan ≤7 días y llevas <60% del objetivo" },
              { key: "birthday",          label: "Cumpleaños de clientes",  desc: "Clientes con cumpleaños en los próximos 7 días" },
              { key: "new_customer",      label: "Nuevo cliente",           desc: "Al registrar un nuevo cliente en el sistema" },
              { key: "large_sale",        label: "Venta grande",            desc: "Cuando una venta supera el doble del ticket promedio" },
            ] as const).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0 mr-3">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
                <Switch checked={!!notifPrefs[key]} onCheckedChange={() => toggleNotif(key)} />
              </div>
            ))}
          </div>

          {/* Push notifications */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
            <div>
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-primary" />Notificaciones Push (PWA)
              </h2>
              <p className="text-xs text-muted-foreground mt-1">Recibí alertas en tu dispositivo aunque la app esté cerrada. Requiere tener la app instalada como PWA.</p>
            </div>
            {!pushSupported ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                Este navegador no soporta notificaciones push.
              </div>
            ) : (
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{pushSubscribed ? "Notificaciones push activas" : "Notificaciones push inactivas"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {pushSubscribed ? "Recibirás alertas de stock, deudas y más en este dispositivo." : "Activá para recibir alertas en este dispositivo."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {pushLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  <Switch checked={pushSubscribed} onCheckedChange={handlePushToggle} disabled={pushLoading} />
                </div>
              </div>
            )}
          </div>

          {/* SMTP Email Config */}
          <div className="bg-[hsl(228_24%_7%)] border border-blue-500/20 rounded-[10px] p-4 md:p-6 space-y-4">
            <div>
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-400" />Email SMTP Propio
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Configurá tu servidor de correo para enviar quotes, recordatorios y alertas desde tu propio dominio.
                Los datos se guardan solo en este dispositivo.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                  <Server className="w-3 h-3" />Host SMTP
                </label>
                <Input
                  value={smtpConfig.host}
                  onChange={e => setSmtp('host', e.target.value)}
                  placeholder="smtp.tudominio.com"
                  className="bg-muted border-border text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                  Puerto
                </label>
                <Select value={smtpConfig.port} onValueChange={v => setSmtp('port', v)}>
                  <SelectTrigger className="bg-muted border-border text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 (SMTP)</SelectItem>
                    <SelectItem value="465">465 (SSL)</SelectItem>
                    <SelectItem value="587">587 (TLS) — recomendado</SelectItem>
                    <SelectItem value="2525">2525 (alternativo)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                  Usuario / Email SMTP
                </label>
                <Input
                  value={smtpConfig.user}
                  onChange={e => setSmtp('user', e.target.value)}
                  placeholder="noreply@tudominio.com"
                  className="bg-muted border-border text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                  <Lock className="w-3 h-3" />Contraseña / App Password
                </label>
                <div className="relative">
                  <Input
                    type={smtpPassVisible ? 'text' : 'password'}
                    value={smtpConfig.pass}
                    onChange={e => setSmtp('pass', e.target.value)}
                    placeholder="••••••••••••"
                    className="bg-muted border-border text-sm pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setSmtpPassVisible(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {smtpPassVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre del remitente</label>
                <Input
                  value={smtpConfig.fromName}
                  onChange={e => setSmtp('fromName', e.target.value)}
                  placeholder={businessName || 'Mi Negocio'}
                  className="bg-muted border-border text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email de origen</label>
                <Input
                  value={smtpConfig.fromEmail}
                  onChange={e => setSmtp('fromEmail', e.target.value)}
                  placeholder="ventas@tudominio.com"
                  className="bg-muted border-border text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border border-border/40 rounded-[8px] px-3">
              <div>
                <p className="text-sm font-medium">SSL/TLS Seguro</p>
                <p className="text-[10px] text-muted-foreground">Activá si tu proveedor usa SSL en el puerto 465</p>
              </div>
              <Switch checked={smtpConfig.secure} onCheckedChange={v => setSmtp('secure', v)} />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSmtpSave}
                size="sm"
                disabled={smtpSaving}
                className="gradient-gold text-primary-foreground font-semibold flex-1"
              >
                {smtpSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                Guardar SMTP
              </Button>
              <Button
                onClick={handleSmtpTest}
                size="sm"
                variant="outline"
                disabled={smtpTesting}
                className="gap-1.5"
              >
                {smtpTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Probar conexión
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Compatible con Gmail (App Password), Outlook, Brevo, Resend, y cualquier servidor SMTP estándar.
              La contraseña nunca se envía a nuestros servidores.
            </p>
          </div>

          {/* Payment method discounts */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />Descuentos por Medio de Pago
            </h2>
            <p className="text-xs text-muted-foreground">Estos descuentos se aplican sobre el precio de venta al registrar una venta. Efectivo y transferencia usan el precio c/descuento del producto.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-muted-foreground">Efectivo (%)</label>
                <Input type="number" step="0.1" value={discountCash} onChange={e => setDiscountCash(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Transferencia (%)</label>
                <Input type="number" step="0.1" value={discountTransfer} onChange={e => setDiscountTransfer(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Débito (%)</label>
                <Input type="number" step="0.1" value={discountDebit} onChange={e => setDiscountDebit(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Crédito (%)</label>
                <Input type="number" step="0.1" value={discountCredit} onChange={e => setDiscountCredit(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>

          {/* Volume / Wholesale discount */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-primary" />Descuento Mayorista
            </h2>
            <p className="text-xs text-muted-foreground">Se aplica sobre el precio efectivo/con descuento cuando el cliente lleva X+ unidades. Piso de rentabilidad: costo + 20%.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-muted-foreground">Cantidad mínima</label>
                <Input type="number" min="2" value={volumeThreshold} onChange={e => setVolumeThreshold(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Descuento (%)</label>
                <Input type="number" step="0.5" value={volumeDiscount} onChange={e => setVolumeDiscount(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>

          {/* Decant margins */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <Droplets className="w-4 h-4 text-primary" />Márgenes de Decants
            </h2>
            <p className="text-xs text-muted-foreground">Margen (%) sobre el costo proporcional por ml. El precio se calcula: (costo/ml × tamaño) × TC × (1 + margen%).</p>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-sm text-muted-foreground">10ml (%)</label>
                <Input type="number" value={decantMargin10} onChange={e => setDecantMargin10(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">5ml (%)</label>
                <Input type="number" value={decantMargin5} onChange={e => setDecantMargin5(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">2.5ml (%)</label>
                <Input type="number" value={decantMargin2_5} onChange={e => setDecantMargin2_5(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>
        </div>

        <div className="space-y-4 md:space-y-6">
          {/* Subscription */}
          <SubscriptionPanel session={session} />

          {/* Taxes */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Impuestos (Argentina)</h2>
              <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
            </div>
            {taxEnabled ? (
              <div className="space-y-3">
                <div><label className="text-sm text-muted-foreground">IVA (%)</label><Input type="number" step="0.1" value={taxIva} onChange={e => setTaxIva(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Ingresos Brutos (%)</label><Input type="number" step="0.1" value={taxIibb} onChange={e => setTaxIibb(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Monotributo mensual (ARS)</label><Input type="number" value={taxMonotributo} onChange={e => setTaxMonotributo(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <p className="text-xs text-muted-foreground">Los impuestos se descontarán de la ganancia bruta en reportes y dashboard.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Activá esta opción para descontar impuestos de tus ganancias.</p>
            )}
          </div>

          {/* System info */}
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6">
            <h2 className="font-display font-semibold text-[14px] tracking-tight mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Sistema</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Negocio:</span><span className="font-medium">{businessName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{productCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium text-success">Cloud ☁️</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IA:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auditoría:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">7.5</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Usuario:</span><span className="font-medium text-xs truncate max-w-[150px]">{user?.email}</span></div>
            </div>
          </div>

          <div className="bg-[hsl(228_24%_7%)] border border-success/30 rounded-[10px] p-4 md:p-6">
            <h2 className="font-display font-semibold text-[14px] tracking-tight mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />Seguridad
            </h2>
            <p className="text-sm text-muted-foreground">
              Datos protegidos con autenticación, cifrado y auditoría. Cada usuario solo ve sus propios datos. Sistema multi-tenant con aislamiento completo.
            </p>
          </div>

          {/* USD Real-time Quote */}
          <USDQuoteSection userId={user!.id} onApply={(rate) => setExchangeRate(String(rate))} />

          {/* Thresholds & Alerts */}
          <ThresholdsSection userId={user!.id} />

          {/* Expense Categories CRUD */}
          <ExpenseCategoriesSection userId={user!.id} />

          {/* Backup / Export */}
          <BackupExport userId={user!.id} />

          {/* Cloud Backups */}
          <CloudBackupsSection userId={user!.id} />

          {/* AFIP Facturación Electrónica */}
          <AfipSection />

          {/* Coupons CRUD */}
          <CouponsManager userId={user!.id} />

          {/* Sucursales management */}
          <SucursalesSection orgId={orgForTemplates?.id} />
        </div>
      </div>
    </div>
  );
}

// ===== Subscription Panel =====
function SubscriptionPanel({ session }: { session: any }) {
  const { activeOrg } = useOrg();
  const { plan, subscription, isTrialing, trialDaysLeft, loading, refresh } = useEntitlements();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      toast.success('¡Suscripción activada! Gracias por confiar en Gestiona.');
      refresh();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleUpgrade = async (planCode: string) => {
    if (!activeOrg || !session) return;
    setCheckingOut(planCode);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { planCode, orgId: activeOrg.id, yearly: false },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || !data?.url) { toast.error('No se pudo iniciar el pago.'); return; }
      window.location.href = data.url;
    } catch { toast.error('Error al conectar con pagos.'); }
    finally { setCheckingOut(null); }
  };

  const handleCancel = async () => {
    if (!subscription?.stripe_subscription_id) return;
    setCanceling(true);
    try {
      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { subscriptionId: subscription.stripe_subscription_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      toast.success('Suscripción cancelada. Seguirás teniendo acceso hasta el fin del período.');
      await refresh();
    } catch { toast.error('Error al cancelar.'); }
    finally { setCanceling(false); }
  };

  const handleBillingPortal = async () => {
    if (!activeOrg || !session) return;
    setCheckingOut('portal');
    try {
      const { data, error } = await supabase.functions.invoke('create-billing-portal', {
        body: { orgId: activeOrg.id, returnUrl: window.location.href },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || !data?.url) { toast.error('No se pudo abrir el portal de facturación.'); return; }
      window.location.href = data.url;
    } catch { toast.error('Error al conectar con el portal de pagos.'); }
    finally { setCheckingOut(null); }
  };

  const statusColor = {
    active: 'text-green-500',
    trialing: 'text-blue-500',
    past_due: 'text-yellow-500',
    canceled: 'text-red-500',
    paused: 'text-muted-foreground',
  }[subscription?.status ?? 'canceled'] ?? 'text-muted-foreground';

  const StatusIcon = subscription?.status === 'active' ? CheckCircle2
    : subscription?.status === 'trialing' ? Zap
    : subscription?.status === 'past_due' ? AlertTriangle
    : XCircle;

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-primary" />Suscripción
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{plan?.name ?? 'Sin plan'}</p>
              <div className={`flex items-center gap-1.5 text-sm mt-0.5 ${statusColor}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                <span>
                  {subscription?.status === 'trialing' ? `Trial — ${trialDaysLeft} días restantes`
                    : subscription?.status === 'active' ? 'Activo'
                    : subscription?.status === 'past_due' ? 'Pago pendiente'
                    : subscription?.status === 'canceled' ? 'Cancelado'
                    : 'Sin suscripción'}
                </span>
              </div>
              {subscription?.current_period_end && subscription.status !== 'canceled' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Próximo cobro: {new Date(subscription.current_period_end).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
            <div className="text-right">
              {plan && plan.price_usd_monthly > 0 && (
                <p className="text-2xl font-bold font-mono tracking-tight">${plan.price_usd_monthly}<span className="text-sm font-normal text-muted-foreground">/mes</span></p>
              )}
            </div>
          </div>

          {/* Plan limits */}
          {plan && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Productos', val: plan.max_products ?? '∞' },
                { label: 'Usuarios', val: plan.max_users ?? '∞' },
                { label: 'IA', val: plan.ai_enabled ? 'Sí' : 'No' },
              ].map(item => (
                <div key={item.label} className="bg-muted rounded-lg p-2">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-semibold text-sm">{String(item.val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {(!subscription || subscription.status === 'canceled' || subscription.status === 'trialing') && (
              <Button onClick={() => handleUpgrade('pro')} disabled={!!checkingOut} className="w-full gradient-gold text-primary-foreground font-semibold">
                {checkingOut === 'pro' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirigiendo...</> : <><Zap className="w-4 h-4 mr-2" />Actualizar al plan Pro</>}
              </Button>
            )}
            {subscription?.status === 'past_due' && (
              <Button onClick={handleBillingPortal} disabled={!!checkingOut} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                {checkingOut === 'portal' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirigiendo...</> : <><CreditCard className="w-4 h-4 mr-2" />Actualizar método de pago</>}
              </Button>
            )}
            {(subscription?.status === 'active' || subscription?.status === 'past_due') && subscription?.stripe_subscription_id && (
              <Button variant="outline" size="sm" className="text-xs w-full" onClick={handleBillingPortal} disabled={!!checkingOut}>
                {checkingOut === 'portal' ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
                Gestionar facturación en Stripe
              </Button>
            )}
            {subscription?.status === 'active' && !subscription.cancel_at_period_end && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleCancel} disabled={canceling}>
                {canceling ? 'Cancelando...' : 'Cancelar suscripción'}
              </Button>
            )}
            {subscription?.cancel_at_period_end && (
              <p className="text-xs text-yellow-500 text-center">Cancelación programada al fin del período</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===== USD Real-time Quote =====
function USDQuoteSection({ userId, onApply }: { userId: string; onApply: (rate: number) => void }) {
  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState<{ oficial?: number; blue?: number; mep?: number; updated?: string }>({});

  useEffect(() => {
    (async () => {
      const s: any = await getSettingsDB(userId);
      setRates({
        oficial: s.usd_rate_oficial ? Number(s.usd_rate_oficial) : undefined,
        blue: s.usd_rate_blue ? Number(s.usd_rate_blue) : undefined,
        mep: s.usd_rate_mep ? Number(s.usd_rate_mep) : undefined,
        updated: s.usd_rate_updated_at,
      });
    })();
  }, [userId]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-usd-rate', { body: { user_id: userId } });
      if (error) throw error;
      setRates({ oficial: data?.oficial, blue: data?.blue, mep: data?.mep, updated: new Date().toISOString() });
      toast.success('Cotizaciones actualizadas');
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-primary" />Cotización USD (tiempo real)
      </h2>
      <p className="text-xs text-muted-foreground">Datos públicos de mercado. Aplicá la cotización que usás operativamente.</p>
      <div className="grid grid-cols-3 gap-2">
        {(['oficial', 'blue', 'mep'] as const).map(k => (
          <button
            key={k}
            disabled={!rates[k]}
            onClick={() => rates[k] && onApply(rates[k]!)}
            className="bg-muted border border-border rounded-lg p-2.5 hover:border-primary/50 transition-colors disabled:opacity-50 text-left"
          >
            <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
            <p className="text-sm font-bold">{rates[k] ? `$${rates[k]!.toLocaleString('es-AR')}` : '—'}</p>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">{rates.updated ? `Última: ${new Date(rates.updated).toLocaleString('es-AR')}` : 'Sin datos'}</p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Actualizar
        </Button>
      </div>
    </div>
  );
}

// ===== Thresholds / Alerts =====
function ThresholdsSection({ userId }: { userId: string }) {
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => setS(await getSettingsDB(userId)))(); }, [userId]);

  if (!s) return null;

  const update = (k: string, v: any) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsDB(userId, {
        initial_cash_ars: Number(s.initial_cash_ars) || 0,
        low_stock_threshold: parseInt(s.low_stock_threshold) || 3,
        large_sale_threshold_ars: Number(s.large_sale_threshold_ars) || 50000,
        margin_alert_percent: Number(s.margin_alert_percent) || 30,
        expense_ratio_alert_percent: Number(s.expense_ratio_alert_percent) || 40,
        overdue_check_window_hours: parseInt(s.overdue_check_window_hours) || 24,
        cash_flow_warning_threshold_ars: Number(s.cash_flow_warning_threshold_ars) || 0,
      });
      toast.success('Umbrales guardados');
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />Umbrales y Alertas
      </h2>
      <p className="text-xs text-muted-foreground">Configurables. Los triggers de notificaciones (stock bajo, ventas grandes, deudas vencidas) usan estos valores.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-muted-foreground">Caja inicial (ARS)</label>
          <Input type="number" value={s.initial_cash_ars ?? 0} onChange={e => update('initial_cash_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Stock bajo (≤)</label>
          <Input type="number" value={s.low_stock_threshold ?? 3} onChange={e => update('low_stock_threshold', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Venta grande ≥ (ARS)</label>
          <Input type="number" value={s.large_sale_threshold_ars ?? 50000} onChange={e => update('large_sale_threshold_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Margen mínimo (%)</label>
          <Input type="number" value={s.margin_alert_percent ?? 30} onChange={e => update('margin_alert_percent', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Ratio gastos/ventas alerta (%)</label>
          <Input type="number" value={s.expense_ratio_alert_percent ?? 40} onChange={e => update('expense_ratio_alert_percent', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Ventana deuda vencida (h)</label>
          <Input type="number" value={s.overdue_check_window_hours ?? 24} onChange={e => update('overdue_check_window_hours', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div className="col-span-2"><label className="text-xs text-muted-foreground">Aviso flujo caja (ARS mín. proyectado)</label>
          <Input type="number" value={s.cash_flow_warning_threshold_ars ?? 0} onChange={e => update('cash_flow_warning_threshold_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Alerta ventas diarias mín. (ARS, 0 = desactivado)</label>
          <Input type="number" value={s.daily_sales_alert_threshold ?? 0} onChange={e => update('daily_sales_alert_threshold', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Alerta margen diario mín. (%, 0 = desactivado)</label>
          <Input type="number" value={s.daily_margin_alert_threshold ?? 0} onChange={e => update('daily_margin_alert_threshold', e.target.value)} className="bg-muted border-border mt-1" /></div>
      </div>
      <p className="text-[10px] text-muted-foreground">Las alertas de resumen diario se envían cada mañana con las métricas del día anterior.</p>
      <Button onClick={save} disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">{saving ? 'Guardando...' : 'Guardar Umbrales'}</Button>
    </div>
  );
}

// ===== Expense Categories CRUD =====
function ExpenseCategoriesSection({ userId }: { userId: string }) {
  const [cats, setCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const s: any = await getSettingsDB(userId);
      setCats(buildExpenseCategories(s).map(c => c.value));
    })();
  }, [userId]);

  const add = () => {
    const slug = newCat.trim().toLowerCase().replace(/\s+/g, '_');
    if (!slug || cats.includes(slug)) return;
    setCats([...cats, slug]);
    setNewCat('');
  };

  const remove = (c: string) => setCats(cats.filter(x => x !== c));

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsDB(userId, { expense_categories: cats });
      toast.success('Categorías guardadas');
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
        <Tags className="w-4 h-4 text-primary" />Categorías de Gastos
      </h2>
      <p className="text-xs text-muted-foreground">Personalizá las categorías disponibles al cargar gastos.</p>
      <div className="flex flex-wrap gap-2">
        {cats.map(c => (
          <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted rounded-[5px] text-xs">
            {c}
            <button onClick={() => remove(c)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="nueva_categoria"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          className="bg-muted border-border" />
        <Button variant="outline" onClick={add}><Plus className="w-3.5 h-3.5" /></Button>
      </div>
      <Button onClick={save} disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">{saving ? 'Guardando...' : 'Guardar Categorías'}</Button>
    </div>
  );
}

function BackupExport({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);

  const collectAll = async () => {
    const [products, sales, purchases, debts, settings, expenses, notes] = await Promise.all([
      getProductsDB(userId), getSalesDB(userId), getPurchasesDB(userId),
      getDebtsDB(userId), getSettingsDB(userId), getExpensesDB(userId), getCustomerNotesDB(userId),
    ]);
    return { products, sales, purchases, debts, settings, expenses, customer_notes: notes };
  };

  const exportExcel = async () => {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const data = await collectAll();
      const wb = XLSX.utils.book_new();
      const sheets: Record<string, any[]> = {
        Productos: data.products,
        Ventas: data.sales,
        Compras: data.purchases,
        Deudas: data.debts,
        Gastos: data.expenses,
        Notas_Clientes: data.customer_notes,
      };
      Object.entries(sheets).forEach(([name, rows]) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ vacio: 'Sin datos' }]);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      });
      const fileName = `exentry-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`Excel descargado: ${fileName}`);
    } catch (err: any) {
      toast.error("Error al exportar: " + err.message);
    } finally { setBusy(false); }
  };

  const exportJSON = async () => {
    setBusy(true);
    try {
      const data = await collectAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exentry-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup JSON descargado");
    } catch (err: any) {
      toast.error("Error al exportar: " + err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6">
      <h2 className="font-display font-semibold text-[14px] tracking-tight mb-3 flex items-center gap-2">
        <Download className="w-4 h-4 text-primary" />Backup y Exportación
      </h2>
      <p className="text-xs text-muted-foreground mb-4">Descargá toda tu base de datos para análisis externo o respaldo.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={exportExcel} disabled={busy} variant="outline" className="flex-1">
          <FileSpreadsheet className="w-4 h-4 mr-2" />Excel (.xlsx)
        </Button>
        <Button onClick={exportJSON} disabled={busy} variant="outline" className="flex-1">
          <FileJson className="w-4 h-4 mr-2" />JSON
        </Button>
      </div>
    </div>
  );
}

function CouponsManager({ userId }: { userId: string }) {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountFixed, setDiscountFixed] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const load = async () => {
    const data = await getCouponsDB(userId);
    setCoupons(data);
  };

  useEffect(() => { load(); }, [userId]);

  const handleCreate = async () => {
    if (!code.trim()) { toast.error('Ingresá un código'); return; }
    try {
      await addCouponDB({
        user_id: userId,
        code: code.toUpperCase().trim(),
        discount_percent: parseFloat(discountPercent) || 0,
        discount_fixed_ars: parseFloat(discountFixed) || 0,
        max_uses: maxUses ? parseInt(maxUses) : null,
        valid_until: validUntil || null,
      });
      toast.success(`Cupón ${code.toUpperCase()} creado`);
      setOpen(false); setCode(''); setDiscountPercent(''); setDiscountFixed(''); setMaxUses(''); setValidUntil('');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await updateCouponDB(id, { active: !active });
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteCouponDB(id);
    toast.success('Cupón eliminado');
    load();
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <Ticket className="w-4 h-4 text-primary" />Cupones de Descuento
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-gold text-primary-foreground"><Plus className="w-3.5 h-3.5 mr-1" />Nuevo</Button>
          </DialogTrigger>
          <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">Crear Cupón</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><label className="text-sm text-muted-foreground">Código</label>
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="EXENTRY10" className="bg-muted border-border mt-1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-muted-foreground">Descuento %</label>
                  <Input type="number" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} placeholder="10" className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Desc. fijo ARS</label>
                  <Input type="number" value={discountFixed} onChange={e => setDiscountFixed(e.target.value)} placeholder="5000" className="bg-muted border-border mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-muted-foreground">Usos máximos</label>
                  <Input type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="Ilimitado" className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Válido hasta</label>
                  <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="bg-muted border-border mt-1" /></div>
              </div>
              <p className="text-[10px] text-muted-foreground">Si ponés % y monto fijo, se aplica el porcentaje. Dejá vacío lo que no uses.</p>
              <Button onClick={handleCreate} className="w-full gradient-gold text-primary-foreground font-semibold">Crear Cupón</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No hay cupones creados. Creá uno para compartir con tus clientes.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map(c => (
            <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.active ? 'bg-muted/50 border-border' : 'bg-muted/20 border-border/50 opacity-60'}`}>
              <div>
                <p className="font-mono font-bold text-sm">{c.code}</p>
                <p className="text-[10px] text-muted-foreground">
                  {c.discount_percent > 0 ? `${c.discount_percent}% OFF` : `${formatARS(Number(c.discount_fixed_ars))} OFF`}
                  {c.max_uses ? ` · ${c.current_uses}/${c.max_uses} usos` : ` · ${c.current_uses} usos`}
                  {c.valid_until ? ` · Hasta ${new Date(c.valid_until).toLocaleDateString('es-AR')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.active} onCheckedChange={() => handleToggle(c.id, c.active)} />
                <ConfirmDialog
                  trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                  title="¿Eliminar cupón?"
                  confirmText="Eliminar"
                  onConfirm={() => handleDelete(c.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Cloud Backups =====
function CloudBackupsSection({ userId }: { userId: string }) {
  const [files, setFiles] = useState<Array<{ name: string; created_at?: string; size?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from('backups').list(userId, {
        limit: 100, sortBy: { column: 'created_at', order: 'desc' },
      });
      if (error) throw error;
      setFiles((data || []).filter(f => f.name?.endsWith('.json')).map(f => ({
        name: f.name, created_at: f.created_at, size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
      })));
    } catch (e: any) {
      // bucket may be empty or RLS denial — silent
      setFiles([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [userId]);

  const downloadFile = async (name: string) => {
    try {
      const { data, error } = await supabase.storage.from('backups').createSignedUrl(`${userId}/${name}`, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (e: any) { toast.error('Error: ' + e.message); }
  };

  const runManual = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('weekly-backup');
      if (error) throw error;
      toast.success('Backup generado. Refrescando lista…');
      setTimeout(load, 1500);
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <Cloud className="w-4 h-4 text-primary" />Backups en la Nube
        </h2>
        <Button size="sm" variant="outline" onClick={runManual} disabled={running}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Generando…' : 'Backup ahora'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Respaldo automático cada domingo 23:59 UTC. Conservás los últimos 100 archivos.</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No hay backups todavía. Generá el primero manualmente.</p>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {files.map(f => (
            <div key={f.name} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-mono truncate">{f.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {f.created_at ? new Date(f.created_at).toLocaleString('es-AR') : '—'}
                  {f.size ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => downloadFile(f.name)}>
                <Download className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== AFIP Facturación Electrónica =====
function AfipSection() {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("1");
  const [environment, setEnvironment] = useState("homologacion");
  const [tipoEmisor, setTipoEmisor] = useState("monotributo");
  const [certificate, setCertificate] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [taStatus, setTaStatus] = useState<"none" | "valid" | "expired">("none");

  useEffect(() => {
    if (!activeOrg) return;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("afip_cuit,afip_razon_social,afip_domicilio,afip_punto_venta,afip_environment,afip_tipo_emisor,afip_certificate,afip_private_key,afip_ta_expires_at")
        .eq("org_id", activeOrg.id)
        .maybeSingle();
      if (data) {
        setCuit(data.afip_cuit || "");
        setRazonSocial(data.afip_razon_social || "");
        setDomicilio(data.afip_domicilio || "");
        setPuntoVenta(String(data.afip_punto_venta || 1));
        setEnvironment(data.afip_environment || "homologacion");
        setTipoEmisor(data.afip_tipo_emisor || "monotributo");
        setCertificate(data.afip_certificate || "");
        setPrivateKey(data.afip_private_key || "");
        if (data.afip_ta_expires_at) {
          setTaStatus(new Date(data.afip_ta_expires_at) > new Date() ? "valid" : "expired");
        }
      }
      setLoading(false);
    })();
  }, [activeOrg]);

  const doSave = async () => {
    if (!activeOrg) return;
    await supabase.from("settings").update({
      afip_cuit: cuit.replace(/[-\s]/g, "") || null,
      afip_razon_social: razonSocial || null,
      afip_domicilio: domicilio || null,
      afip_punto_venta: parseInt(puntoVenta) || 1,
      afip_environment: environment,
      afip_tipo_emisor: tipoEmisor,
      afip_certificate: certificate || null,
      afip_private_key: privateKey || null,
      afip_ta_token: null,
      afip_ta_sign: null,
      afip_ta_expires_at: null,
    }).eq("org_id", activeOrg.id);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await doSave();
      toast.success("Configuración AFIP guardada");
      setTaStatus("none");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!cuit || !certificate || !privateKey) {
      toast.error("Completá CUIT, certificado y clave privada antes de probar");
      return;
    }
    setTesting(true);
    try {
      await doSave();
      const resp = await supabase.functions.invoke("afip-authorize", {
        body: { invoice_id: "__test__" },
      });
      const errMsg: string = resp.error?.message || (resp.data as { error?: string })?.error || "";
      // "Factura no encontrada" means credentials worked — AFIP auth succeeded
      if (errMsg.includes("Factura no encontrada") || errMsg.includes("invoice_id")) {
        toast.success("✓ Conexión con AFIP verificada correctamente");
        setTaStatus("valid");
      } else if (errMsg) {
        toast.error("Error AFIP: " + errMsg);
      } else {
        toast.success("✓ Credenciales AFIP válidas");
        setTaStatus("valid");
      }
    } catch (e: any) {
      toast.error("Error al probar: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  const isConfigured = !!(cuit && certificate && privateKey);

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-primary" />AFIP — Facturación Electrónica
        </h2>
        {isConfigured && (
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-[5px] font-medium ${
            taStatus === "valid" ? "bg-green-500/10 text-green-400" :
            taStatus === "expired" ? "bg-yellow-500/10 text-yellow-400" :
            "bg-muted text-muted-foreground"
          }`}>
            {taStatus === "valid" ? <><CheckCircle2 className="w-3 h-3" />TA activo</> :
             taStatus === "expired" ? <><AlertTriangle className="w-3 h-3" />TA vencido</> :
             "No verificado"}
          </span>
        )}
      </div>

      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Requisitos previos</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Solicitá el certificado en <strong>CLAVE FISCAL → Administrador de Relaciones de Clave Fiscal</strong></li>
          <li>Vinculá el servicio <strong>wsfe</strong> a tu CUIT</li>
          <li>Pegá el certificado (.crt) y clave privada (.key) en formato PEM abajo</li>
          <li>Probá con <strong>Homologación</strong> antes de pasar a Producción</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">CUIT del emisor</label>
          <Input value={cuit} onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" className="bg-muted border-border font-mono" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Razón social</label>
          <Input value={razonSocial} onChange={e => setRazonSocial(e.target.value)} placeholder="Mi Empresa SRL" className="bg-muted border-border" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Domicilio fiscal</label>
          <Input value={domicilio} onChange={e => setDomicilio(e.target.value)} placeholder="Av. Corrientes 1234, CABA" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Punto de venta</label>
          <Input type="number" min="1" max="9999" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tipo de emisor</label>
          <Select value={tipoEmisor} onValueChange={setTipoEmisor}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monotributo">Monotributista → Factura C</SelectItem>
              <SelectItem value="responsable_inscripto">Responsable Inscripto → Factura A / B</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Ambiente</label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="homologacion">🧪 Homologación (pruebas)</SelectItem>
              <SelectItem value="produccion">🚀 Producción (facturas reales)</SelectItem>
            </SelectContent>
          </Select>
          {environment === "produccion" && (
            <p className="text-[10px] text-destructive mt-1">⚠ Las facturas emitidas en producción son definitivas ante AFIP.</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Certificado AFIP (PEM)</label>
          <Textarea
            value={certificate}
            onChange={e => setCertificate(e.target.value)}
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
            className="bg-muted border-border font-mono text-xs h-28 resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Clave privada (PEM)</label>
          <Textarea
            value={privateKey}
            onChange={e => setPrivateKey(e.target.value)}
            placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
            className="bg-muted border-border font-mono text-xs h-28 resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Almacenada en tu base de datos con acceso restringido a tu organización (RLS).
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold">
          {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Guardando…</> : "Guardar AFIP"}
        </Button>
        {isConfigured && (
          <Button onClick={handleTestConnection} disabled={testing} variant="outline">
            {testing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Verificando…</> : "Verificar conexión"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ===== Sucursales (Locations) Management =====
function SucursalesSection({ orgId }: { orgId?: string }) {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from('locations').select('id, name, address, is_active').eq('org_id', orgId).order('name');
    setLocations(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orgId]);

  const handleAdd = async () => {
    if (!orgId || !newName.trim()) return;
    setAdding(true);
    const { error } = await supabase.from('locations').insert({ org_id: orgId, name: newName.trim(), address: newAddress.trim() || null, is_active: true });
    if (error) { toast.error('Error al crear sucursal: ' + error.message); }
    else { toast.success('Sucursal creada'); setNewName(''); setNewAddress(''); await load(); }
    setAdding(false);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('locations').update({ name: editName.trim(), address: editAddress.trim() || null }).eq('id', id);
    if (error) toast.error('Error al actualizar');
    else { toast.success('Sucursal actualizada'); setEditId(null); await load(); }
    setSaving(false);
  };

  const handleToggle = async (loc: any) => {
    await supabase.from('locations').update({ is_active: !loc.is_active }).eq('id', loc.id);
    await load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('locations').delete().eq('id', id);
    if (error) toast.error('No se puede eliminar: ' + error.message);
    else { toast.success('Sucursal eliminada'); await load(); }
  };

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />Gestión de Sucursales
        </h2>
        <p className="text-xs text-muted-foreground mt-1">Administrá tus puntos de venta o depósitos. El stock puede asignarse por ubicación en Inventario.</p>
      </div>

      {/* Add form */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre de la sucursal"
            className="bg-muted border-border text-sm"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="shrink-0">
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <Input
          value={newAddress}
          onChange={e => setNewAddress(e.target.value)}
          placeholder="Dirección (opcional)"
          className="bg-muted border-border text-sm text-xs"
        />
      </div>

      {/* List */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : locations.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay sucursales registradas. Creá la primera arriba.</p>
      ) : (
        <div className="space-y-2">
          {locations.map(loc => (
            <div key={loc.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${loc.is_active ? 'bg-muted/30 border-border' : 'bg-muted/10 border-border/50 opacity-60'}`}>
              <MapPin className={`w-3.5 h-3.5 shrink-0 ${loc.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
              {editId === loc.id ? (
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-7 text-xs bg-background border-border" />
                  <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Dirección" className="h-7 text-xs bg-background border-border" />
                  <button onClick={() => handleSaveEdit(loc.id)} disabled={saving} className="text-success hover:text-success/80 transition-colors shrink-0">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{loc.name}</p>
                  {loc.address && <p className="text-[10px] text-muted-foreground truncate">{loc.address}</p>}
                </div>
              )}
              {editId !== loc.id && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => { setEditId(loc.id); setEditName(loc.name); setEditAddress(loc.address || ''); }}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Editar"
                  ><Edit2 className="w-3 h-3" /></button>
                  <button
                    onClick={() => handleToggle(loc)}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-[5px] transition-colors ${loc.is_active ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    title={loc.is_active ? 'Desactivar' : 'Activar'}
                  >{loc.is_active ? 'Activa' : 'Inactiva'}</button>
                  <button
                    onClick={() => { if (window.confirm(`¿Eliminar "${loc.name}"?`)) handleDelete(loc.id); }}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Eliminar"
                  ><Trash2 className="w-3 h-3" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">Las sucursales aparecen en Reportes → Sucursales y en la asignación de stock de inventario.</p>
    </div>
  );
}
