import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

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
});
