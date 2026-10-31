import { cn } from '@/lib/utils';
import { BRAND_MARK_MEDIUM_SRC, BRAND_MARK_SMALL_SRC, BRAND_NAME } from '@/lib/brand';

type BrandLogoProps = {
  compact?: boolean;
  product?: string;
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  eager?: boolean;
  decorative?: boolean;
};

/**
 * Identidad canónica de Nerqia para superficies propias del producto.
 *
 * El símbolo es decorativo porque el nombre accesible vive en el contenedor.
 * Las tiendas públicas conservan su logo de merchant y no usan este componente.
 */
export default function BrandLogo({
  compact = false,
  product,
  className,
  markClassName,
  nameClassName,
  eager = false,
  decorative = false,
}: BrandLogoProps) {
  const label = product ? `${BRAND_NAME} ${product}` : BRAND_NAME;

  return (
    <span
      className={cn('brand-logo inline-flex min-w-0 items-center gap-2.5', className)}
      // Sin rol, axe rechaza el aria-label en un span: «img» lo vuelve un nombre válido.
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      <img
        src={BRAND_MARK_SMALL_SRC}
        // Se muestra a 40 px como mucho: 64 y 128 px alcanzan para pantallas
        // de alta densidad (el original de 389 px pesaba 70 KB; Lighthouse).
        srcSet={`${BRAND_MARK_SMALL_SRC} 64w, ${BRAND_MARK_MEDIUM_SRC} 128w`}
        sizes="40px"
        alt=""
        aria-hidden="true"
        width="128"
        height="128"
        loading={eager ? 'eager' : 'lazy'}
        className={cn('brand-logo__mark h-8 w-8 shrink-0 object-contain', markClassName)}
      />
      {!compact && (
        <span className={cn('brand-logo__name truncate font-display font-semibold tracking-tight', nameClassName)}>
          {label}
        </span>
      )}
    </span>
  );
}
