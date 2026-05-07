/// <reference types="vite/client" />

// jspdf-autotable adds lastAutoTable to jsPDF at runtime but doesn't declare it
declare module "jspdf" {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}
