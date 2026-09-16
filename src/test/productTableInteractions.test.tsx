import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductTableOwn from '@/components/products/ProductTableOwn';
import { TooltipProvider } from '@/components/ui/tooltip';
import { nombreDeCategoria } from '@/lib/storeCategories';
import { roleLabel } from '@/lib/roleLabels';

afterEach(cleanup);
const product = { id: 'product', name: 'Producto de prueba', category: 'Accesorios', sale_price_ars: 18000, discount_price_ars: 15000, stock: 8, profit_per_unit_ars: 0 };
function table(props = {}) {
  return render(<TooltipProvider><ProductTableOwn rows={[product]} selectedIds={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()} {...props} /></TooltipProvider>);
}
describe('tabla de productos', () => {
  it('alinea cada dato con sus ocho encabezados, incluso ganancia cero y oferta', () => {
    table();
    const rows = screen.getAllByRole('row');
    expect(within(rows[0]).getAllByRole('columnheader')).toHaveLength(8);
    const cells = within(rows[1]).getAllByRole('cell');
    expect(cells).toHaveLength(8);
    expect(cells[2]).toHaveTextContent('Accesorios');
    expect(cells[3]).toHaveTextContent('15.000');
    expect(cells[3]).toHaveTextContent('18.000');
    expect(cells[4]).toHaveTextContent('8');
    expect(cells[5]).toHaveTextContent('$');
    expect(cells[5]).toHaveTextContent('0');
    expect(cells[5]).not.toHaveTextContent('18.000');
  });
  it('solo lectura no presenta botones de escritura ni seleccion destructiva', () => {
    table();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Sólo lectura')).toBeInTheDocument();
  });
  it('acciones respetan callbacks y columnas sin orden no simulan ser ordenables', () => {
    const edit = vi.fn(), remove = vi.fn(), sort = vi.fn();
    table({ onEdit: edit, onDelete: remove, onSort: sort });
    fireEvent.click(screen.getByRole('button', { name: 'Editar Producto de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Producto de prueba' }));
    expect(edit).toHaveBeenCalledWith('product');
    expect(remove).toHaveBeenCalledWith('product');
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por ganancia' }));
    expect(sort).toHaveBeenCalledWith('margin');
    expect(screen.queryByRole('button', { name: /Ordenar por (estado|categoría|acciones)/ })).not.toBeInTheDocument();
  });
  it('ofrece checkboxes semanticos y bloquea acciones durante una escritura', () => {
    table({ onDelete: vi.fn(), onEdit: vi.fn(), selectedIds: new Set(['product']), busy: true });
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Producto de prueba' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Editar Producto de prueba' })).toBeDisabled();
  });
  it('distingue costo desconocido, cero y stock negativo sin ocultarlo', () => {
    table({ rows: [{ ...product, stock: -2, profit_per_unit_ars: null }] });
    expect(screen.getByText('Sin costo')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('Sin stock')).toBeInTheDocument();
  });
  it('resuelve nombres por slug o id y no expone UUIDs ni roles tecnicos', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(nombreDeCategoria(id, [{ id, slug: 'ropa', name: 'Indumentaria' }])).toBe('Indumentaria');
    expect(nombreDeCategoria(id)).toBe('Categoría no disponible');
    expect(nombreDeCategoria('ropa_de_verano')).toBe('Ropa de verano');
    expect(roleLabel('viewer')).toBe('Sólo lectura');
    expect(roleLabel('owner')).toBe('Propietario');
    expect(roleLabel('unknown_role')).toBe('Sin rol asignado');
  });
});
