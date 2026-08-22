import { FileCheck2, FileLock2, FileSearch2, ShieldCheck } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';

const STAGES = [
  { icon: FileLock2, title: 'Original privado', detail: 'Bucket privado, hash SHA-256 y archivo inmutable.' },
  { icon: ShieldCheck, title: 'Inspección', detail: 'MIME real, tamaño, malware y cuarentena antes del OCR.' },
  { icon: FileSearch2, title: 'Extracción revisable', detail: 'Campos versionados, confianza por campo y validación matemática.' },
  { icon: FileCheck2, title: 'Borradores aprobables', detail: 'Compra, factura de proveedor y obligación sin efectos prematuros.' },
];

export default function FinanceDocumentsPage() {
  usePageTitle('Documentos · Finance');
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-300">Document Inbox</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Cadena de custodia antes que OCR</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">La bandeja segura es el siguiente slice. Esta pantalla fija el contrato que debe cumplir: capturar no equivale a contabilizar.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {STAGES.map((stage, index) => (
          <article key={stage.title} className="rounded-[12px] border border-border/70 bg-card p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-300"><stage.icon className="h-4 w-4" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Etapa {index + 1}</p><h2 className="mt-1 text-sm font-semibold">{stage.title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.detail}</p></div>
            </div>
          </article>
        ))}
      </div>

      <div className="rounded-[10px] border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
        Estado actual: diseño y autoridad de acceso cerrados. Todavía no se aceptan archivos en esta superficie; el cargador OCR anterior permanece en Compras hasta que pueda migrarse sin perder funcionalidad.
      </div>
    </div>
  );
}
