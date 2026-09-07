/**
 * DynamicPricingPage — Página de Pricing Dinámico
 *
 * Ruta: /pricing-dinamico
 * Componente principal: DynamicPricing
 */
import DynamicPricing from "@/components/commerce/DynamicPricing";

export default function DynamicPricingPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <DynamicPricing />
    </div>
  );
}
