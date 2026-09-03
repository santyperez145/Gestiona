import { cn } from '@/lib/utils';
import { BRAND_MARK_SRC, BRAND_NAME } from '@/lib/brand';

export const NERQIA_MARK_SRC = BRAND_MARK_SRC;

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
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      <img
        src={NERQIA_MARK_SRC}
        alt=""
        aria-hidden="true"
        width="1254"
        height="1254"
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
