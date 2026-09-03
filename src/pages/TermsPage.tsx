import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import BrandLogo from '@/components/shared/BrandLogo';

const LAST_UPDATED = '6 de mayo de 2026';
const COMPANY = 'Nerqia';
const EMAIL = 'legal@nerqia.app';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 sticky top-0 backdrop-blur-md bg-background/70 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> <BrandLogo markClassName="h-5 w-5" nameClassName="text-sm" />
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-14">
        <div className="flex items-center gap-3 mb-2">
          <FileText className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-display font-bold">Términos y Condiciones</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1 mb-10">Última actualización: {LAST_UPDATED}</p>

        <Section title="1. Aceptación de los términos">
          <p>
            Al registrarte o usar {COMPANY}, aceptás estos Términos y Condiciones en su totalidad.
            Si no estás de acuerdo, no debés usar el servicio. Estos términos forman un acuerdo vinculante
            entre vos y {COMPANY}.
          </p>
        </Section>

        <Section title="2. Descripción del servicio">
          <p>
            {COMPANY} es una plataforma SaaS (Software as a Service) de gestión comercial que permite administrar
            ventas, stock, clientes, gastos, presupuestos, caja, proveedores e integraciones con servicios de terceros.
          </p>
          <p>
            El servicio se presta "tal cual está" (as-is). Nos reservamos el derecho de modificar, suspender o
            discontinuar funcionalidades con previo aviso.
          </p>
        </Section>

        <Section title="3. Cuentas y organizaciones">
          <ul>
            <li>Sos responsable de mantener la confidencialidad de tus credenciales.</li>
            <li>Sólo podés usar el servicio para fines lícitos y comerciales legítimos.</li>
            <li>Una cuenta puede pertenecer a varias organizaciones. Cada organización tiene su propio espacio de datos.</li>
            <li>No podés transferir tu cuenta a un tercero sin nuestro consentimiento escrito.</li>
          </ul>
        </Section>

        <Section title="4. Planes y pagos">
          <ul>
            <li>Los precios están en dólares estadounidenses (USD) y se facturan mensual o anualmente según el plan elegido.</li>
            <li>Los pagos se procesan a través de Stripe. Al suscribirte aceptás sus términos de servicio.</li>
            <li>El período de prueba (trial) dura 14 días y no requiere tarjeta de crédito.</li>
            <li>No realizamos reembolsos por períodos ya pagados, salvo error de nuestro lado o incumplimiento grave del servicio.</li>
            <li>Podés cancelar en cualquier momento. El acceso continúa hasta el final del período pagado.</li>
          </ul>
        </Section>

        <Section title="5. Uso aceptable">
          <p>Está prohibido usar {COMPANY} para:</p>
          <ul>
            <li>Actividades ilegales o fraudulentas.</li>
            <li>Enviar spam o comunicaciones no solicitadas.</li>
            <li>Intentar acceder a datos de otras organizaciones.</li>
            <li>Realizar ingeniería inversa, copiar o redistribuir el software.</li>
            <li>Sobrecargar la infraestructura de forma deliberada.</li>
          </ul>
          <p>Nos reservamos el derecho de suspender cuentas que violen estas condiciones sin previo aviso.</p>
        </Section>

        <Section title="6. Propiedad de los datos">
          <p>
            <strong>Tus datos son tuyos.</strong> {COMPANY} no reivindica propiedad sobre los datos que cargás en la plataforma.
            Podés exportarlos en cualquier momento desde la sección Reportes.
          </p>
          <p>
            Al usar el servicio, nos otorgás una licencia limitada para procesar tus datos con el único fin de
            brindarte el servicio.
          </p>
        </Section>

        <Section title="7. Propiedad intelectual">
          <p>
            El software, diseño, marca y contenidos de {COMPANY} son propiedad exclusiva de sus desarrolladores.
            No se otorga ninguna licencia sobre el software fuera del uso personal del servicio.
          </p>
        </Section>

        <Section title="8. Disponibilidad y SLA">
          <p>
            Apuntamos a una disponibilidad del 99.5% mensual. Pueden ocurrir interrupciones por mantenimiento
            programado (notificado con anticipación) o causas de fuerza mayor.
          </p>
          <p>
            No garantizamos disponibilidad ininterrumpida. Las interrupciones no dan derecho a reembolso
            salvo que superen 48 horas continuas en un mes.
          </p>
        </Section>

        <Section title="9. Limitación de responsabilidad">
          <p>
            {COMPANY} no será responsable por pérdidas de datos derivadas del mal uso de la plataforma,
            decisiones comerciales basadas en información del sistema, ni por daños indirectos o consecuentes.
          </p>
          <p>
            En ningún caso nuestra responsabilidad total superará el monto pagado por vos en los 3 meses
            anteriores al incidente.
          </p>
        </Section>

        <Section title="10. Integrations y servicios de terceros">
          <p>
            {COMPANY} se integra con servicios externos (Tiendanube, Mercado Pago, Stripe, AFIP, etc.).
            No somos responsables por la disponibilidad, precisión o comportamiento de esos servicios.
            El uso de cada integración está sujeto a los términos del proveedor correspondiente.
          </p>
        </Section>

        <Section title="11. Modificaciones a los términos">
          <p>
            Podemos modificar estos términos con 15 días de anticipación, notificándote por email.
            El uso continuo del servicio después de esa fecha implica la aceptación de los nuevos términos.
          </p>
        </Section>

        <Section title="12. Terminación">
          <p>
            Podés cerrar tu cuenta en cualquier momento desde Configuración. También podemos suspender o terminar
            tu acceso por violación de estos términos, con o sin previo aviso según la gravedad.
          </p>
        </Section>

        <Section title="13. Ley aplicable">
          <p>
            Estos términos se rigen por las leyes de la <strong>República Argentina</strong>.
            Cualquier controversia se dirimirá ante los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires,
            renunciando a cualquier otro fuero que pudiera corresponder.
          </p>
        </Section>

        <Section title="14. Contacto">
          <p>
            Para consultas legales o avisos formales, escribinos a{' '}
            <a href={`mailto:${EMAIL}`} className="text-primary underline">{EMAIL}</a>.
          </p>
        </Section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <div className="flex justify-center gap-4">
          <Link to="/privacidad" className="hover:text-foreground">Privacidad</Link>
          <Link to="/terminos" className="hover:text-foreground">Términos</Link>
          <Link to="/" className="hover:text-foreground">Volver al panel</Link>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-3">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
