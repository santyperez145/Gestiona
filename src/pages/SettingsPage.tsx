import { useState, useEffect, useCallback, useMemo } from "react";
import { useStorageEstimate } from "@/hooks/useStorageEstimate";
import { usePermissionStatus } from "@/hooks/usePermissionStatus";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { useAuth } from "@/lib/auth";
import { cotizacionDe } from "@/lib/exchangeRate";
import { useOrg } from "@/lib/orgContext";
import { hardReload } from "@/lib/hardReload";
import { subscribeToPush, unsubscribeFromPush, getCurrentSubscription, isPushSupported } from "@/lib/pushNotifications";
import { useEntitlements } from "@/lib/useEntitlements";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS, calculateProductProfits, getCouponsDB, addCouponDB, updateCouponDB, deleteCouponDB, getSalesDB, getPurchasesDB, getDebtsDB, getExpensesDB, getCustomerNotesDB, buildExpenseCategories } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { getCategoryMarkup, getCategoryDiscount, calcAutoSalePrice, calcAutoDiscountPrice } from "@/lib/pricing";
import { useOrgCategories } from "@/components/products/CategorySelect";
import { nombreDeCategoria } from "@/lib/storeCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { RefreshCw, Database, Shield, Receipt, Palette, Building2, Upload, Keyboard, CreditCard, MessageCircle, ShoppingBag, Droplets, Ticket, Plus, Trash2, FileSpreadsheet, FileJson, Download, Bell, DollarSign, Tags, Cloud, Zap, AlertTriangle, CheckCircle2, XCircle, Loader2, FileCheck, MapPin, Edit2, Check, X, Smartphone, BookMarked, Save, Mail, Lock, Server, Eye, EyeOff, TrendingUp, Package, Tag } from "lucide-react";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { logAudit } from "@/lib/auditLog";
import { FormSkeleton } from "@/components/shared/PageSkeleton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { SupportAccessAuditSection } from "@/components/settings/SupportAccessAuditSection";
import PageHeader from "@/components/shared/PageHeader";
import CostoDeCobrar from "@/components/settings/CostoDeCobrar";
import PlanesDeCuotas from "@/components/settings/PlanesDeCuotas";
import {
  backupTrustLabel,
  createOrganizationBackup,
  downloadOrganizationBackup,
  formatBackupBytes,
  listOrganizationBackups,
  verifyOrganizationBackup,
  type OrganizationBackup,
} from "@/lib/orgBackups";

// ─── SystemInfoSection ────────────────────────────────────────────────────────
function SystemInfoSection({ businessName, productCount, userEmail }: { businessName: string; productCount: number; userEmail?: string }) {
  const storage = useStorageEstimate();
  const perms = usePermissionStatus(["notifications", "camera", "microphone", "geolocation"]);

  const permLabel = (s: string) => s === "granted" ? "✓ Activo" : s === "denied" ? "✗ Bloqueado" : s === "prompt" ? "Sin respuesta" : "—";
  const permColor = (s: string) => s === "granted" ? "text-emerald-400" : s === "denied" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between"><span className="text-muted-foreground">Negocio:</span><span className="font-medium">{businessName}</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{productCount}</span></div>
      {!storage.loading && storage.quota > 0 && (
        <div className="space-y-1 pb-12">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Caché local:</span>
            <span className="font-medium">{storage.usedHuman} / {storage.quotaHuman}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all ${storage.percent > 80 ? "bg-destructive" : storage.percent > 60 ? "bg-yellow-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, storage.percent)}%` }}
            />
          </div>
          {!storage.persisted && (
            <button onClick={storage.requestPersistent} className="text-[10px] text-primary hover:underline">
              Proteger datos del navegador
            </button>
          )}
        </div>
      )}
      <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium text-emerald-400">Cloud ☁️</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Auth:</span><span className="font-medium text-emerald-400">Activo ✓</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">IA:</span><span className="font-medium text-emerald-400">Activo ✓</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Auditoría:</span><span className="font-medium text-emerald-400">Activo ✓</span></div>
      {perms.notifications !== "unsupported" && (
        <div className="flex justify-between"><span className="text-muted-foreground">Notificaciones:</span><span className={`font-medium text-xs ${permColor(perms.notifications)}`}>{permLabel(perms.notifications)}</span></div>
      )}
      {perms.camera !== "unsupported" && (
        <div className="flex justify-between"><span className="text-muted-foreground">Cámara:</span><span className={`font-medium text-xs ${permColor(perms.camera)}`}>{permLabel(perms.camera)}</span></div>
      )}
      <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">8.5</span></div>
      <div className="flex justify-between"><span className="text-muted-foreground">Usuario:</span><span className="font-medium text-xs truncate max-w-[150px]">{userEmail}</span></div>
    </div>
  );
}

const SETTINGS_SECTIONS = [
  { id: "brand", label: "Tienda", title: "Identidad de tienda", description: "Marca, catálogo público y datos visibles para tus compradores.", icon: Building2 },
  { id: "finance", label: "Finanzas", title: "Finanzas y costos", description: "Tipo de cambio, márgenes, gastos y reglas de precio.", icon: DollarSign },
  { id: "messaging", label: "Mensajería", title: "Mensajería y alertas", description: "Plantillas, avisos, email y notificaciones del equipo.", icon: MessageCircle },
  { id: "pricing", label: "Precios", title: "Precios y descuentos", description: "Descuentos por cobro, volumen y presentaciones.", icon: Tags },
  { id: "billing", label: "Suscripción", title: "Suscripción e impuestos", description: "Plan, facturación e impuestos aplicables al negocio.", icon: CreditCard },
  { id: "system", label: "Sistema", title: "Sistema y herramientas", description: "Seguridad, respaldos, AFIP, sucursales y utilidades.", icon: Database },
] as const;

type StorefrontPalette = {
  id: string;
  name: string;
  bg: string;
  card: string;
  accent: string;
  /** Campos heredados: se aceptan para leer paletas anteriores, pero ya no tematizan Gestión. */
  primary?: string;
  secondary?: string;
};

export default function SettingsPage() {
  usePageTitle("Ajustes");
  const { user, session } = useAuth();
  const { activeOrg: orgForTemplates } = useOrg();
  const [settingsSection, setSettingsSection] = usePersistedState(
    orgViewKey("settings.section", orgForTemplates?.id),
    "brand",
  );

  // Un enlace como `/settings#finance` abre esa sección. La preferencia
  // persistida sigue mandando cuando se entra sin hash — la URL sólo gana
  // cuando alguien pidió explícitamente una sección.
  //
  // ⚠️ Se valida contra `SETTINGS_SECTIONS`: un hash inventado no puede dejar
  // la pantalla sin ninguna sección activa, que es como se rompieron en su
  // momento los enlaces `#dashboard-*` con una sección inválida guardada.
  useEffect(() => {
    const pedida = window.location.hash.replace('#', '');
    if (pedida && SETTINGS_SECTIONS.some(s => s.id === pedida)) {
      setSettingsSection(pedida);
    }
  }, [setSettingsSection]);
  const [exchangeRate, setExchangeRate] = useState('');
  const { rates: liveRatesData, loading: fetchingRate, refresh: fetchBlueRateRaw } = useExchangeRates(false);
  const liveRates = liveRatesData ? {
    oficial: liveRatesData.oficial,
    blue: liveRatesData.blue,
    ccl: liveRatesData.ccl || liveRatesData.mep,
    timestamp: new Date(liveRatesData.lastUpdated).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  } : null;
  const fetchBlueRate = async () => {
    await fetchBlueRateRaw();
    if (liveRatesData) {
      toast.success(`💵 Dólar blue: $${liveRatesData.blue.toLocaleString('es-AR')} · Oficial: $${liveRatesData.oficial.toLocaleString('es-AR')}`);
    }
  };

  const [customsPercent, setCustomsPercent] = useState('');
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState('');
  const [categoryPricing, setCategoryPricing] = useState<Record<string, { markup?: number; discount?: number }>>({});
  const { opciones: opcionesCategoria, categorias: categoriasOrg } = useOrgCategories(orgForTemplates?.id);
  /**
   * Las filas de "Precios por categoría": las categorías de la organización más
   * las que ya tienen precio guardado.
   *
   * Lo segundo importa: si el comercio borró o renombró una categoría que tenía
   * markup configurado, esa entrada sigue viva en `settings.category_pricing` y
   * se sigue aplicando desde `getCategoryMarkup`. Mostrar sólo las vigentes la
   * dejaría cobrando sin que nadie pueda verla ni sacarla.
   */
  const categoriasDePrecio = useMemo(() => {
    const filas = opcionesCategoria.map(o => ({ slug: o.slug, label: o.label }));
    for (const slug of Object.keys(categoryPricing)) {
      if (!filas.some(f => f.slug === slug)) {
        filas.push({ slug, label: nombreDeCategoria(slug, categoriasOrg) });
      }
    }
    return filas;
  }, [opcionesCategoria, categoriasOrg, categoryPricing]);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [taxIva, setTaxIva] = useState('21');
  const [taxPricesIncludeIva, setTaxPricesIncludeIva] = useState(true);
  const [taxIibb, setTaxIibb] = useState('3.5');
  const [taxMonotributo, setTaxMonotributo] = useState('0');
  const [productCount, setProductCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [businessName, setBusinessName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('¡Gracias por su compra!');
  // Catalog-specific colors
  const [catalogBg, setCatalogBg] = useState('#0E0E1C');
  const [catalogCard, setCatalogCard] = useState('#16163A');
  const [catalogAccent, setCatalogAccent] = useState('#D4A843');
  const [uploading, setUploading] = useState(false);

  // Brand palettes (stored in settings DB)
  const [brandPalettes, setBrandPalettes] = useState<StorefrontPalette[]>([]);
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
  // ── Predefined storefront palettes ───────────────────────────────────────
  const PREDEFINED_PALETTES: StorefrontPalette[] = [
    { id: 'gold',    name: 'Exentry Gold',    bg: '#0E0E1C', card: '#16163A', accent: '#C89A35' },
    { id: 'blue',    name: 'Night Blue',       bg: '#06080F', card: '#0F1629', accent: '#60A5FA' },
    { id: 'purple',  name: 'Violeta Premium',  bg: '#0D0B22', card: '#1A1538', accent: '#C084FC' },
    { id: 'emerald', name: 'Esmeralda',        bg: '#071510', card: '#0D2218', accent: '#34D399' },
    { id: 'crimson', name: 'Carmesí',          bg: '#0F0505', card: '#200B0B', accent: '#F87171' },
    { id: 'amber',   name: 'Ámbar Dark',       bg: '#100A00', card: '#1C1200', accent: '#FCD34D' },
    { id: 'rose',    name: 'Rose Gold',        bg: '#130810', card: '#1F0D18', accent: '#F472B6' },
    { id: 'slate',   name: 'Pizarra',          bg: '#080D14', card: '#111827', accent: '#CBD5E1' },
  ];

  const applyPalette = (p: StorefrontPalette) => {
    setCatalogBg(p.bg);
    setCatalogCard(p.card);
    setCatalogAccent(p.accent);
  };

  const saveCurrentAsPalette = async () => {
    const name = newPaletteName.trim();
    if (!name) return;
    setSavingPalette(true);
    const newPal = {
      id: Date.now().toString(),
      name,
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
  const [origCategoryPricing, setOrigCategoryPricing] = useState('{}');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s: any = await getSettingsDB(user.id);
      setExchangeRate(String(s.exchange_rate));
      setCustomsPercent(String(s.customs_percent));
      setDefaultDiscountPercent(String(s.default_discount_percent));
      setCategoryPricing((s.category_pricing as Record<string, { markup?: number; discount?: number }>) || {});
      setTaxEnabled(!!s.tax_enabled);
      setMfaRequired(!!s.mfa_required);
      setTaxIva(String(s.tax_iva_percent ?? 21));
      setTaxPricesIncludeIva((s as any).tax_prices_include_iva !== false);
      setTaxPricesIncludeIva(s.tax_prices_include_iva !== false);
      setTaxIibb(String(s.tax_iibb_percent ?? 3.5));
      setTaxMonotributo(String(s.tax_monotributo_monthly ?? 0));
      setBusinessName(s.business_name || '');
      setLogoUrl(s.logo_url || '');
      setReceiptFooter(s.receipt_footer || '¡Gracias por su compra!');
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
      setOrigCategoryPricing(JSON.stringify(s.category_pricing || {}));
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
        // ⚠️ Vacío guarda NULL, no 1695. Desde 20260826000030 la columna no
        // tiene DEFAULT y NULL significa "el comercio todavía no cargó la
        // cotización" — un estado real, como el NULL de `products.tax_rate`.
        // Meter un número acá le fijaría al comercio un dólar que nunca eligió.
        exchange_rate: cotizacionDe({ exchange_rate: exchangeRate }),
        customs_percent: num(customsPercent, 15),
        default_discount_percent: num(defaultDiscountPercent, 20),
        category_pricing: categoryPricing,
        tax_enabled: taxEnabled,
        mfa_required: mfaRequired,
        tax_iva_percent: num(taxIva, 21),
        tax_prices_include_iva: taxPricesIncludeIva,
        tax_iibb_percent: num(taxIibb, 3.5),
        tax_monotributo_monthly: num(taxMonotributo, 0),
        business_name: businessName,
        logo_url: logoUrl || null,
        receipt_footer: receiptFooter || null,
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
      // (incluye el markup/descuento por categoría: si cambia el markup, los
      // precios ya cargados quedan viejos hasta recalcular)
      const catPricingChanged = JSON.stringify(categoryPricing) !== origCategoryPricing;
      if (exchangeRate !== origRate || customsPercent !== origCustoms || defaultDiscountPercent !== origDiscount || catPricingChanged) {
        toast(catPricingChanged ? "Cambiaron los precios por categoría" : "Los parámetros financieros cambiaron", {
          description: "¿Recalcular los precios de todos los productos con los nuevos valores?",
          action: { label: "Recalcular", onClick: () => handleRecalculate() },
          duration: 10000,
        });
      }
      setOrigRate(exchangeRate);
      setOrigCustoms(customsPercent);
      setOrigDiscount(defaultDiscountPercent);
      setOrigCategoryPricing(JSON.stringify(categoryPricing));
    } catch (err: any) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!user) return;
    const products = await getProductsDB(user.id);
    // ⚠️ Esto reescribe el precio de **todos** los productos. Hacerlo con una
    // cotización inventada sería cambiar los precios del comercio contra un
    // dólar que no es el suyo, y sin que se entere. Se frena.
    const rate = cotizacionDe({ exchange_rate: exchangeRate });
    if (rate === null) {
      toast.error('Cargá el tipo de cambio antes de recalcular: los precios en pesos salen de ahí.');
      return;
    }
    const customs = parseFloat(customsPercent) || 15;
    // Se usa el markup/descuento de CADA categoría (settings.category_pricing),
    // no un ×2 fijo — así cambiar el markup de una categoría se refleja acá.
    const settingsForCalc = { category_pricing: categoryPricing, default_discount_percent: parseFloat(defaultDiscountPercent) };
    const eligible = products.filter(p => Number(p.cost_usd) > 0);
    const nowMs = Date.now();

    const updates = eligible.map(p => {
      const costUsd = Number(p.cost_usd);
      const markup = getCategoryMarkup(settingsForCalc, p.category);
      const newSalePrice = calcAutoSalePrice(costUsd, customs, rate, markup);

      // Si el producto tiene una oferta vigente, se preserva su % de descuento
      // real (para no pisar una promo activa con el descuento por defecto).
      const oldSale = Number(p.sale_price_ars) || 0;
      const oldDisc = Number(p.discount_price_ars) || 0;
      const hasLiveOffer = p.offer_expires_at ? new Date(p.offer_expires_at).getTime() > nowMs : false;
      const oldDiscPct = oldSale > 0 && oldDisc > 0 && oldDisc < oldSale
        ? (1 - oldDisc / oldSale) * 100
        : null;
      const discPct = hasLiveOffer && oldDiscPct !== null
        ? oldDiscPct
        : getCategoryDiscount(settingsForCalc, p.category);
      const newDiscountPrice = calcAutoDiscountPrice(newSalePrice, discPct);

      const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
        costUsd, customs, newSalePrice, rate
      );
      return {
        id: p.id,
        payload: {
          customs_fee: customsFee, total_cost_usd: totalCostUSD,
          sale_price_ars: newSalePrice,
          discount_price_ars: newDiscountPrice,
          profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
        },
      };
    });

    // En tandas de 25 para no disparar cientos de requests en serie.
    let count = 0;
    for (let i = 0; i < updates.length; i += 25) {
      const chunk = updates.slice(i, i + 25);
      await Promise.all(chunk.map(u => supabase.from('products').update(u.payload).eq('id', u.id)));
      count += chunk.length;
    }
    setProductCount(count);
    toast.success(`${count} productos recalculados con TC $${rate}, pasero ${customs}% y el markup de cada categoría`);
  };

  if (loading) return (
    <div>
      <PageHeader
        icon={Building2}
        eyebrow="Gestiona / Configuración"
        title="Ajustes"
        description="Cargando la configuración de tu organización..."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><FormSkeleton /><FormSkeleton /></div>
    </div>
  );

  return (
    <div className="pb-12">
      <PageHeader
        icon={Building2}
        eyebrow="Gestiona / Configuración"
        title="Ajustes"
        description={`Configuración general de ${businessName}`}
        actions={(
          <div className="workspace-shortcut-hint hidden md:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            <Keyboard className="w-3 h-3" />Ctrl+K búsqueda rápida
          </div>
        )}
      />

      <div className="workspace-settings-layout">
        <div className="workspace-settings-content" data-settings-view={settingsSection}>
          <div className="workspace-settings-tabs-head">
            <div>
              <p className="workspace-settings-tabs-head__eyebrow">Configuración del negocio</p>
              <h2 className="workspace-settings-tabs-head__title">
                {SETTINGS_SECTIONS.find(section => section.id === settingsSection)?.title || "Ajustes"}
              </h2>
              <p className="workspace-settings-tabs-head__description">
                {SETTINGS_SECTIONS.find(section => section.id === settingsSection)?.description}
              </p>
            </div>
            <span className="workspace-settings-tabs-head__status">Cambios guardados por sección</span>
          </div>

          <div className="workspace-settings-tabs" role="tablist" aria-label="Secciones de ajustes">
            {SETTINGS_SECTIONS.map(section => {
              const Icon = section.icon;
              const isActive = settingsSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${section.id}`}
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${section.id}`}
                  className={isActive ? "is-active" : ""}
                  onClick={() => setSettingsSection(section.id)}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>

        <div
          id={`settings-panel-${settingsSection}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${settingsSection}`}
          className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 workspace-settings-grid"
        >
          <div className="space-y-4 md:space-y-6 workspace-settings-column">
            {/* Brand */}
          <div id="settings-brand" className="settings-panel settings-panel--brand bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />Identidad del negocio y la tienda
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
            {/* Catalog colors */}
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <BookMarked className="w-3.5 h-3.5 text-primary" />
                Apariencia de la tienda y el catálogo
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
                Estos colores se aplican sólo a la tienda pública y al catálogo PDF. El panel de Gestión mantiene el sistema visual oficial de Gestiona.
              </p>
            </div>

            {/* Brand palettes */}
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-primary" />
                Paletas de tienda
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
                      {[p.bg, p.card, p.accent].map((c, i) => (
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
                            {[p.bg, p.card, p.accent].map((c, i) => (
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
                Guarda los tres colores de la experiencia de compra como una paleta reutilizable.
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

          {/* ⚠️ Acá y no en Gestiona Finance: esa superficie es gestión de
              gastos corporativos (ADR 001) y no lleva nada más. Lo que cuesta
              cobrar es configuración del comercio, y afecta el margen — por eso
              va en "Finanzas y costos", junto al tipo de cambio. */}
          <div id="settings-costo-cobrar" className="settings-panel settings-panel--finance">
            <CostoDeCobrar orgId={orgForTemplates?.id} />
          </div>

          <div id="settings-cuotas" className="settings-panel settings-panel--finance">
            <PlanesDeCuotas orgId={orgForTemplates?.id} />
          </div>

          {/* Financial params */}
          <div id="settings-finance" className="settings-panel settings-panel--finance bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4 md:space-y-5">
            <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />Parámetros Financieros
            </h2>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-muted-foreground">Tipo de Cambio (USD → ARS)</label>
                <button
                  type="button"
                  onClick={fetchBlueRate}
                  disabled={fetchingRate}
                  className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {fetchingRate ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <TrendingUp className="w-2.5 h-2.5" />}
                  Cotización en vivo
                </button>
              </div>
              <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border" />
              {liveRates && (
                <div className="mt-2 rounded-lg bg-muted/40 border border-border/60 p-2.5 space-y-1.5">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Cotizaciones en vivo · {liveRates.timestamp}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { l: 'Oficial', v: liveRates.oficial, color: 'text-blue-400' },
                      { l: 'Blue', v: liveRates.blue, color: 'text-emerald-400' },
                      { l: 'CCL', v: liveRates.ccl, color: 'text-amber-400' },
                    ].map(r => (
                      <button key={r.l} type="button"
                        className="text-center rounded-lg bg-card border border-border/50 p-2 hover:border-primary/40 transition-colors group"
                        onClick={() => setExchangeRate(String(r.v))}
                        title={`Usar dólar ${r.l}: $${r.v.toLocaleString('es-AR')}`}
                      >
                        <p className={`text-sm font-bold font-mono ${r.color}`}>${r.v.toLocaleString('es-AR')}</p>
                        <p className="text-[9px] text-muted-foreground group-hover:text-primary transition-colors">{r.l} · click p/ usar</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

            {/* ── Precios por categoría ─────────────────────────────── */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Precios por categoría</p>
              <p className="text-[10px] text-muted-foreground mb-3">Markup y descuento propios de cada categoría. Si quedan vacíos, se usa el markup ×2 y el descuento por defecto de arriba.</p>
              {/* Las categorías del comercio, no cuatro slugs de perfumería.
                  Hasta 2026-08-26 esta lista estaba escrita a mano, así que un
                  comercio de otro rubro **no podía configurar el markup de
                  ninguna de sus categorías** — y este es el número con el que
                  se calcula el precio de venta. */}
              {categoriasDePrecio.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Todavía no hay categorías. Creá la primera desde la ficha de un producto
                  y volvé acá para ponerle markup.
                </p>
              ) : (
              <div className="space-y-2">
                {categoriasDePrecio.map(({ slug: cat, label }) => {
                  const cp = categoryPricing[cat] || {};
                  return (
                    <div key={cat} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                      <span className="text-xs font-medium truncate">{label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">markup ×</span>
                        <Input type="number" step="0.1" min="0" value={cp.markup ?? ''} placeholder="2.0"
                          onChange={e => setCategoryPricing(prev => ({ ...prev, [cat]: { ...prev[cat], markup: e.target.value === '' ? undefined : Number(e.target.value) } }))}
                          className="bg-muted border-border h-8 w-16 text-xs" />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">desc %</span>
                        <Input type="number" min="0" max="100" value={cp.discount ?? ''} placeholder={defaultDiscountPercent || '20'}
                          onChange={e => setCategoryPricing(prev => ({ ...prev, [cat]: { ...prev[cat], discount: e.target.value === '' ? undefined : Number(e.target.value) } }))}
                          className="bg-muted border-border h-8 w-16 text-xs" />
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">
                {saving ? 'Guardando...' : 'Guardar Configuración'}
              </Button>
              <Button variant="outline" onClick={handleRecalculate}><RefreshCw className="w-4 h-4 mr-2" />Recalcular Todo</Button>
            </div>
          </div>

          {/* WhatsApp message templates */}
          <div id="settings-whatsapp" className="settings-panel settings-panel--messaging bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
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
          <div id="settings-notifications" className="settings-panel settings-panel--messaging bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
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
          <div id="settings-push" className="settings-panel settings-panel--messaging bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
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
          <div id="settings-email" className="settings-panel settings-panel--messaging bg-card border border-blue-500/20 rounded-[10px] p-4 md:p-6 space-y-4">
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
          <div id="settings-pricing" className="settings-panel settings-panel--pricing bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
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
          <div className="settings-panel settings-panel--pricing bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
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
          <div className="settings-panel settings-panel--pricing bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
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

        <div className="space-y-4 md:space-y-6 workspace-settings-column">
          {/* Subscription */}
          <div id="settings-subscription" className="settings-panel settings-panel--billing"><SubscriptionPanel session={session} /></div>

          {/* Taxes */}
          <div id="settings-taxes" className="settings-panel settings-panel--billing bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Impuestos (Argentina)</h2>
              <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
            </div>
            {taxEnabled ? (
              <div className="space-y-3 pb-12">
                <div><label className="text-sm text-muted-foreground">IVA (%)</label><Input type="number" step="0.1" value={taxIva} onChange={e => setTaxIva(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Ingresos Brutos (%)</label><Input type="number" step="0.1" value={taxIibb} onChange={e => setTaxIibb(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Monotributo mensual (ARS)</label><Input type="number" value={taxMonotributo} onChange={e => setTaxMonotributo(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div className="flex items-start gap-2 bg-muted/40 rounded-lg p-3 border border-border">
                  <input type="checkbox" id="pricesIncludeIva" checked={taxPricesIncludeIva} onChange={e => setTaxPricesIncludeIva(e.target.checked)} className="rounded mt-0.5" />
                  <label htmlFor="pricesIncludeIva" className="text-sm cursor-pointer">
                    Mis precios de venta ya incluyen IVA
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      Lo normal en venta al público. El IVA se extrae del precio final
                      (÷{(1 + (parseFloat(taxIva) || 21) / 100).toFixed(2)}) en vez de sumarse encima.
                    </span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  IVA e Ingresos Brutos se calculan sobre las <strong>ventas</strong> (antes se calculaban
                  sobre la ganancia, lo que los subestimaba). El IVA mostrado es el débito fiscal: el IVA
                  a pagar real descuenta el crédito fiscal de tus compras.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Activá esta opción para descontar impuestos de tus ganancias.</p>
            )}
          </div>

          {/* System info */}
          <div id="settings-system" className="settings-panel settings-panel--system bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
            <h2 className="font-display font-semibold text-[14px] tracking-tight mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Sistema</h2>
            <SystemInfoSection businessName={businessName} productCount={productCount} userEmail={user?.email} />
          </div>

          <div className="settings-panel settings-panel--system bg-card border border-emerald-500/30 rounded-[10px] p-4 md:p-6">
            <h2 className="font-display font-semibold text-[14px] tracking-tight mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />Seguridad
            </h2>
            <p className="text-sm text-muted-foreground">
              Datos protegidos con autenticación, cifrado y auditoría. Cada usuario solo ve sus propios datos. Sistema multi-tenant con aislamiento completo.
            </p>

            <div className="mt-4 pt-4 border-t border-border/60 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-medium">Exigir 2FA a los administradores</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Los usuarios con rol dueño o administrador tendrán que configurar
                  verificación en dos pasos para poder entrar. Cada uno la activa
                  desde Mi Perfil.
                </p>
              </div>
              <Switch checked={mfaRequired} onCheckedChange={setMfaRequired} />
            </div>

            <div className="mt-4 pt-4 border-t border-border/60 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-medium">Forzar actualización</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Si ves algo desactualizado o un botón que no hace lo que debería,
                  puede ser una versión vieja guardada en el navegador. Esto la borra
                  y recarga con la última.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => hardReload()} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Actualizar app
              </Button>
            </div>
          </div>

          <SupportAccessAuditSection />

          <div id="settings-tools" className="settings-panel settings-panel--system space-y-4 md:space-y-6">
          {/* USD Real-time Quote */}
          <USDQuoteSection userId={user!.id} onApply={(rate) => setExchangeRate(String(rate))} />

          {/* Thresholds & Alerts */}
          <ThresholdsSection userId={user!.id} />

          {/* Expense Categories CRUD */}
          <ExpenseCategoriesSection userId={user!.id} />

          {/* Listas de precios — se editan en su propia pantalla.
              Acá había un segundo editor que escribía otras columnas que la
              pantalla del menú: una lista "Mayorista 20%" creada en un lado le
              cobraba el precio completo al mayorista en el otro. Dos editores
              de lo mismo es cómo se llegó a eso. */}
          <Link
            to="/listas-precios"
            className="rounded-[10px] border border-border/50 px-4 py-3 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Listas de Precios</span>
            </div>
            <span className="text-xs text-muted-foreground">Abrir →</span>
          </Link>

          {/* Backup / Export */}
          <BackupExport userId={user!.id} />

          <ManagedBackupsSection />

          {/* Archivos de respaldo heredados: no se generan hasta resolver D8. */}
          <CloudBackupsSection userId={user!.id} />

          {/* Automated Reports & Alerts */}
          <AutomatedReportsSection />

          {/* AFIP Facturación Electrónica */}
          {/* ⚠️ El formulario de AFIP se mudó a /afip el 2026-08-27: estaba
              acá mientras la página que se llama AFIP sólo mostraba el estado
              y mandaba para este lado. Ajustes deja el puntero, no una copia:
              dos formularios para la misma credencial es cómo se termina con
              dos CUIT distintos. */}
          <AfipPuntero />

          {/* Coupons CRUD */}
          <PunteroAPagina
            titulo="Cupones de descuento"
            detalle="Crear, activar y limitar cupones — con mínimo de compra, tope por persona y envío gratis."
            href="/cupones"
            cta="Abrir cupones"
          />

          {/* Sucursales management */}
          <PunteroAPagina
            titulo="Sucursales"
            detalle="Alta, dirección, sucursal principal y stock por ubicación."
            href="/sucursales"
            cta="Abrir sucursales"
          />
          </div>
        </div>
      </div>
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
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
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
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
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
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
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
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-3">
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
  const { activeOrg, activeRole } = useOrg();
  const activeOrgId = activeOrg?.id;
  const [exportingAll, setExportingAll] = useState(false);
  const [exportStep, setExportStep] = useState("");

  const handleFullExport = async () => {
    if (!activeOrgId) return;
    setExportingAll(true);
    setExportStep("");
    try {
      const { downloadOrgExport } = await import("@/lib/orgDataExport");
      const result = await downloadOrgExport(
        activeOrgId,
        activeOrg?.name ?? "",
        p => setExportStep(p.table),
      );
      if (result.failed || result.truncated) {
        toast.warning("Export descargado con observaciones", {
          description: `${result.failed} con error y ${result.truncated} truncada${result.truncated === 1 ? "" : "s"}. Revisá export-manifest.json.`,
        });
      } else {
        toast.success(`Export listo · ${result.exported} tabla${result.exported === 1 ? "" : "s"} con filas`);
      }
    } catch (e: any) {
      toast.error("Falló el export: " + (e?.message ?? "error desconocido"));
    } finally {
      setExportingAll(false);
      setExportStep("");
    }
  };

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
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <h2 className="font-display font-semibold text-[14px] tracking-tight mb-3 flex items-center gap-2">
        <Download className="w-4 h-4 text-primary" />Exportación de datos
      </h2>
      <p className="text-xs text-muted-foreground mb-4">Descargá datos operativos para análisis externo o portabilidad.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={exportExcel} disabled={busy} variant="outline" className="flex-1">
          <FileSpreadsheet className="w-4 h-4 mr-2" />Excel (.xlsx)
        </Button>
        <Button onClick={exportJSON} disabled={busy} variant="outline" className="flex-1">
          <FileJson className="w-4 h-4 mr-2" />JSON
        </Button>
      </div>

      {/* Export portátil — derecho de acceso y portabilidad. */}
      <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
        <p className="text-sm font-medium">Export de la organización (ZIP)</p>
        <p className="text-xs text-muted-foreground">
          Solo el dueño puede pedirlo. Incluye CSVs de datos operativos y un manifiesto
          que declara cada tabla vacía, truncada o que no pudo leerse. Las credenciales
          OAuth, AFIP, API y sesiones quedan excluidas.
        </p>
        <Button
          onClick={handleFullExport}
          disabled={exportingAll || !activeOrgId || activeRole !== "owner"}
          variant="outline"
          className="w-full"
        >
          <Download className="w-4 h-4 mr-2" />
          {exportingAll
            ? (exportStep ? `Exportando ${exportStep}…` : "Preparando…")
            : "Descargar export (.zip)"}
        </Button>
        {activeRole !== "owner" && (
          <p className="text-xs text-muted-foreground">La exportación completa sólo está disponible para el dueño de la organización.</p>
        )}
      </div>
    </div>
  );
}

function ManagedBackupsSection() {
  const { activeOrg, activeRole } = useOrg();
  const [backups, setBackups] = useState<OrganizationBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const canManage = activeRole === "owner" && !!activeOrg?.id;

  const load = useCallback(async () => {
    if (!canManage || !activeOrg?.id) {
      setBackups([]);
      return;
    }
    setLoading(true);
    try {
      setBackups(await listOrganizationBackups(activeOrg.id));
    } catch (error: unknown) {
      setBackups([]);
      toast.error(error instanceof Error ? error.message : "No se pudo leer el historial de respaldos");
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id, canManage]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!activeOrg?.id) return;
    setCreating(true);
    try {
      const result = await createOrganizationBackup(activeOrg.id);
      if (!result.ok) {
        toast.error(result.reason ?? "El respaldo quedó incompleto y no se guardó");
      } else {
        toast.success(`Respaldo listo · ${result.tableCount ?? 0} tablas y ${(result.totalRows ?? 0).toLocaleString("es-AR")} filas`);
      }
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el respaldo");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const download = async (backupId: string) => {
    if (!activeOrg?.id) return;
    setDownloadingId(backupId);
    try {
      const url = await downloadOrganizationBackup(activeOrg.id, backupId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "No se pudo preparar la descarga");
    } finally {
      setDownloadingId(null);
    }
  };

  const verify = async (backupId: string) => {
    if (!activeOrg?.id) return;
    setVerifyingId(backupId);
    try {
      const result = await verifyOrganizationBackup(activeOrg.id, backupId);
      if (result.ok) toast.success("Integridad verificada: hash, cobertura y filas coinciden");
      else toast.error(result.reason ?? "El respaldo no superó la verificación de integridad");
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "No se pudo verificar el respaldo");
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Cloud className="w-4 h-4 text-primary" />Respaldos gestionados
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Snapshot privado semanal por organización · se conservan hasta 8 (56 días).</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || !canManage}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mb-3 flex items-start gap-2 border border-sky-500/25 bg-sky-500/5 p-3 text-xs text-muted-foreground">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        <p>El sistema rechaza snapshots con tablas truncadas o con error. “Verificar” vuelve a leer el archivo privado y controla su hash, cobertura y conteo de filas. La restauración destructiva no se ofrece todavía: requiere un drill aislado antes de tocar producción.</p>
      </div>

      {!canManage ? (
        <p className="text-xs text-muted-foreground">Sólo el dueño de la organización puede gestionar respaldos.</p>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <Button onClick={() => void create()} disabled={creating} className="flex-1 gradient-gold text-primary-foreground">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" />}
              {creating ? "Generando snapshot…" : "Generar ahora"}
            </Button>
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Cargando historial…</p>
          ) : backups.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Todavía no hay snapshots gestionados.</p>
          ) : (
            <div className="space-y-2 max-h-[330px] overflow-y-auto">
              {backups.map(backup => {
                const verified = backup.last_verification_status === "passed";
                const failed = backup.status === "failed" || backup.last_verification_status === "failed";
                return (
                  <div key={backup.id} className="rounded-lg border border-border/60 p-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium flex items-center gap-1.5">
                          {verified ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : failed ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <Cloud className="h-3.5 w-3.5 text-muted-foreground" />}
                          {backupTrustLabel(backup)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {backup.trigger === "scheduled" ? "Semanal" : "Manual"} · {new Date(backup.created_at).toLocaleString("es-AR")} · {backup.table_count} tablas · {backup.total_rows.toLocaleString("es-AR")} filas · {formatBackupBytes(backup.size_bytes)}
                        </p>
                        {backup.last_verified_at && <p className="text-[10px] text-muted-foreground">Verificado: {new Date(backup.last_verified_at).toLocaleString("es-AR")}</p>}
                        {backup.failure_reason && <p className="mt-1 text-[10px] text-destructive">{backup.failure_reason}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {backup.status === "completed" && <>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void verify(backup.id)} disabled={verifyingId === backup.id} title="Verificar integridad">
                            {verifyingId === backup.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void download(backup.id)} disabled={downloadingId === backup.id} title="Descargar snapshot">
                            {downloadingId === backup.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          </Button>
                        </>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CloudBackupsSection({ userId }: { userId: string }) {
  const [files, setFiles] = useState<Array<{ name: string; created_at?: string; size?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.storage.from('backups').list(userId, {
        limit: 100, sortBy: { column: 'created_at', order: 'desc' },
      });
      if (error) throw error;
      setFiles((data || []).filter(f => f.name?.endsWith('.json')).map(f => ({
        name: f.name, created_at: f.created_at, size: (f.metadata as Record<string, unknown>)?.size as number | undefined,
      })));
    } catch (e: unknown) {
      setFiles([]);
      setLoadError(e instanceof Error ? e.message : 'No se pudieron leer los archivos heredados.');
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

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <Cloud className="w-4 h-4 text-primary" />Archivos de respaldo heredados
        </h2>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>
      <div className="mb-3 flex items-start gap-2 border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <p>Las copias gestionadas están deshabilitadas: el mecanismo anterior era por usuario, no por organización, y no tenía restauración probada. Descargá el export completo de arriba para una copia portable; D8 sigue pendiente.</p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : loadError ? (
        <p className="text-xs text-destructive">No se pudieron leer los archivos heredados: {loadError}</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No hay archivos heredados para esta cuenta.</p>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {files.map(f => (
            <div key={f.name} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-mono truncate">{f.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  Archivo legacy · {f.created_at ? new Date(f.created_at).toLocaleString('es-AR') : '—'}
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

// ===== Automated Reports =====
function AutomatedReportsSection() {
  const { activeOrg } = useOrg();
  const [sendingDigest, setSendingDigest] = useState(false);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [lastSent, setLastSent] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("gestiona.reports.lastSent") || "{}"); } catch { return {}; }
  });

  const trigger = async (fn: string, key: string, label: string, setter: (v: boolean) => void) => {
    setter(true);
    try {
      const { error } = await supabase.functions.invoke(fn);
      if (error) throw error;
      const now = new Date().toLocaleString("es-AR");
      const next = { ...lastSent, [key]: now };
      setLastSent(next);
      localStorage.setItem("gestiona.reports.lastSent", JSON.stringify(next));
      toast.success(`${label} enviado/ejecutado`);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setter(false);
    }
  };

  const JOBS = [
    {
      key: "weekly_digest",
      fn: "weekly-performance-digest",
      icon: Mail,
      label: "Resumen semanal",
      desc: "Email con KPIs de la semana pasada (ingresos, ganancia, ventas, clientes). Se ejecuta automáticamente cada lunes 9:00 UTC.",
      schedule: "Lunes 9:00 UTC",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      setter: setSendingDigest,
      sending: sendingDigest,
    },
    {
      key: "daily_kpi",
      fn: "daily-kpi-alert",
      icon: Bell,
      label: "Alerta KPI diaria",
      desc: "Notificación con ventas del día, alertas de métricas bajo umbral. Se ejecuta automáticamente cada noche.",
      schedule: "Noche (automático)",
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      setter: setSendingAlert,
      sending: sendingAlert,
    },
    {
      key: "stock_alerts",
      fn: "check-stock-alerts",
      icon: Package,
      label: "Alertas de stock",
      desc: "Revisa productos por debajo del umbral y genera notificaciones de stock bajo.",
      schedule: "A demanda",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      setter: setSendingAlert,
      sending: sendingAlert,
    },
    {
      key: "overdue_debts",
      fn: "check-overdue-debts",
      icon: AlertTriangle,
      label: "Deudas vencidas",
      desc: "Revisa deudas con fecha de vencimiento pasada y genera notificaciones de alerta.",
      schedule: "A demanda",
      color: "text-red-400",
      bg: "bg-red-500/10",
      setter: setSendingAlert,
      sending: sendingAlert,
    },
  ] as const;

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />Reportes y Alertas Automatizados
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Ejecutá manualmente cualquier tarea automática o verificá su última ejecución.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {JOBS.map(job => {
          const Icon = job.icon;
          return (
            <div key={job.key} className={`p-3.5 rounded-xl border border-border/40 ${job.bg}`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/40`}>
                  <Icon className={`w-4 h-4 ${job.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{job.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{job.desc}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-mono bg-muted/40 px-2 py-0.5 rounded text-muted-foreground">{job.schedule}</span>
                    {lastSent[job.key] && (
                      <span className="text-[10px] text-muted-foreground/60">Última: {lastSent[job.key]}</span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-3 h-7 text-xs gap-1.5"
                disabled={job.sending}
                onClick={() => trigger(job.fn, job.key, job.label, job.setter)}
              >
                {job.sending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3" />
                )}
                {job.sending ? "Ejecutando…" : "Ejecutar ahora"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Ajustes apunta, no copia.
 *
 * ⚠️ Tres secciones de esta página eran formularios paralelos a una página
 * que ya existía, y **el de Ajustes siempre era el pobre**. El de cupones no
 * podía setear `min_order_value`, `max_uses_per_customer`, `free_shipping` ni
 * `free_shipping_max_ars`: un cupón creado desde acá salía sin mínimo de
 * compra, sin tope por persona y sin envío gratis, y el comercio no tenía
 * forma de saber por qué su cupón se comportaba distinto.
 *
 * Dos formularios para el mismo registro terminan en dos verdades. Ajustes
 * deja el camino, la página hace el trabajo.
 */
function PunteroAPagina({ titulo, detalle, href, cta }: {
  titulo: string; detalle: string; href: string; cta: string;
}) {
  return (
    <div className="rounded-[10px] border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{titulo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{detalle}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={href}>{cta}</a>
        </Button>
      </div>
    </div>
  );
}

function AfipPuntero() {
  return (
    <div className="rounded-[10px] border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Facturación electrónica (AFIP / ARCA)</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Los datos fiscales, el punto de venta y la prueba de conexión viven en su propia página.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/afip">Abrir AFIP</a>
        </Button>
      </div>
    </div>
  );
}

