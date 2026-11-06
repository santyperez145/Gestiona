/**
 * Conteo por zona (2026-11-05): se apunta la cámara a un estante y se cuenta
 * todo lo que se ve de una vez.
 *
 *  1. Códigos de barras: se congela la imagen y se leen TODOS los códigos
 *     visibles, en cualquier navegador (lectorDeCodigos: nativo o ZXing-C++ en
 *     WebAssembly). Cada código es una unidad: es exacto y no necesita IA.
 *  2. IA (plan con IA): para lo que no muestra el código, Claude identifica el
 *     producto y marca un punto en cada unidad. La persona toca la foto para
 *     agregar o sacar puntos; el total son los puntos. La IA propone, la
 *     persona confirma.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { registrarError } from "@/lib/registroDeErrores";
import { lectorDeCodigos } from "@/lib/lectorDeCodigos";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Loader2, RotateCcw, Sparkles, X, Plus } from "lucide-react";
import { toast } from "sonner";

export type ProductoContable = { id: string; name: string; barcode?: string | null; sku?: string | null; image_url?: string | null };

type Lectura = { codigo: string; productoId: string | null; caja: { x: number; y: number; w: number; h: number } | null };
type Punto = { x: number; y: number };

/** El lado largo de la foto que se analiza: alcanza para leer etiquetas y es liviana. */
export const LADO_DE_LA_FOTO = 2048;

/** Agrupa las lecturas por producto: cada código leído es una unidad. */
export function unidadesPorProducto(lecturas: Array<{ productoId: string | null }>): Map<string, number> {
  const salida = new Map<string, number>();
  for (const l of lecturas) if (l.productoId) salida.set(l.productoId, (salida.get(l.productoId) ?? 0) + 1);
  return salida;
}

/** A partir de cuántas unidades conviene contar en partes: los modelos de visión se saltean unidades en estantes llenos. */
export const UNIDADES_PARA_CONTAR_EN_PARTES = 30;

export type Parte = { x: number; y: number; ancho: number; alto: number };

/** Cuadrícula de 2×2 con superposición, para que ninguna unidad quede cortada en un borde. */
export function partesDeLaFoto(ancho: number, alto: number, superposicion = 0.1): Parte[] {
  const extraX = Math.round(ancho * superposicion / 2);
  const extraY = Math.round(alto * superposicion / 2);
  const mitadX = Math.round(ancho / 2);
  const mitadY = Math.round(alto / 2);
  const partes: Parte[] = [];
  for (const [x0, x1] of [[0, mitadX + extraX], [mitadX - extraX, ancho]]) {
    for (const [y0, y1] of [[0, mitadY + extraY], [mitadY - extraY, alto]]) {
      partes.push({ x: x0, y: y0, ancho: x1 - x0, alto: y1 - y0 });
    }
  }
  return partes;
}

/**
 * Une los puntos de cada parte (ya en coordenadas de la foto entera). Una
 * unidad en la zona superpuesta aparece en dos partes: dos puntos más cerca
 * que `radio` son la misma unidad.
 */
export function unirPuntos(grupos: Punto[][], radio: number): Punto[] {
  const salida: Punto[] = [];
  for (const grupo of grupos) {
    for (const p of grupo) {
      if (!salida.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= radio)) salida.push(p);
    }
  }
  return salida;
}

/** El punto de la foto (en píxeles de la imagen) donde se tocó la pantalla. */
export function puntoEnLaFoto(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, ancho: number, alto: number): Punto {
  return {
    x: Math.round(((clientX - rect.left) / rect.width) * ancho),
    y: Math.round(((clientY - rect.top) / rect.height) * alto),
  };
}

export default function ConteoPorZona({
  productos, candidatos, canUseAI, orgId, onSumar, onCerrar,
}: {
  productos: ProductoContable[];
  /** Los productos que la IA puede elegir (lo filtrado en la toma, hasta 80). */
  candidatos: ProductoContable[];
  canUseAI: boolean;
  orgId: string;
  onSumar: (productoId: string, unidades: number) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [foto, setFoto] = useState<{ url: string; base64: string; ancho: number; alto: number } | null>(null);
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [productoIA, setProductoIA] = useState<string>("");
  const [puntos, setPuntos] = useState<Punto[]>([]);
  const [notaIA, setNotaIA] = useState("");
  const [consultandoIA, setConsultandoIA] = useState(false);
  /** La foto en resolución completa, para cortar las partes. */
  const lienzoRef = useRef<HTMLCanvasElement | null>(null);

  const porCodigo = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of productos) {
      if (p.barcode) m.set(p.barcode.trim(), p.id);
      if (p.sku && !m.has(p.sku.trim())) m.set(p.sku.trim(), p.id);
    }
    return m;
  }, [productos]);
  const nombre = useCallback((id: string) => productos.find(p => p.id === id)?.name ?? "Producto", [productos]);

  const apagarCamara = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const prenderCamara = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
    } catch {
      toast.error("No pudimos abrir la cámara. Revisá el permiso del navegador.");
      onCerrar();
    }
  }, [onCerrar]);

  useEffect(() => { void prenderCamara(); return apagarCamara; }, [prenderCamara, apagarCamara]);

  const capturar = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setAnalizando(true);
    try {
      const escala = Math.min(1, LADO_DE_LA_FOTO / Math.max(video.videoWidth, video.videoHeight));
      const ancho = Math.round(video.videoWidth * escala);
      const alto = Math.round(video.videoHeight * escala);
      const canvas = document.createElement("canvas");
      canvas.width = ancho; canvas.height = alto;
      canvas.getContext("2d")!.drawImage(video, 0, 0, ancho, alto);
      lienzoRef.current = canvas;
      const url = canvas.toDataURL("image/jpeg", 0.85);
      setFoto({ url, base64: url.slice(url.indexOf(",") + 1), ancho, alto });
      setPuntos([]); setNotaIA("");
      apagarCamara();

      // Todos los códigos de la foto, en cualquier navegador (nativo o
      // ZXing-C++ en WebAssembly).
      const encontradas: Lectura[] = [];
      try {
        const lector = await lectorDeCodigos();
        for (const c of await lector.detect(canvas)) {
          const codigo = c.rawValue.trim();
          const b = c.boundingBox;
          encontradas.push({ codigo, productoId: porCodigo.get(codigo) ?? null, caja: { x: b.x, y: b.y, w: b.width, h: b.height } });
        }
      } catch (error) {
        // Sin lector la zona igual se puede contar con IA.
        registrarError(error);
        toast.error("No pudimos leer los códigos de esta foto. Probá contar con IA.");
      }
      setLecturas(encontradas);
      const primero = encontradas.find(l => l.productoId)?.productoId;
      setProductoIA(primero ?? "");
    } finally {
      setAnalizando(false);
    }
  };

  const otraFoto = () => {
    setFoto(null); setLecturas([]); setPuntos([]); setNotaIA("");
    void prenderCamara();
  };

  const grupos = useMemo(() => [...unidadesPorProducto(lecturas)], [lecturas]);
  const desconocidos = lecturas.filter(l => !l.productoId).length;

  // Lo que la IA puede elegir: lo leído por código primero, después lo filtrado en la toma.
  const opcionesIA = useMemo(() => {
    const ids = new Set<string>();
    const salida: ProductoContable[] = [];
    for (const [id] of grupos) { const p = productos.find(x => x.id === id); if (p && !ids.has(id)) { ids.add(id); salida.push(p); } }
    for (const p of candidatos) { if (salida.length >= 80) break; if (!ids.has(p.id)) { ids.add(p.id); salida.push(p); } }
    return salida;
  }, [grupos, candidatos, productos]);

  /** Una consulta a conteo-visual. Devuelve null si falló (ya avisado). */
  const consultarIA = async (imagen: string, ancho: number, alto: number, productoId: string | null) => {
    const { data, error } = await supabase.functions.invoke("conteo-visual", {
      headers: { "x-org-id": orgId },
      body: {
        imagen, ancho, alto,
        // La foto de catálogo ayuda a reconocer el producto (la función sólo acepta las de nuestro storage).
        candidatos: opcionesIA.map(p => ({ id: p.id, nombre: p.name, imagen: p.image_url ?? undefined })),
        producto_id: productoId,
      },
    });
    if (error || (data as { error?: string } | null)?.error) {
      const mensaje = await mensajeDeEdgeFunction(error, data);
      if (error) registrarError(error);
      toast.error(mensaje || "No pudimos contar la foto con IA.");
      return null;
    }
    return data as { producto_id: string | null; unidades: Punto[]; nota?: string };
  };

  const contarConIA = async () => {
    if (!foto) return;
    setConsultandoIA(true);
    try {
      const r = await consultarIA(foto.base64, foto.ancho, foto.alto, productoIA || null);
      if (!r) return;
      if (r.producto_id) setProductoIA(r.producto_id);
      setPuntos(r.unidades ?? []);
      setNotaIA(r.nota ?? "");
      if (!r.producto_id) toast.info("La IA no reconoció ninguno de estos productos. Elegí cuál es y volvé a probar.");
    } finally {
      setConsultandoIA(false);
    }
  };

  /**
   * Estante lleno: la foto se cuenta en 4 partes superpuestas, en paralelo, y
   * se unen los puntos sin repetir los de las zonas superpuestas.
   */
  const contarEnPartes = async () => {
    const lienzo = lienzoRef.current;
    if (!foto || !lienzo || !productoIA) return;
    setConsultandoIA(true);
    try {
      const partes = partesDeLaFoto(foto.ancho, foto.alto);
      const resultados = await Promise.all(partes.map(async parte => {
        const c = document.createElement("canvas");
        c.width = parte.ancho; c.height = parte.alto;
        c.getContext("2d")!.drawImage(lienzo, parte.x, parte.y, parte.ancho, parte.alto, 0, 0, parte.ancho, parte.alto);
        const url = c.toDataURL("image/jpeg", 0.9);
        const r = await consultarIA(url.slice(url.indexOf(",") + 1), parte.ancho, parte.alto, productoIA);
        return r ? (r.unidades ?? []).map(p => ({ x: p.x + parte.x, y: p.y + parte.y })) : null;
      }));
      if (resultados.some(r => r === null)) return;
      const radio = Math.max(foto.ancho, foto.alto) * 0.02;
      const unidos = unirPuntos(resultados as Punto[][], radio);
      setPuntos(unidos);
      setNotaIA(`Contado en 4 partes: ${unidos.length} unidades.`);
    } finally {
      setConsultandoIA(false);
    }
  };

  const tocarFoto = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!foto || !productoIA) return;
    const p = puntoEnLaFoto(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), foto.ancho, foto.alto);
    // Tocar cerca de un punto lo saca; en otro lado, agrega una unidad.
    const radio = Math.max(foto.ancho, foto.alto) * 0.025;
    const cerca = puntos.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) <= radio);
    setPuntos(prev => cerca >= 0 ? prev.filter((_, i) => i !== cerca) : [...prev, p]);
  };

  const sumarCodigos = () => {
    for (const [id, n] of grupos) onSumar(id, n);
    toast.success(`Sumadas ${lecturas.length - desconocidos} unidad(es) leídas por código.`);
    otraFoto();
  };

  const sumarPuntos = () => {
    if (!productoIA || puntos.length === 0) return;
    onSumar(productoIA, puntos.length);
    toast.success(`${nombre(productoIA)}: +${puntos.length}`);
    otraFoto();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col overflow-y-auto" role="dialog" aria-label="Contar una zona con la cámara">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-medium">Contar una zona</p>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => { apagarCamara(); onCerrar(); }} aria-label="Cerrar">
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-6 space-y-4">
        {!foto ? (
          <>
            <video ref={videoRef} className="w-full rounded-xl border border-white/20 bg-black" autoPlay playsInline muted />
            <p className="text-center text-sm text-white/70">
              Encuadrá el estante con los productos de frente y buena luz. Se cuenta todo lo que se ve.
            </p>
            <Button className="w-full min-h-12" onClick={() => { void capturar(); }} disabled={analizando}>
              {analizando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
              Contar esta zona
            </Button>
          </>
        ) : (
          <>
            <div
              className="relative w-full overflow-hidden rounded-xl border border-white/20 select-none"
              onClick={tocarFoto}
              style={{ cursor: productoIA ? "crosshair" : "default" }}
            >
              <img src={foto.url} alt="Zona capturada" className="block w-full" draggable={false} />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${foto.ancho} ${foto.alto}`} preserveAspectRatio="none">
                {lecturas.filter(l => l.caja).map((l, i) => (
                  <rect key={`c${i}`} x={l.caja!.x} y={l.caja!.y} width={l.caja!.w} height={l.caja!.h}
                    fill="none" stroke={l.productoId ? "#22c55e" : "#ef4444"} strokeWidth={Math.max(3, foto.ancho / 400)} />
                ))}
                {puntos.map((p, i) => (
                  <g key={`p${i}`}>
                    <circle cx={p.x} cy={p.y} r={Math.max(10, foto.ancho / 90)} fill="#2563eb" fillOpacity={0.85} stroke="#fff" strokeWidth={Math.max(2, foto.ancho / 600)} />
                    <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(10, foto.ancho / 110)} fill="#fff" fontWeight={700}>{i + 1}</text>
                  </g>
                ))}
              </svg>
            </div>

            {/* 1. Códigos leídos */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2 text-white">
              <p className="text-sm font-medium">Códigos de barras en la foto</p>
              {grupos.length === 0 && desconocidos === 0 && <p className="text-sm text-white/60">No se ve ningún código. Probá contar con IA o acercate.</p>}
              {grupos.map(([id, n]) => (
                <div key={id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{nombre(id)}</span>
                  <span className="font-mono font-semibold">{n}</span>
                </div>
              ))}
              {desconocidos > 0 && <p className="text-xs text-red-300">{desconocidos} código(s) que no están en tu catálogo (en rojo).</p>}
              {grupos.length > 0 && (
                <Button className="w-full min-h-11" onClick={sumarCodigos}>
                  <Plus className="w-4 h-4 mr-1" /> Sumar {lecturas.length - desconocidos} unidad(es)
                </Button>
              )}
            </section>

            {/* 2. IA */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3 text-white">
              <p className="text-sm font-medium flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary" /> Contar con IA lo que no muestra el código</p>
              {!canUseAI ? (
                <p className="text-sm text-white/60">El conteo visual con IA está incluido en los planes con IA (Mi plan).</p>
              ) : (
                <>
                  <Select value={productoIA} onValueChange={v => { setProductoIA(v); setPuntos([]); }}>
                    <SelectTrigger className="bg-black/40 border-white/20 text-white" aria-label="Producto que se cuenta">
                      <SelectValue placeholder="Que la IA reconozca el producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {opcionesIA.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {opcionesIA.length >= 80 && (
                    <p className="text-xs text-white/60">Para que la IA reconozca mejor, buscá o filtrá la categoría en la toma antes de abrir la cámara.</p>
                  )}
                  <Button variant="outline" className="w-full min-h-11 border-white/30 text-white hover:bg-white/10" onClick={() => { void contarConIA(); }} disabled={consultandoIA}>
                    {consultandoIA ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    {consultandoIA ? "Contando…" : "Contar con IA"}
                  </Button>
                  {productoIA && (
                    <p className="text-xs text-white/70">
                      Tocá la foto para agregar una unidad que falte; tocá un punto para sacarlo.
                      {notaIA && <> · {notaIA}</>}
                    </p>
                  )}
                  {productoIA && puntos.length >= UNIDADES_PARA_CONTAR_EN_PARTES && !notaIA.startsWith("Contado en 4 partes") && (
                    <Button variant="outline" className="w-full min-h-11 border-white/30 text-white hover:bg-white/10" onClick={() => { void contarEnPartes(); }} disabled={consultandoIA}>
                      {consultandoIA ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Estante lleno: contar en 4 partes (más preciso)
                    </Button>
                  )}
                  {productoIA && puntos.length > 0 && (
                    <Button className="w-full min-h-11" onClick={sumarPuntos}>
                      <Plus className="w-4 h-4 mr-1" /> Sumar {puntos.length} a {nombre(productoIA)}
                    </Button>
                  )}
                </>
              )}
            </section>

            <Button variant="outline" className="w-full min-h-11 border-white/30 text-white hover:bg-white/10" onClick={otraFoto}>
              <RotateCcw className="w-4 h-4 mr-2" /> Otra zona
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
