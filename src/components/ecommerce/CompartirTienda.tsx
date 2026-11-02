import { useState } from "react";
import { Copy, Download, MessageCircle, Printer, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archivoDelQr, cartelImprimible, enlaceWhatsApp, mensajeParaCompartir } from "@/lib/compartirTienda";

/**
 * Compartí tu tienda (2026-11-02): link, WhatsApp, QR y cartel para el
 * mostrador. Se ve mientras la tienda publicada no tiene su primera venta, que
 * es cuando más falta hace que alguien la abra.
 */
export default function CompartirTienda({ url, nombreTienda, destacado = false }: {
  url: string;
  nombreTienda: string;
  destacado?: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const generarQr = async () => {
    if (qr) return qr;
    setGenerando(true);
    try {
      // Se carga recién al pedirlo: no pesa en la pantalla de la tienda.
      const QRCode = await import("qrcode");
      const imagen = await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M" });
      setQr(imagen);
      return imagen;
    } catch {
      toast.error("No se pudo generar el QR. Reintentá.");
      return null;
    } finally {
      setGenerando(false);
    }
  };

  const copiar = () => {
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Enlace copiado"),
      () => toast.error("No se pudo copiar el enlace"),
    );
  };

  const descargarQr = async () => {
    const imagen = await generarQr();
    if (!imagen) return;
    const a = document.createElement("a");
    a.href = imagen;
    a.download = archivoDelQr(nombreTienda);
    a.click();
  };

  const imprimirCartel = async () => {
    // La ventana se abre en el clic (si no, el navegador la bloquea) y se
    // llena cuando el QR está listo.
    const ventana = window.open("", "_blank");
    if (!ventana) {
      toast.error("El navegador bloqueó la ventana del cartel. Permití ventanas emergentes para este sitio.");
      return;
    }
    const imagen = await generarQr();
    if (!imagen) { ventana.close(); return; }
    ventana.document.open();
    ventana.document.write(cartelImprimible({ nombreTienda, url, qr: imagen }));
    ventana.document.close();
  };

  return (
    <section
      aria-labelledby="compartir-tienda-titulo"
      className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h2 id="compartir-tienda-titulo" className="text-sm font-semibold">
            {destacado ? "Tu tienda está online: compartila" : "Compartí tu tienda"}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            La primera venta llega cuando alguien abre el link. Mandalo por WhatsApp, ponelo en la bio de
            Instagram y pegá el QR en el mostrador.
          </p>
          <p className="mt-2 truncate font-mono text-[12px] text-foreground">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11 gap-1.5" onClick={copiar}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />Copiar enlace
            </Button>
            <Button asChild size="sm" variant="outline" className="min-h-11 gap-1.5">
              <a href={enlaceWhatsApp(mensajeParaCompartir(nombreTienda, url))} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Mandar por WhatsApp
              </a>
            </Button>
            <Button size="sm" variant="outline" className="min-h-11 gap-1.5" onClick={() => { void descargarQr(); }} disabled={generando}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />Descargar QR
            </Button>
            <Button size="sm" variant="outline" className="min-h-11 gap-1.5" onClick={() => { void imprimirCartel(); }} disabled={generando}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />Imprimir cartel
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void generarQr(); }}
          className="flex h-28 w-28 shrink-0 items-center justify-center self-center overflow-hidden rounded-lg border border-border/60 bg-white sm:self-start"
          aria-label={qr ? "Código QR de la tienda" : "Mostrar el código QR de la tienda"}
        >
          {qr
            ? <img src={qr} alt="" className="h-full w-full" />
            : <QrCode className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}
