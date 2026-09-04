import { Shield } from "lucide-react";
import {
  LegalDocumentLayout,
  LegalIdentityNotice,
  LegalSection,
} from "@/components/legal/LegalDocumentLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  ARGENTINA_PRIVACY_SOURCES,
  PLATFORM_LEGAL,
  PLATFORM_PROCESSORS,
} from "@/lib/platformLegal";

const { brand, privacyEmail, privacyVersion, updatedLabel } = PLATFORM_LEGAL;

export default function PrivacyPage() {
  return (
    <LegalDocumentLayout
      title="Política de Privacidad"
      updatedLabel={updatedLabel}
      version={privacyVersion}
      icon={Shield}
    >
      <LegalIdentityNotice />

      <LegalSection title="1. Alcance y roles">
        <p>
          Esta política explica cómo se tratan datos personales en la cuenta y la plataforma {brand}. Para los datos de
          registro, seguridad, soporte y suscripción de la plataforma, el prestador de {brand} determina el tratamiento.
          Para los datos de compradores, clientes y contactos que carga un comercio, ese comercio determina la finalidad y
          {brand} presta el procesamiento técnico por su cuenta.
        </p>
        <p>
          La organización debe contar con una base legal propia para cargar y usar datos de terceros. El contrato de
          tratamiento entre plataforma y comercio, con alcance, duración, categorías y medidas, debe aprobarse antes del
          lanzamiento comercial general.
        </p>
      </LegalSection>

      <LegalSection title="2. Datos que podemos tratar">
        <ul>
          <li><strong>Cuenta:</strong> nombre, email, identificador de usuario, credenciales protegidas y factores de autenticación.</li>
          <li><strong>Organización:</strong> integrantes, roles, configuración, sucursales e información fiscal o comercial que se cargue.</li>
          <li><strong>Operación:</strong> productos, inventario, ventas, compras, caja, gastos, documentos y métricas.</li>
          <li><strong>Compradores y clientes:</strong> contacto, pedidos, entrega, historial y consentimientos registrados por el comercio.</li>
          <li><strong>Rendimiento de tiendas:</strong> identificador aleatorio hasheado, primera fuente UTM y dominio referente; no guardamos en esa medición la IP, la URL completa ni la identidad del visitante.</li>
          <li><strong>Facturación:</strong> plan, importe, estado y referencias del proveedor; no guardamos el número completo de la tarjeta.</li>
          <li><strong>Seguridad y diagnóstico:</strong> dirección IP, dispositivo, navegador, ruta sin parámetros, eventos de auditoría y errores minimizados.</li>
          <li><strong>Soporte o IA opcional:</strong> el contenido que decidís enviar para resolver una solicitud concreta.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Finalidades y base del tratamiento">
        <ul>
          <li>Crear y proteger la cuenta, autenticar accesos y aplicar permisos por organización.</li>
          <li>Prestar las funciones contratadas y procesar instrucciones del comercio.</li>
          <li>Gestionar suscripción, cobros, soporte, avisos e incidentes.</li>
          <li>Prevenir fraude, abuso y accesos no autorizados; mantener auditoría y continuidad.</li>
          <li>Cumplir obligaciones legales, fiscales y requerimientos válidos.</li>
          <li>Mejorar rendimiento y confiabilidad con información técnica minimizada.</li>
        </ul>
        <p>
          Según el caso, el tratamiento se apoya en la relación contractual, el cumplimiento de una obligación legal, la
          seguridad del servicio o un consentimiento específico. El consentimiento no se usa como explicación genérica
          cuando los datos son necesarios para ejecutar el servicio solicitado.
        </p>
      </LegalSection>

      <LegalSection title="4. Origen y consecuencias">
        <p>
          Los datos llegan de la persona que crea la cuenta, otros integrantes autorizados, compradores que usan una tienda,
          archivos o integraciones que el comercio conecta y proveedores que informan el estado de una operación. Los campos
          obligatorios se señalan en cada flujo: sin datos mínimos de cuenta no puede crearse el acceso; sin datos de entrega
          o pago requeridos puede no completarse un pedido.
        </p>
      </LegalSection>

      <LegalSection title="5. Infraestructura y transferencias internacionales">
        <p>
          La base de datos, autenticación y almacenamiento principal se alojan en Supabase sobre AWS en la región
          <strong> us-east-1, Estados Unidos</strong>. La aplicación web y sus funciones de borde se entregan mediante Vercel.
          Eso puede implicar transferencias internacionales de datos.
        </p>
        <p>
          Estados Unidos no integra la lista argentina de países con nivel adecuado. Antes del lanzamiento comercial debe
          quedar aprobado y archivado el mecanismo aplicable —por ejemplo, cláusulas contractuales modelo—, junto con los
          destinos, subencargados y medidas. Informar la transferencia en esta página no sustituye esa garantía.
        </p>
      </LegalSection>

      <LegalSection title="6. Proveedores que pueden recibir datos">
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead className="bg-muted/60 text-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Proveedor</th>
                <th className="px-4 py-3 font-semibold">Finalidad</th>
                <th className="px-4 py-3 font-semibold">Datos</th>
                <th className="px-4 py-3 font-semibold">Cuándo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PLATFORM_PROCESSORS.map((processor) => (
                <tr key={processor.name} className="align-top">
                  <td className="px-4 py-3 font-medium text-foreground">{processor.name}</td>
                  <td className="px-4 py-3">{processor.purpose}</td>
                  <td className="px-4 py-3">{processor.data}</td>
                  <td className="px-4 py-3">{processor.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          No vendemos datos personales ni los compartimos para publicidad de terceros. Una integración elegida por el
          comercio puede tener proveedores adicionales y debe informar sus propios destinatarios a sus compradores.
        </p>
      </LegalSection>

      <LegalSection title="7. Inteligencia artificial opcional">
        <p>
          Las funciones que envían documentos o el contenido que elegís procesar a un modelo externo permanecen desactivadas hasta aprobar el
          proveedor, contrato, región, subencargados, retención, exclusión de entrenamiento y habilitación técnica. Cuando
          una función se habilita, la interfaz debe indicar qué se enviará y exigir revisión humana del resultado. Siempre
          podés completar la tarea manualmente.
        </p>
      </LegalSection>

      <LegalSection title="8. Retención y eliminación">
        <p>
          Conservamos los datos mientras sean necesarios para prestar y proteger el servicio, cumplir instrucciones válidas
          y atender obligaciones legales. Cancelar una suscripción no borra automáticamente la organización. Podés exportar
          la cobertura disponible y solicitar supresión; verificaremos identidad, autoridad, alcance y excepciones aplicables.
        </p>
        <p>
          Registros fiscales, pagos, auditoría, seguridad y respaldos pueden tener ciclos distintos. No prometemos un plazo
          de borrado automático que el sistema todavía no ejecuta. El calendario formal por categoría, incluido el vencimiento
          de copias de respaldo, es una puerta de lanzamiento pendiente de aprobación y prueba operativa.
        </p>
      </LegalSection>

      <LegalSection title="9. Tus derechos">
        <p>Podés solicitar acceso, rectificación, actualización, confidencialidad o supresión, según corresponda.</p>
        <ul>
          <li>El acceso debe responderse dentro de 10 días corridos desde una solicitud verificable.</li>
          <li>La rectificación, actualización o supresión debe resolverse dentro de 5 días hábiles, salvo excepción legal.</li>
          <li>La portabilidad operativa disponible puede descargarse desde Ajustes; su manifiesto declara cobertura y límites.</li>
        </ul>
        <p>
          Escribí a <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. Podemos pedir información razonable para verificar
          identidad y representación. Si la respuesta no resulta satisfactoria, podés recurrir a la{" "}
          <a href={ARGENTINA_PRIVACY_SOURCES.rights} target="_blank" rel="noreferrer">Agencia de Acceso a la Información Pública</a>.
        </p>
      </LegalSection>

      <LegalSection title="10. Cookies, almacenamiento local y telemetría">
        <p>
          Usamos cookies o almacenamiento local necesarios para sesión, seguridad, preferencias y continuidad del carrito.
          La tienda conserva durante 30 minutos una capacidad aleatoria para medir visitas, carrito, checkout y compra por
          primera fuente observada. En el servidor se guarda sólo su hash, UTM y dominio referente durante 13 meses; no se
          guarda la URL completa, IP, user-agent ni identidad para esa medición. No instalamos analítica publicitaria. Si
          Sentry está configurado, recibe diagnóstico técnico minimizado: no se
          graban sesiones, se descartan interacciones y consola, y se quitan identidad, cookies, encabezados y parámetros de URL
          antes del envío. Borrar el almacenamiento del navegador puede cerrar la sesión o vaciar preferencias locales.
        </p>
      </LegalSection>

      <LegalSection title="11. Seguridad e incidentes">
        <p>
          Aplicamos cifrado en tránsito, controles de acceso por organización, roles, MFA para staff, auditoría y separación
          de credenciales. Ninguna medida elimina todo riesgo. El procedimiento de respuesta, responsables, comunicación y
          simulacro documentado sigue siendo una puerta de lanzamiento; un test técnico no equivale a su aprobación operativa.
        </p>
      </LegalSection>

      <LegalSection title="12. Cambios y contacto">
        <p>
          Los cambios materiales se publican con nueva fecha y versión, y se solicita una nueva aceptación cuando corresponda.
          Para ejercer derechos o consultar sobre privacidad, escribinos a{" "}
          <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
        </p>
        <p>
          Fuentes oficiales de referencia: {" "}
          <a href={ARGENTINA_PRIVACY_SOURCES.obligations} target="_blank" rel="noreferrer">obligaciones del responsable</a>
          {" · "}
          <a href={ARGENTINA_PRIVACY_SOURCES.internationalTransfers} target="_blank" rel="noreferrer">transferencias internacionales</a>.
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
