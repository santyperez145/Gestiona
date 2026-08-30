import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import BrandLogo from '@/components/shared/BrandLogo';

const LAST_UPDATED = '30 de agosto de 2026';
const COMPANY = 'Gestiona';
const EMAIL = 'privacidad@gestiona.app';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 sticky top-0 backdrop-blur-md bg-background/70 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> <BrandLogo markClassName="h-5 w-5" nameClassName="text-sm" />
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-14 prose prose-invert prose-sm max-w-none">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-display font-bold m-0">Política de Privacidad</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1 mb-10">Última actualización: {LAST_UPDATED}</p>

        <Section title="1. Quiénes somos">
          <p>
            {COMPANY} es un sistema de gestión comercial para pequeñas y medianas empresas. Al usar nuestra plataforma,
            aceptás el tratamiento de tus datos según esta política.
          </p>
        </Section>

        <Section title="2. Qué datos recopilamos">
          <ul>
            <li><strong>Datos de cuenta:</strong> nombre, email y contraseña (hasheada) que ingresás al registrarte.</li>
            <li><strong>Datos de negocio:</strong> productos, ventas, clientes, gastos y cualquier información que cargues en la plataforma.</li>
            <li><strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo, navegador y registros de actividad (logs) para diagnóstico y seguridad.</li>
            <li><strong>Datos de pago:</strong> gestionados íntegramente por Stripe. {COMPANY} nunca almacena números de tarjeta.</li>
          </ul>
        </Section>

        <Section title="3. Para qué usamos tus datos">
          <ul>
            <li>Brindarte el servicio de gestión comercial.</li>
            <li>Enviarte notificaciones y alertas del sistema (stock bajo, deudas vencidas, etc.).</li>
            <li>Mejorar la plataforma y detectar errores.</li>
            <li>Cumplir con obligaciones legales.</li>
          </ul>
          <p>No vendemos ni compartimos tus datos con terceros para fines publicitarios.</p>
        </Section>

        <Section title="4. Base legal del tratamiento">
          <p>
            El tratamiento se realiza bajo tu consentimiento (al aceptar estos términos al registrarte) y en cumplimiento
            de la <strong>Ley 25.326 de Protección de Datos Personales</strong> de la República Argentina.
          </p>
        </Section>

        <Section title="5. Almacenamiento y seguridad">
          <p>
            Tus datos se almacenan en servidores de <strong>Supabase</strong> con cifrado en tránsito (HTTPS/TLS) y en
            reposo. Aplicamos políticas de acceso mínimo (RLS) para que cada organización sólo vea sus propios datos y
            ofrecemos exportación portable de la información accesible por la organización.
          </p>
        </Section>

        <Section title="6. Con quiénes compartimos datos">
          <p>Sólo compartimos datos con proveedores necesarios para operar el servicio:</p>
          <ul>
            <li><strong>Supabase</strong> — base de datos e infraestructura.</li>
            <li><strong>Stripe</strong> — procesamiento de pagos.</li>
            <li><strong>Resend</strong> — envío de emails transaccionales.</li>
            <li>
              <strong>Anthropic</strong> — funciones opcionales de inteligencia artificial. Sólo recibe el contenido que
              elegís procesar al ejecutar una de esas funciones; puede incluir datos del negocio o un documento y no se
              anonimiza automáticamente.
            </li>
            <li><strong>Sentry</strong> — monitoreo de errores (sin datos personales sensibles).</li>
          </ul>
          <p>
            Podés no usar las funciones de inteligencia artificial y completar esas tareas manualmente. Cuando las usás,
            el contenido se envía para responder esa solicitud concreta bajo los términos y medidas del proveedor.
          </p>
        </Section>

        <Section title="7. Cookies">
          <p>
            Usamos cookies estrictamente necesarias para mantener tu sesión. No usamos cookies de seguimiento
            ni publicidad de terceros. Podés borrar las cookies desde tu navegador en cualquier momento,
            lo que cerrará tu sesión.
          </p>
        </Section>

        <Section title="8. Tus derechos">
          <p>Tenés derecho a:</p>
          <ul>
            <li><strong>Acceder</strong> a los datos que tenemos sobre vos.</li>
            <li><strong>Rectificar</strong> datos incorrectos.</li>
            <li><strong>Exportar</strong> tus datos en formato CSV desde la sección Reportes.</li>
            <li><strong>Eliminar</strong> tu cuenta y todos tus datos. Escribinos a {EMAIL}.</li>
            <li><strong>Oponerte</strong> al tratamiento en casos específicos.</li>
          </ul>
        </Section>

        <Section title="9. Retención de datos">
          <p>
            Conservamos tus datos mientras tu cuenta esté activa. Si cancelás tu suscripción, los datos se mantienen
            por 30 días para permitir la recuperación. Después de ese período, se eliminan de forma permanente,
            salvo obligación legal de conservarlos.
          </p>
        </Section>

        <Section title="10. Menores de edad">
          <p>
            {COMPANY} no está dirigido a menores de 18 años. No recopilamos datos de menores de forma deliberada.
          </p>
        </Section>

        <Section title="11. Cambios a esta política">
          <p>
            Podemos actualizar esta política. Te notificaremos por email con al menos 15 días de anticipación ante
            cambios sustanciales. El uso continuo del servicio después de esa fecha implica la aceptación de los cambios.
          </p>
        </Section>

        <Section title="12. Contacto">
          <p>
            Para ejercer tus derechos o consultas sobre privacidad, escribinos a{' '}
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
      <h2 className="text-base font-semibold mb-3 text-foreground">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
