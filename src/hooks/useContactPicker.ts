/**
 * useContactPicker — Contact Picker API hook.
 *
 * Opens the device's native contact picker to import customer data
 * directly from the phone's address book. Zero typing required.
 *
 * Browser support: Chrome Android 80+, Samsung Internet 11.5+.
 * Desktop Chrome/Edge/Firefox/Safari: returns `supported = false`,
 * the UI should hide or disable the button.
 *
 * Features:
 *   - Pick name, phone, email from native address book
 *   - Returns structured ContactData (name, tel, email)
 *   - Supports multi-select when allowed
 *
 * Usage:
 *   const { pick, supported } = useContactPicker();
 *
 *   const contact = await pick();
 *   if (contact) {
 *     setName(contact.name);
 *     setPhone(contact.phone ?? "");
 *     setEmail(contact.email ?? "");
 *   }
 */
import { useCallback, useState } from "react";

export interface ContactData {
  name: string;
  phone: string | null;
  email: string | null;
}

interface UseContactPickerReturn {
  /** Whether the Contact Picker API is available */
  supported: boolean;
  /** Whether a pick is in progress */
  picking: boolean;
  /**
   * Open the contact picker and return the selected contact.
   * Returns null if user cancels or the API is unavailable.
   */
  pick: (multiple?: boolean) => Promise<ContactData[] | null>;
}

const supported =
  typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;

export function useContactPicker(): UseContactPickerReturn {
  const [picking, setPicking] = useState(false);

  const pick = useCallback(async (multiple = false): Promise<ContactData[] | null> => {
    if (!supported) return null;
    setPicking(true);
    try {
      const contacts: any[] = await (navigator as any).contacts.select(
        ["name", "tel", "email"],
        { multiple }
      );
      if (!contacts || contacts.length === 0) return null;
      return contacts.map((c: any) => ({
        name: (c.name?.[0] ?? "").trim(),
        phone: c.tel?.[0]?.trim() || null,
        email: c.email?.[0]?.trim() || null,
      }));
    } catch {
      return null;
    } finally {
      setPicking(false);
    }
  }, []);

  return { supported, picking, pick };
}
