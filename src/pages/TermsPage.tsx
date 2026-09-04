import { FileText } from "lucide-react";
import {
  LegalDocumentLayout,
  LegalIdentityNotice,
  LegalSection,
} from "@/components/legal/LegalDocumentLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PLATFORM_LEGAL } from "@/lib/platformLegal";

const { brand, legalEmail, termsVersion, updatedLabel } = PLATFORM_LEGAL;

export default function TermsPage() {
  usePageTitle("Términos");

  return (
    <LegalDocumentLayout
      title="Términos de uso"
      updatedLabel={updatedLabel}
      version={termsVersion}
      icon={FileText}
    >
      <LegalIdentityNotice />

      <LegalSection title="1. Alcance y aceptación">
        <p>
          Estos términos regulan el acceso y uso de {brand}. Al crear una cuenta o aceptar una nueva versión,
          confirmás que pudiste leer también la Política de Privacidad y que actuás con capacidad suficiente para
          representar a la organización que administrás.
        </p>
        <p>
          La versión aceptada y la fecha deben quedar registradas por la plataforma. El alta no reemplaza los
          contratos, anexos de tratamiento de datos ni condiciones particulares que correspondan a un plan.
        </p>
      </LegalSection>

      <LegalSection title="2. Qué presta Nerqia">
        <p>
          {brand} es un sistema operativo para comercios omnicanal: conecta productos, inventario, ventas, clientes,
          caja, finanzas, tienda online e integraciones alrededor de un mismo núcleo de negocio.
        </p>
        <p>
          Algunas capacidades requieren configuración, un plan determinado o aprobación de un tercero. Una pantalla
          visible no implica que una integración esté habilitada, homologada o disponible para todas las cuentas.
        </p>
      </LegalSection>

      <LegalSection title="3. Cuenta, organización y seguridad">
        <ul>
          <li>Sos responsable de usar datos correctos y de proteger tus credenciales y factores de autenticación.</li>
          <li>Cada persona debe usar su propia cuenta; no se comparten accesos entre integrantes del equipo.</li>
          <li>Los roles de una organización determinan qué puede leer o modificar cada integrante.</li>
          <li>Debés informar de inmediato cualquier acceso no autorizado o sospecha de compromiso.</li>
          <li>El servicio sólo puede usarse para actividades lícitas y con autorización sobre los datos cargados.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Prueba, planes y cobro">
        <ul>
          <li>La prueba inicial dura 14 días y no requiere tarjeta.</li>
          <li>Los precios publicados para Argentina se expresan en pesos argentinos y muestran la periodicidad aplicable.</li>
          <li>Las suscripciones se autorizan y procesan mediante Mercado Pago; {brand} no almacena el número completo de la tarjeta.</li>
          <li>Antes de pagar se informa el plan, importe y frecuencia que se autorizarán en el proveedor.</li>
          <li>Un cambio futuro de precio no se aplica retroactivamente y debe comunicarse antes de modificar el cobro autorizado.</li>
        </ul>
        <p>
          Podés dar de baja la renovación desde <strong>Mi plan</strong>. Cuando existe un período ya pagado, el acceso
          correspondiente continúa hasta su finalización; Mercado Pago deja de generar cobros futuros al confirmar la baja.
          Los pedidos de corrección o reintegro se evalúan según la operación, la ley aplicable y las condiciones acordadas,
          escribiendo a <a href={`mailto:${legalEmail}`}>{legalEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection title="5. Datos de la organización">
        <p>
          La organización conserva sus derechos sobre los datos que carga. Autoriza a {brand} a procesarlos sólo para
          prestar, proteger y mejorar el servicio dentro de las finalidades informadas. Las exportaciones disponibles
          permiten descargar la cobertura que cada archivo declara; no se promete una restauración automática donde aún
          no exista importador.
        </p>
        <p>
          Para los datos de compradores y clientes del comercio, el comercio define las finalidades y actúa como
          responsable; el prestador de {brand} actúa como encargado técnico. El anexo de tratamiento entre ambas partes
          es una puerta obligatoria antes del lanzamiento comercial general.
        </p>
      </LegalSection>

      <LegalSection title="6. Uso aceptable">
        <p>No está permitido:</p>
        <ul>
          <li>Usar el servicio para fraude, abuso, spam o actividades ilegales.</li>
          <li>Acceder o intentar acceder a información de otra organización sin autorización.</li>
          <li>Eludir límites, controles de seguridad, permisos o mecanismos de cobro.</li>
          <li>Introducir código malicioso o sobrecargar deliberadamente la infraestructura.</li>
          <li>Copiar, revender o explotar el software fuera de la licencia de uso contratada.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Integraciones y terceros">
        <p>
          Las integraciones funcionan sólo cuando están configuradas y autorizadas. Cada proveedor conserva sus propios
          términos, disponibilidad y procesos de aprobación. {brand} debe mostrar fallas y estados pendientes de manera
          honesta, pero no controla una interrupción o rechazo originado en Mercado Pago, ARCA, servicios logísticos,
          marketplaces u otros terceros.
        </p>
      </LegalSection>

      <LegalSection title="8. Continuidad y soporte">
        <p>
          Se aplican medidas razonables de continuidad, respaldo, observabilidad y recuperación. No existe un SLA
          comercial garantizado salvo que un contrato o anexo firmado lo establezca expresamente. El estado operativo se
          publica en <a href="/estado">nerqia.app/estado</a>; los incidentes y mantenimientos se comunican por los canales
          disponibles según su impacto.
        </p>
      </LegalSection>

      <LegalSection title="9. Decisiones y responsabilidad">
        <p>
          Los cálculos, alertas y recomendaciones apoyan la operación, pero no reemplazan el criterio del comercio ni el
          asesoramiento contable, fiscal, legal o profesional que corresponda. Cada parte responde por sus obligaciones
          conforme a la ley y al contrato aplicable. Estos términos no excluyen derechos ni responsabilidades que una norma
          imperativa no permita excluir.
        </p>
      </LegalSection>

      <LegalSection title="10. Suspensión y terminación">
        <p>
          Puede restringirse temporalmente una cuenta para contener un incidente, cumplir una orden válida, proteger a
          terceros o investigar una violación grave. Cuando sea posible, se informa el motivo y el camino de revisión.
        </p>
        <p>
          Cancelar la suscripción detiene la renovación, pero no equivale a pedir el borrado de datos. La supresión se
          solicita por el canal de privacidad y se ejecuta con verificación de identidad, alcance y obligaciones fiscales,
          contractuales o de seguridad que exijan conservar determinados registros.
        </p>
      </LegalSection>

      <LegalSection title="11. Cambios a estos términos">
        <p>
          Los cambios materiales deben informarse de forma clara antes de su vigencia y quedar asociados a una nueva
          versión. Cuando el cambio requiera una aceptación nueva, la plataforma debe pedirla y conservar su evidencia.
          Continuar usando funciones sin relación con el cambio no reemplaza ese consentimiento cuando la ley o el contrato
          exijan una manifestación expresa.
        </p>
      </LegalSection>

      <LegalSection title="12. Ley y resolución de conflictos">
        <p>
          Se aplica la ley de la República Argentina. La jurisdicción será la que resulte competente según las normas
          aplicables y la relación concreta; este documento no impone una renuncia anticipada a fueros o derechos que no
          puedan renunciarse.
        </p>
      </LegalSection>

      <LegalSection title="13. Contacto">
        <p>
          Para consultas contractuales, avisos formales o reclamos sobre el servicio, escribinos a{" "}
          <a href={`mailto:${legalEmail}`}>{legalEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
