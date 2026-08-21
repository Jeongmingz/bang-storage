import Link from "next/link";
import { FilesIcon, FolderIcon } from "lucide-react";

import { PasswordGate } from "@/components/storage/password-gate";
import { PdfMerger } from "@/components/pdf/pdf-merger";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PdfPage() {
  if (!(await isAuthenticated())) return <PasswordGate />;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-sidebar sm:flex">
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex size-6 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">B</div>
          <span className="text-sm font-semibold">Bang Storage</span>
        </div>
        <nav className="mt-4 space-y-0.5 px-2">
          <Link href="/" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <FolderIcon className="size-4" /> 스토리지
          </Link>
          <div className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm">
            <FilesIcon className="size-4" /> PDF 합치기
          </div>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:hidden">
          <Link href="/" className="rounded-md px-2 py-1 text-sm text-muted-foreground">스토리지</Link>
          <span className="rounded-md bg-primary px-2 py-1 text-sm text-primary-foreground">PDF</span>
        </header>
        <PdfMerger />
      </div>
    </div>
  );
}
