import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ABRIR_CAJON_EPSON, INFORMACION_EPSON, mensajeRetornoEpson, type EpsonResponse } from "@/lib/fiscalPrinter/epson";
import {
  enviarLoteEpson, guardarConfigControlador, hostValido, leerConfigControlador, urlControlador, type ConfigControlador,
} from "@/lib/fiscalPrinter/transport";

/** Configuración del controlador fiscal de esta caja (se guarda en este dispositivo). */
export default function FiscalControllerDialog({ open, orgId, onClose, onSaved }: {
  open: boolean;
  orgId: string | null | undefined;
  onClose: () => void;
  onSaved: (config: ConfigControlador | null) => void;
}) {
  const [host, setHost] = useState("192.168.1.1");
  const [protocolo, setProtocolo] = useState<"https" | "http">("https");
  const [emitirAlCobrar, setEmitirAlCobrar] = useState(true);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const actual = leerConfigControlador(orgId);
    setHost(actual?.host ?? "192.168.1.1");
    setProtocolo(actual?.protocolo ?? "https");
    setEmitirAlCobrar(actual?.emitirAlCobrar ?? true);
    setResultado(null);
  }, [open, orgId]);

  const config: ConfigControlador = { modelo: "epson_tm_t900fa", host: host.trim(), protocolo, emitirAlCobrar };
  const valido = hostValido(config.host);

  const probar = async () => {
    setProbando(true); setResultado(null);
    try {
      const [info] = (await enviarLoteEpson(config, [INFORMACION_EPSON], 10_000)) as EpsonResponse[];
      if (info?.["return code"] !== "0000") throw new Error(mensajeRetornoEpson(String(info?.["return code"] ?? "")));
      const [firmware, , , , , , modelo] = info.fields ?? [];
      setResultado({ ok: true, texto: `Conectado: ${modelo || "controlador Epson"}, firmware ${firmware || "desconocido"}.` });
    } catch (cause) {
      setResultado({ ok: false, texto: cause instanceof Error ? cause.message : "No se pudo conectar" });
    } finally {
      setProbando(false);
    }
  };

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Printer className="h-4 w-4" />Controlador fiscal</DialogTitle>
        <DialogDescription>Epson TM-T900FA con firmware 1.03 “Neptuno” o posterior, conectado por red. La configuración vale para esta caja.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="fiscal-host" className="text-xs">IP del controlador</Label>
            <Input id="fiscal-host" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.1" aria-invalid={!valido} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fiscal-protocolo" className="text-xs">Conexión</Label>
            <Select value={protocolo} onValueChange={v => setProtocolo(v === "http" ? "http" : "https")}>
              <SelectTrigger id="fiscal-protocolo" className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="https">HTTPS (8443)</SelectItem>
                <SelectItem value="http">HTTP (80)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={emitirAlCobrar} onCheckedChange={v => setEmitirAlCobrar(v === true)} className="mt-0.5" />
          <span>Emitir cada venta en el controlador al cobrar<span className="block text-xs text-muted-foreground">Reemplaza la factura electrónica para los tickets de esta caja.</span></span>
        </label>
        <div className="space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Antes de usarlo</p>
          <p>1. En Epson Manager ({urlControlador(config, "/manager")}) → Sistema → Red, configurá CORS con el origen <code>{typeof window !== "undefined" ? window.location.origin : ""}</code> y <code>Access-Control-Allow-Private-Network: true</code>.</p>
          <p>2. Con HTTPS, abrí {urlControlador(config, "")} una vez en este navegador y aceptá el certificado del equipo.</p>
          <p>3. Probá primero con el equipo en Modo Entrenamiento: los comprobantes de prueba no tienen validez fiscal.</p>
        </div>
        {resultado && <p role="status" className={`flex items-start gap-1.5 text-sm ${resultado.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {resultado.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}{resultado.texto}
        </p>}
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex gap-2">
          <Button variant="outline" disabled={!valido || probando} onClick={() => void probar()}>
            {probando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Probar conexión
          </Button>
          <Button variant="ghost" disabled={!valido} onClick={() => void enviarLoteEpson(config, [ABRIR_CAJON_EPSON], 10_000).catch(() => undefined)}>Abrir cajón</Button>
        </div>
        <div className="flex gap-2">
          {leerConfigControlador(orgId) && <Button variant="ghost" onClick={() => { if (orgId) guardarConfigControlador(orgId, null); onSaved(null); }}>Desactivar</Button>}
          <Button disabled={!valido || !orgId} onClick={() => { if (orgId) guardarConfigControlador(orgId, config); onSaved(config); }}>Guardar</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
