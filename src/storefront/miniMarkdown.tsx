/**
 * Markdown mínimo para las páginas de contenido de la tienda.
 *
 * Devuelve elementos de React, nunca HTML: el texto lo escribe el comercio y se
 * sirve desde el dominio de la tienda, así que un `dangerouslySetInnerHTML`
 * acá sería un XSS con los datos del comprador del otro lado.
 *
 * Soporta lo que hace falta para una política de devoluciones y nada más:
 * encabezados `##`/`###`, listas con `-`, **negrita**, links, y párrafos.
 */
import type { ReactNode } from "react";

/** Parte una línea en trozos de texto, **negrita** y [links](url). */
function inline(texto: string, keyBase: string): ReactNode[] {
  const partes: ReactNode[] = [];
  // Un solo regex para negrita y link: si se hacen en pasadas separadas, la
  // segunda vuelve a recorrer lo que ya produjo la primera.
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(texto)) !== null) {
    if (m.index > last) partes.push(texto.slice(last, m.index));
    if (m[1] !== undefined) {
      partes.push(<strong key={`${keyBase}-b${i}`}>{m[1]}</strong>);
    } else {
      // Sólo http/https por el regex; nada de `javascript:`.
      partes.push(
        <a
          key={`${keyBase}-a${i}`}
          href={m[3]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline"
          style={{ color: "hsl(var(--st-link))" }}
        >
          {m[2]}
        </a>,
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < texto.length) partes.push(texto.slice(last));
  return partes;
}

export function renderMarkdown(md: string): ReactNode[] {
  const lineas = (md ?? "").split(/\r?\n/);
  const salida: ReactNode[] = [];
  let lista: string[] = [];

  const cerrarLista = () => {
    if (lista.length === 0) return;
    const items = lista;
    lista = [];
    salida.push(
      <ul key={`ul-${salida.length}`} className="list-disc pl-5 space-y-1 my-3">
        {items.map((t, j) => <li key={j}>{inline(t, `li-${salida.length}-${j}`)}</li>)}
      </ul>,
    );
  };

  lineas.forEach((raw, idx) => {
    const l = raw.trimEnd();

    if (/^\s*[-*]\s+/.test(l)) { lista.push(l.replace(/^\s*[-*]\s+/, "")); return; }
    cerrarLista();

    if (l.trim() === "") return;

    if (/^###\s+/.test(l)) {
      salida.push(<h3 key={idx} className="text-base font-semibold mt-6 mb-2">{inline(l.replace(/^###\s+/, ""), `h${idx}`)}</h3>);
    } else if (/^##\s+/.test(l)) {
      salida.push(<h2 key={idx} className="text-lg font-semibold mt-7 mb-2">{inline(l.replace(/^##\s+/, ""), `h${idx}`)}</h2>);
    } else if (/^#\s+/.test(l)) {
      salida.push(<h2 key={idx} className="text-xl font-semibold mt-7 mb-2">{inline(l.replace(/^#\s+/, ""), `h${idx}`)}</h2>);
    } else {
      salida.push(
        <p key={idx} className="text-sm leading-relaxed my-2" style={{ color: "hsl(var(--st-muted))" }}>
          {inline(l, `p${idx}`)}
        </p>,
      );
    }
  });

  cerrarLista();
  return salida;
}
