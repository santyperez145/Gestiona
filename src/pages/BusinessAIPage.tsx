/**
 * BusinessAIPage — Página de IA para BUSINESS
 *
 * Ruta: /ia-business
 * Componente principal: BusinessAIInsights
 */
import BusinessAIInsights from "@/components/business/BusinessAIInsights";

export default function BusinessAIPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <BusinessAIInsights />
    </div>
  );
}
