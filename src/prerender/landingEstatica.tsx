import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";

/**
 * La landing en HTML, generada al compilar (2026-11-02). En un celular el
 * título tardaba 3,8 s en aparecer (Lighthouse): el 83 % era esperar que
 * bajara y corriera el JavaScript, aunque el contenido es fijo. index.html la
 * muestra apenas llega y React la reemplaza por la misma cuando monta.
 */
export function landingEstatica() {
  return renderToString(
    <MemoryRouter initialEntries={["/"]}>
      <LandingPage />
    </MemoryRouter>,
  );
}
