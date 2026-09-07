# Plan de Rediseño Total de UI — Todas las Plataformas

**Fecha:** 2026-09-07
**Estado:** PLANIFICACIÓN
**Foco:** Rediseño total de UI en TODAS las páginas y plataformas
**Total páginas:** 108

---

## 📊 Inventario de Páginas por Plataforma

### COMMERCE (TIENDAS ONLINE) — 15 páginas
1. EcommerceStorePage.tsx
2. CatalogPage.tsx
3. ProductsPage.tsx
4. ProductBundlesPage.tsx
5. PriceListsPage.tsx
6. PricingPage.tsx
7. PromotionsPage.tsx
8. CouponsPage.tsx
9. StoreOrdersPage.tsx
10. AnalyticsPage.tsx
11. MarketingPage.tsx
12. EmailCampaignsPage.tsx
13. WhatsAppCampaignsPage.tsx
14. ReferralsPage.tsx
15. CommerceAIPage.tsx (NUEVO)
16. DynamicPricingPage.tsx (NUEVO)

### BUSINESS (OPERACIONES) — 18 páginas
1. POSPage.tsx
2. SalesPage.tsx
3. CashSessionPage.tsx
4. CustomersPage.tsx
5. SuppliersPage.tsx (ProveedoresPage.tsx)
6. PurchasesPage.tsx
7. PurchaseOrdersPage.tsx
8. InventoryPlanningPage.tsx
9. InventoryTransfersPage.tsx
10. InventoryValuationPage.tsx
11. KardexPage.tsx
12. BatchLotPage.tsx
13. LocationsPage.tsx
14. CalendarPage.tsx
15. TasksPage.tsx
16. DeliveryTrackingPage.tsx
17. DevolucionesPage.tsx
18. BusinessAIPage.tsx (NUEVO)

### FINANCE (CONTROL DE GASTOS) — 12 páginas
1. DebtsPage.tsx
2. InvoicesPage.tsx
3. FinancialMovementsPage.tsx
4. WalletPage.tsx
5. BankReconciliationPage.tsx
6. CashFlowPage.tsx
7. ChequesPage.tsx
8. CuotasPage.tsx
9. ExpensesPage.tsx
10. PresupuestosPage.tsx
11. FinanceDocumentsPage.tsx
12. FinanceAIPage.tsx (NUEVO)

### PLATFORM (CONTROL PLANE) — 10 páginas
1. PlatformAdminPage.tsx
2. PlatformMerchantPage.tsx
3. PlatformMetricsPage.tsx
4. PlatformOperationsPage.tsx
5. PlatformBusinessPage.tsx
6. PlatformCommissionsPage.tsx
7. PlatformIntegrationsPage.tsx
8. PlatformAfipPage.tsx
9. PlatformAnnouncementsPage.tsx
10. PlatformMessagingPage.tsx

### MARKETING & GROWTH — 8 páginas
1. InfluencersPage.tsx
2. InfluencerPortalPage.tsx
3. InfluencerExchangesPage.tsx
4. AffiliateProgramPage.tsx
5. LoyaltyAdvancedPage.tsx
6. PaymentLinksPage.tsx
7. PublicCatalogPage.tsx
8. MultiCurrencyPage.tsx

### REPORTS & ANALYTICS — 5 páginas
1. ReportsPage.tsx
2. IntelligencePage.tsx
3. PLDashboardPage.tsx
4. DataQualityPage.tsx
5. LibroPage.tsx

### SYSTEM & SETTINGS — 18 páginas
1. AdminPage.tsx
2. SettingsPage.tsx
3. TeamPage.tsx
4. ProfilePage.tsx
5. IntegrationsPage.tsx
6. SmartAlertsPage.tsx
7. SupportPage.tsx
8. OnboardingPage.tsx
9. AFIPPage.tsx
10. TaxManagementPage.tsx
11. SubscriptionsPage.tsx
12. MiPlanPage.tsx
13. SellerCommissionsPage.tsx
14. TasksPage.tsx (duplicado, verificar)
15. CustomDomainStorefrontPage.tsx
16. ServiceStatusPage.tsx

### PUBLIC & STOREFRONT — 8 páginas
1. LandingPage.tsx
2. AuthPage.tsx
3. ResetPasswordPage.tsx
4. PrivacyPage.tsx
5. TermsPage.tsx
6. StorefrontPage.tsx
7. PublicPaymentPage.tsx
8. InvitationAcceptPage.tsx

---

## 🎯 Estrategia de Rediseño

### Principios de Diseño
1. **Consistencia visual** — Mismo diseño en todas las páginas
2. **Foco en ATM** — Priorizar páginas que impactan Active Transacting Merchants
3. **Mobile-first** — Responsive design nativo
4. **Accessibility** — Keyboard navigation, screen readers
5. **Performance** — Fast load times, minimal bundle size

### Elementos de Diseño Consistentes
1. **PageHeader** — Header estandarizado para todas las páginas
2. **KPICard** — KPIs con diseño consistente
3. **DataTable** — Tablas con diseño estandarizado
4. **EmptyState** — Estados vacíos con diseño consistente
5. **LoadingState** — Estados de carga con diseño consistente
6. **ErrorState** — Estados de error con diseño consistente

---

## 📋 Plan de Ejecución por Fases

### FASE 1: COMMERCE (TIENDAS ONLINE) — Prioridad ALTA
**Razón:** Impacto directo en ATM (Active Transacting Merchants)

**Páginas a rediseñar:**
1. EcommerceStorePage.tsx
2. CatalogPage.tsx
3. ProductsPage.tsx
4. StoreOrdersPage.tsx
5. AnalyticsPage.tsx
6. MarketingPage.tsx
7. EcommerceStorePage.tsx
8. PromotionsPage.tsx
9. CouponsPage.tsx
10. ProductBundlesPage.tsx
11. PriceListsPage.tsx
12. PricingPage.tsx
13. EmailCampaignsPage.tsx
14. WhatsAppCampaignsPage.tsx
15. ReferralsPage.tsx

**Componentes a crear:**
- CommercePageHeader (ya existe CommerceHeader)
- CommerceKPICard
- CommerceDataTable
- CommerceEmptyState

### FASE 2: FINANCE — Prioridad ALTA
**Razón:** Protege margen, cobro, comisión, costo e IVA

**Páginas a rediseñar:**
1. DebtsPage.tsx
2. InvoicesPage.tsx
3. FinancialMovementsPage.tsx
4. WalletPage.tsx
5. BankReconciliationPage.tsx
6. CashFlowPage.tsx
7. ChequesPage.tsx
8. CuotasPage.tsx
9. ExpensesPage.tsx
10. PresupuestosPage.tsx
11. FinanceDocumentsPage.tsx

**Componentes a crear:**
- FinancePageHeader (ya existe FinanceHeader)
- FinanceKPICard
- FinanceDataTable
- FinanceEmptyState

### FASE 3: BUSINESS — Prioridad MEDIA
**Razón:** Soporta operaciones de commerce

**Páginas a rediseñar:**
1. POSPage.tsx
2. SalesPage.tsx
3. CustomersPage.tsx
4. PurchasesPage.tsx
5. InventoryPlanningPage.tsx
6. InventoryTransfersPage.tsx
7. InventoryValuationPage.tsx
8. KardexPage.tsx
9. LocationsPage.tsx
10. CalendarPage.tsx
11. TasksPage.tsx
12. DeliveryTrackingPage.tsx
13. DevolucionesPage.tsx
14. SuppliersPage.tsx
15. PurchaseOrdersPage.tsx
16. CashSessionPage.tsx
17. BatchLotPage.tsx

**Componentes a crear:**
- BusinessPageHeader (ya existe BusinessHeader)
- BusinessKPICard
- BusinessDataTable
- BusinessEmptyState

### FASE 4: PLATFORM — Prioridad MEDIA
**Razón:** Control plane para Nerqia

**Páginas a rediseñar:**
1. PlatformAdminPage.tsx
2. PlatformMerchantPage.tsx
3. PlatformMetricsPage.tsx
4. PlatformOperationsPage.tsx
5. PlatformBusinessPage.tsx
6. PlatformCommissionsPage.tsx
7. PlatformIntegrationsPage.tsx
8. PlatformAfipPage.tsx
9. PlatformAnnouncementsPage.tsx
10. PlatformMessagingPage.tsx

**Componentes a crear:**
- PlatformPageHeader (ya existe PlatformHeader)
- PlatformKPICard
- PlatformDataTable
- PlatformEmptyState

### FASE 5: MARKETING & GROWTH — Prioridad BAJA
**Razón:** Crecimiento secundario a ATM

**Páginas a rediseñar:**
1. InfluencersPage.tsx
2. InfluencerPortalPage.tsx
3. InfluencerExchangesPage.tsx
4. AffiliateProgramPage.tsx
5. LoyaltyAdvancedPage.tsx
6. PaymentLinksPage.tsx
7. PublicCatalogPage.tsx
8. MultiCurrencyPage.tsx

### FASE 6: REPORTS & ANALYTICS — Prioridad BAJA
**Razón:** Analytics secundario a ATM

**Páginas a rediseñar:**
1. ReportsPage.tsx
2. IntelligencePage.tsx
3. PLDashboardPage.tsx
4. DataQualityPage.tsx
5. LibroPage.tsx

### FASE 7: SYSTEM & SETTINGS — Prioridad BAJA
**Razón:** Configuración secundaria a ATM

**Páginas a rediseñar:**
1. AdminPage.tsx
2. SettingsPage.tsx
3. TeamPage.tsx
4. ProfilePage.tsx
5. IntegrationsPage.tsx
6. SmartAlertsPage.tsx
7. SupportPage.tsx
8. OnboardingPage.tsx
9. AFIPPage.tsx
10. TaxManagementPage.tsx
11. SubscriptionsPage.tsx
12. MiPlanPage.tsx
13. SellerCommissionsPage.tsx
14. CustomDomainStorefrontPage.tsx
15. ServiceStatusPage.tsx

### FASE 8: PUBLIC & STOREFRONT — Prioridad MEDIA
**Razón:** Storefront ya tiene mejoras recientes

**Páginas a rediseñar:**
1. LandingPage.tsx
2. AuthPage.tsx
3. ResetPasswordPage.tsx
4. PrivacyPage.tsx
5. TermsPage.tsx
6. StorefrontPage.tsx (ya tiene mejoras)
7. PublicPaymentPage.tsx
8. InvitationAcceptPage.tsx

---

## 🎨 Sistema de Diseño Consistente

### 1. PageHeader Estandarizado
```tsx
interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  tabs?: Tab[];
  breadcrumbs?: Breadcrumb[];
}
```

### 2. KPICard Estandarizado
```tsx
interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

### 3. DataTable Estandarizado
```tsx
interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  paginatable?: boolean;
  bulkActions?: BulkAction<T>[];
}
```

### 4. EmptyState Estandarizado
```tsx
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

---

## 📊 Métricas de Éxito

### Conclusión del Rediseño
- 100% de páginas con diseño consistente
- 100% de páginas mobile-first
- 100% de páginas accesibles
- 100% de páginas con loading/error/empty states

### Impacto Esperado
- +30% conversión en Commerce
- +20% eficiencia en Finance
- +15% productividad en Business
- +10% adopción en Platform

---

## 🚀 Próximos Pasos

1. ✅ Crear componentes base (PageHeader, KPICard, DataTable, EmptyState)
2. ✅ Rediseñar FASE 1: COMMERCE (15 páginas)
3. ✅ Rediseñar FASE 2: FINANCE (12 páginas)
4. ✅ Rediseñar FASE 3: BUSINESS (18 páginas)
5. ✅ Rediseñar FASE 4: PLATFORM (10 páginas)
6. ✅ Rediseñar FASE 5-8: Resto de páginas
7. ✅ Typecheck, build, tests
8. ✅ Commit y push

---

## 📝 Nota

**Este es un proyecto masivo de 108 páginas.** La prioridad es consistencia visual y ATM. No se debe rediseñar todo de una vez, sino por fases estratégicas.

**Estimación:** 8-12 horas de trabajo completo si se hace todo de una vez, pero se recomienda hacer por fases de 2-3 horas cada una.
