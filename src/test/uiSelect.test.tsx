import { describe, it, expect, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * El Select propio reemplazó a Radix en el refactor cockpit. Estas pruebas
 * fijan el contrato de accesibilidad y comportamiento que un combobox debe
 * cumplir: teclado, cierre por afuera/Escape, semántica ARIA y etiqueta legible.
 */
function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Select value={value} onValueChange={(v) => { setValue(v); onChange?.(v); }}>
      <SelectTrigger>
        <SelectValue placeholder="Elegí un tono" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="info">Información</SelectItem>
        <SelectItem value="maintenance">Mantenimiento</SelectItem>
        <SelectItem value="warning">Importante</SelectItem>
        <SelectItem value="success" disabled>Novedad</SelectItem>
      </SelectContent>
    </Select>
  );
}

const optionByText = (text: string) =>
  screen.getByText(text).closest('[role="option"]') as HTMLElement;

interface Option {
  value: string;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
}

function OptionsHarness({ value, defaultValue, options, onChange }: {
  value?: string;
  defaultValue?: string;
  options: Option[];
  onChange?: (value: string) => void;
}) {
  return (
    <Select value={value} defaultValue={defaultValue} onValueChange={onChange}>
      <SelectTrigger aria-label="Cuenta">
        <SelectValue placeholder="Elegir cuenta" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <>{options.map(option => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled} textValue={option.textValue}>
              {option.label}
            </SelectItem>
          ))}</>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

describe("ui/Select accesible", () => {
  it("expone semántica de combobox y arranca cerrado", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("abre al hacer click y cierra al hacer click afuera", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("elige una opción, avisa el valor y muestra su etiqueta legible", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.pointerDown(optionByText("Información"));
    expect(onChange).toHaveBeenCalledWith("info");
    // El trigger muestra la etiqueta ("Información"), no el valor crudo ("info").
    expect(trigger).toHaveTextContent("Información");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("navega con flechas y confirma con Enter, salteando deshabilitadas", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // abre, resalta la primera (info)
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // -> maintenance
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("maintenance");
  });

  it("Escape cierra y no elige nada", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typeahead resalta la opción por su texto", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "m" });
    expect(optionByText("Mantenimiento")).toHaveAttribute("data-highlighted");
  });

  it("una opción deshabilitada no se puede elegir", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.pointerDown(optionByText("Novedad"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resolves a persisted identifier before the listbox has ever opened', () => {
    const value = '11111111-1111-4111-8111-111111111111';
    const onChange = vi.fn();
    render(<OptionsHarness value={value} options={[{ value, label: 'Cuenta principal' }]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Cuenta principal');
    expect(trigger).not.toHaveTextContent(value);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resolves a default value without turning it into a controlled selection', () => {
    const onChange = vi.fn();
    render(<OptionsHarness defaultValue="maintenance" options={[
      { value: 'maintenance', label: 'Mantenimiento' }, { value: 'info', label: 'Informacion' },
    ]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Mantenimiento');
    fireEvent.click(trigger);
    fireEvent.pointerDown(optionByText('Informacion'));
    expect(trigger).toHaveTextContent('Informacion');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('info');
  });

  it('resolves grouped JSX labels and excludes decorative hidden text', () => {
    render(<OptionsHarness value="main" options={[{ value: 'main', label: <>
      <span aria-hidden="true">internal_badge</span><strong>Sucursal Centro</strong>{' (principal)'}
    </> }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Sucursal Centro (principal)');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('internal_badge');
  });

  it('uses explicit textValue for labels rendered by opaque components', () => {
    function AccountName() { return <span>Cuenta bancaria</span>; }
    render(<OptionsHarness value="bank_account" options={[
      { value: 'bank_account', label: <AccountName />, textValue: 'Cuenta bancaria' },
    ]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Cuenta bancaria');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('bank_account');
  });

  it('keeps numeric zero as readable text', () => {
    render(<OptionsHarness value="zero" options={[{ value: 'zero', label: 0 }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('0');
  });

  it('resolves late options without exposing or changing the persisted value', () => {
    const value = '22222222-2222-4222-8222-222222222222';
    const onChange = vi.fn();
    const { rerender } = render(<OptionsHarness value={value} options={[]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Selección no disponible');
    expect(trigger).not.toHaveTextContent(value);
    rerender(<OptionsHarness value={value} options={[{ value, label: 'Cuenta validada' }]} onChange={onChange} />);
    expect(trigger).toHaveTextContent('Cuenta validada');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not retain a label for an option removed from the current context', () => {
    const { rerender } = render(<OptionsHarness value="old" options={[{ value: 'old', label: 'Otra organizacion' }]} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    rerender(<OptionsHarness value="old" options={[{ value: 'new', label: 'Cuenta actual' }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Selección no disponible');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('Otra organizacion');
  });

  it('updates labels while closed after an option is renamed', () => {
    const { rerender } = render(<OptionsHarness value="account" options={[{ value: 'account', label: 'Nombre anterior' }]} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    rerender(<OptionsHarness value="account" options={[{ value: 'account', label: 'Nombre actual' }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Nombre actual');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('Nombre anterior');
  });

  it.each(['__proto__', 'constructor', 'toString'])('handles %s as a value, not an object property', value => {
    render(<OptionsHarness value={value} options={[{ value, label: 'Opcion visible' }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Opcion visible');
  });

  it('does not emit a removed option after the list changes while open', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OptionsHarness value="old" options={[{ value: 'old', label: 'Anterior' }]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    rerender(<OptionsHarness value="old" options={[{ value: 'new', label: 'Actual' }]} onChange={onChange} />);
    const activeId = trigger.getAttribute('aria-activedescendant');
    expect(document.getElementById(activeId!)).toHaveTextContent('Actual');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('new');
  });

  it('does not emit a disabled option after its availability changes', () => {
    const onChange = vi.fn();
    const initial = [{ value: 'old', label: 'Anterior' }, { value: 'new', label: 'Actual' }];
    const { rerender } = render(<OptionsHarness value="old" options={initial} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    rerender(<OptionsHarness value="old" options={[{ ...initial[0], disabled: true }, initial[1]]} onChange={onChange} />);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('new');
  });

  it('does not commit a stale highlight when every option disappears', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OptionsHarness value="old" options={[{ value: 'old', label: 'Anterior' }]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    rerender(<OptionsHarness value="old" options={[]} onChange={onChange} />);
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives distinct active option IDs to values that differ by punctuation', () => {
    render(<OptionsHarness options={[
      { value: 'bank:main', label: 'Cuenta uno' }, { value: 'bank_main', label: 'Cuenta dos' },
    ]} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const [first, last] = screen.getAllByRole('option');
    expect(first.id).not.toBe(last.id);
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(trigger).toHaveAttribute('aria-activedescendant', last.id);
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(trigger).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('typeahead uses the readable label instead of hidden decorations or internal values', () => {
    const onChange = vi.fn();
    render(<OptionsHarness options={[
      { value: 'first', label: 'Banco' },
      { value: 'payment_account', label: <><span aria-hidden="true">internal_badge</span>Cuenta</> },
    ]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'c' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('payment_account');
    expect(trigger).toHaveTextContent('Cuenta');
    expect(trigger).toHaveFocus();
  });

  it('keeps the popup anchored inside the viewport when the trigger is near its edge', () => {
    render(<OptionsHarness value="account" options={[{ value: 'account', label: 'Cuenta' }]} />);
    const trigger = screen.getByRole('combobox');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: window.innerWidth - 30, y: 40, left: window.innerWidth - 30, top: 40,
      width: 100, height: 40, right: window.innerWidth + 70, bottom: 80, toJSON: () => ({}),
    });
    fireEvent.click(trigger);
    const popup = screen.getByRole('listbox');
    const left = Number.parseFloat(popup.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + Number.parseFloat(popup.style.maxWidth)).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(popup).toHaveStyle({ minWidth: '100px' });
  });

  it('Escape closes only the select inside a dialog and returns focus to its trigger', () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Formulario</DialogTitle>
        <DialogDescription>Elegir cuenta</DialogDescription>
        <OptionsHarness value="account" options={[{ value: 'account', label: 'Cuenta' }]} />
      </DialogContent>
    </Dialog>);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('gives the open listbox the accessible label of its trigger', () => {
    render(<OptionsHarness value="account" options={[{ value: 'account', label: 'Cuenta principal' }]} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAccessibleName('Cuenta');
    expect(listbox).toHaveAttribute('aria-label', 'Cuenta');
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
  });

  it('names the listbox from a native form label', () => {
    render(<>
      <label htmlFor="native-account">Cuenta bancaria</label>
      <Select value="bank">
        <SelectTrigger id="native-account"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="bank">Banco</SelectItem></SelectContent>
      </Select>
    </>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Cuenta bancaria' }));
    expect(screen.getByRole('listbox')).toHaveAccessibleName('Cuenta bancaria');
  });

  it('preserves an external aria-labelledby label on the listbox', () => {
    render(<>
      <span id="payment-label">Medio de cobro</span>
      <Select value="bank">
        <SelectTrigger aria-labelledby="payment-label"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="bank">Banco</SelectItem></SelectContent>
      </Select>
    </>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Medio de cobro' }));
    expect(screen.getByRole('listbox')).toHaveAccessibleName('Medio de cobro');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-labelledby', 'payment-label');
  });
});
