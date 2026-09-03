import { Sparkles, Mail, Database, MessageSquare, CreditCard, Info } from "lucide-react";

/**
 * Shows the services that come bundled with the Nerqia platform.
 * These use platform-level API keys configured by the platform owner —
 * the org doesn't need to do anything.
 */
export default function PlatformServicesPanel() {
  const services = [
    {
      icon: Sparkles,
      label: "Inteligencia Artificial",
      description: "Chat, predicciones, descripciones automáticas",
      color: "text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      icon: Mail,
      label: "Emails transaccionales",
      description: "Facturas por email, recuperación de contraseña",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: Mail,
      label: "Campañas de email",
      description: "Email marketing a tus clientes",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Database,
      label: "Backups automáticos",
      description: "Respaldo semanal de toda tu información",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      icon: CreditCard,
      label: "Cobros de suscripción",
      description: "Tu plan de Nerqia se cobra por Stripe",
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    {
      icon: MessageSquare,
      label: "WhatsApp en automatizaciones",
      description: "Mensajes automáticos en flujos (si aplica a tu plan)",
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
  ];

  return (
    <div className="bg-gradient-to-br from-primary/5 to-transparent border border-primary/20 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-primary/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Incluido en tu plan</span>
        <span className="text-xs text-muted-foreground ml-auto">Sin configuración necesaria</span>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start gap-2 mb-4 text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary/70" />
          <p>
            Estos servicios funcionan automáticamente. <strong className="text-foreground">No necesitás contratar nada ni configurar API keys</strong> — vienen como parte de Nerqia.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {services.map((s) => (
            <div key={s.label} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/10 border border-border/40">
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-tight">{s.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.description}</p>
              </div>
              <span className="text-[10px] text-emerald-400 font-medium shrink-0">✓ Activo</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
