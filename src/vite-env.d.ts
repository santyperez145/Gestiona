/// <reference types="vite/client" />

declare const __NERQIA_NATIVE_PLATFORM__: string | null;

// jspdf-autotable adds lastAutoTable to jsPDF at runtime but doesn't declare it
declare module "jspdf" {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}
