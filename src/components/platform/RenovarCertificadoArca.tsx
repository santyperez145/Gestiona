/**
 * «Renovar el certificado paso a paso» en Platform › ARCA. Arma los comandos
 * de openssl con el CUIT y la razón social del formulario, dice dónde subir el
 * pedido en ARCA según el ambiente y recuerda qué cargar acá. Ver
 * `src/lib/renovarCertificadoArca.ts`.
 */
import { comandosCsr, dondeSubirElPedido, type AmbienteArca } from "@/lib/renovarCertificadoArca";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function copiar(texto: string) {
  navigator.clipboard.writeText(texto)
    .then(() => toast.success("Comando copiado"))
    .catch(() => toast.error("No se pudo copiar; seleccionalo y copialo a mano"));
}

export default function RenovarCertificadoArca({ cuit, razonSocial, ambiente }: {
  cuit: string;
  razonSocial: string;
  ambiente: string;
}) {
  const amb: AmbienteArca = ambiente === "produccion" ? "produccion" : "homologacion";
  const comandos = comandosCsr(cuit, razonSocial, amb);

  return (
    <details className="rounded-lg border border-border p-4 text-sm">
      <summary className="cursor-pointer font-medium">Renovar el certificado paso a paso</summary>
      <ol className="mt-3 space-y-4 list-decimal pl-5">
        <li className="space-y-2">
          <p>En tu computadora, generá la clave privada y el pedido de certificado (CSR). La clave no sale de tu computadora salvo para cargarla abajo.</p>
          {comandos ? (
            <div className="space-y-2">
              {[comandos.generarClave, comandos.generarPedido].map(c => (
                <div key={c} className="flex items-start gap-2">
                  <code className="flex-1 break-all rounded bg-muted px-2 py-1.5 text-xs">{c}</code>
                  <Button type="button" size="sm" variant="outline" onClick={() => copiar(c)}>Copiar</Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">Completá abajo un CUIT válido y la razón social de la plataforma para armar los comandos.</p>
          )}
        </li>
        <li>{dondeSubirElPedido(amb)}</li>
        <li>
          Cargá abajo el certificado emitido (.crt) junto con la clave{comandos ? <> <code className="text-xs">{comandos.archivoClave}</code></> : null} del paso 1, y elegí el mismo ambiente.
          Nerqia valida que la clave corresponda al certificado, el CUIT y la vigencia antes de guardarlos cifrados.
        </li>
      </ol>
    </details>
  );
}
