/**
 * withPageDesign — HOC para aplicar diseño estandarizado a cualquier página
 *
 * Estrategia eficiente para rediseñar 108 páginas sin reescribir cada una manualmente.
 * Este HOC envuelve el componente de página y aplica el diseño estandarizado.
 */
import { ComponentType } from "react";
import UniversalPageWrapper from "./UniversalPageWrapper";

interface PageDesignOptions {
  showCard?: boolean;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
}

export function withPageDesign<P extends object>(
  WrappedComponent: ComponentType<P>,
  options: PageDesignOptions = {}
) {
  const { showCard = true, maxWidth = "xl", className } = options;

  return function PageDesignWrapper(props: P) {
    return (
      <UniversalPageWrapper showCard={showCard} maxWidth={maxWidth} className={className}>
        <WrappedComponent {...props} />
      </UniversalPageWrapper>
    );
  };
}
