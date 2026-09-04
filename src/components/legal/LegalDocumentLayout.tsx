import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, type LucideIcon } from "lucide-react";
import BrandLogo from "@/components/shared/BrandLogo";

interface LegalDocumentLayoutProps {
  title: string;
  updatedLabel: string;
  version: string;
  icon: LucideIcon;
  children: ReactNode;
}

export function LegalDocumentLayout({
  title,
  updatedLabel,
  version,
  icon: Icon,
  children,
}: LegalDocumentLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <BrandLogo markClassName="h-6 w-6" nameClassName="text-sm" />
          </Link>
          <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Versión {version}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-16">
        <div className="mb-10 border-b border-border/70 pb-8">
          <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Última actualización: {updatedLabel}</p>
        </div>

        <div className="space-y-9">{children}</div>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-3" aria-label="Documentos legales">
          <Link to="/privacidad" className="min-h-11 content-center hover:text-foreground">Privacidad</Link>
          <Link to="/terminos" className="min-h-11 content-center hover:text-foreground">Términos</Link>
          <Link to="/estado" className="min-h-11 content-center hover:text-foreground">Estado del servicio</Link>
          <Link to="/" className="min-h-11 content-center hover:text-foreground">Volver a Nerqia</Link>
        </nav>
      </footer>
    </div>
  );
}

export function LegalIdentityNotice() {
  return (
    <aside className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-5" role="note">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Identificación del prestador pendiente</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Antes del lanzamiento comercial deben incorporarse la razón social, CUIT y domicilio del prestador,
            junto con la revisión profesional de estos documentos. Nerqia no inventa esos datos ni presenta este
            texto como una homologación legal.
          </p>
        </div>
      </div>
    </aside>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}
