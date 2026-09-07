/**
 * FinanceAIPage — Página de IA para FINANCE
 *
 * Ruta: /ia-finance
 * Componente principal: FinanceDashboard (con IA Insights integrados)
 */
import FinanceDashboard from "@/components/finance/FinanceDashboard";

export default function FinanceAIPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <FinanceDashboard />
    </div>
  );
}
