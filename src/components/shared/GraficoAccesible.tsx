import type { ReactNode } from "react";

/**
 * Un gráfico de Recharts es un dibujo: el lector de pantalla encontraba cada
 * porción como «imagen» sin nombre y un foco que no lleva a nada (axe
 * `svg-img-alt` y `aria-hidden-focus`, barrido del 2026-10-22). Se oculta el
 * dibujo y se ofrece lo mismo en texto.
 *
 * Al `<Pie>` de adentro hay que pasarle `rootTabIndex={-1}`: Recharts lo deja
 * enfocable por defecto y un foco oculto es peor que ninguno.
 */
export default function GraficoAccesible({ titulo, datos, formato = v => String(v), children }: {
  titulo: string;
  datos: { name: string; value: number }[];
  formato?: (valor: number) => string;
  children: ReactNode;
}) {
  return (
    <>
      <div aria-hidden="true">{children}</div>
      <div className="sr-only">
        <p>{titulo}</p>
        <ul>{datos.map(d => <li key={d.name}>{d.name}: {formato(d.value)}</li>)}</ul>
      </div>
    </>
  );
}
