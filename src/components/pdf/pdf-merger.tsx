"use client";

import { useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FilePlus2Icon,
  FilesIcon,
  GripVerticalIcon,
  LoaderCircleIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPdfDownloadName, mergePdfFiles } from "@/lib/pdf-merge";

type PdfItem = { id: string; file: File };

function formatSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(size / 1024)} KB`;
}

export function PdfMerger() {
  const [files, setFiles] = useState<PdfItem[]>([]);
  const [outputName, setOutputName] = useState("합친 PDF");
  const [isMerging, setIsMerging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const pdfs = Array.from(selected).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) {
      toast.error("PDF 파일만 추가할 수 있어요.");
      return;
    }
    setFiles((current) => [...current, ...pdfs.map((file) => ({ id: crypto.randomUUID(), file }))]);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= files.length) return;
    setFiles((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const mergeFiles = async () => {
    setIsMerging(true);
    try {
      const bytes = await mergePdfFiles(files.map((item) => item.file));
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getPdfDownloadName(outputName);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success("PDF를 합쳐서 다운로드했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF를 합치지 못했어요.");
    } finally {
      setIsMerging(false);
    }
  };

  const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-card">
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
        <section className="bang-animate-panel flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-[#ffe4f1] px-2.5 py-1 text-[11px] font-semibold text-[#9d174d] dark:bg-[#4a1830] dark:text-[#f9a8d4]">브라우저에서 안전하게</span>
              <span className="text-xs text-muted-foreground">파일은 서버에 올라가지 않아요</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">PDF 합치기</h1>
            <p className="mt-2 text-sm text-muted-foreground">PDF를 원하는 순서로 놓고 하나의 파일로 정리해요.</p>
          </div>
          <Button className="gap-2" onClick={() => inputRef.current?.click()}>
            <FilePlus2Icon className="size-4" />
            PDF 추가
          </Button>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 rounded-xl border border-border bg-background/50 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">합칠 순서</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">위에서 아래 순서로 합쳐져요.</p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{files.length}개</span>
            </div>

            {files.length > 0 ? (
              <div className="space-y-2">
                {files.map((item, index) => (
                  <div key={item.id} className="bang-animate-row group flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 shadow-sm sm:gap-3">
                    <GripVerticalIcon className="hidden size-4 shrink-0 text-muted-foreground/50 sm:block" />
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#fff0f6] text-xs font-bold text-[#be185d] dark:bg-[#3b1628] dark:text-[#f9a8d4]">PDF</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.file.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
                    </div>
                    <span className="hidden rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground sm:inline">{String(index + 1).padStart(2, "0")}</span>
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon-sm" aria-label={`${item.file.name} 위로`} disabled={isMerging || index === 0} onClick={() => moveFile(index, -1)}><ArrowUpIcon className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${item.file.name} 아래로`} disabled={isMerging || index === files.length - 1} onClick={() => moveFile(index, 1)}><ArrowDownIcon className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`${item.file.name} 삭제`} disabled={isMerging} onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))}><Trash2Icon className="size-3.5" /></Button>
                    </div>
                  </div>
                ))}
                <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-sm text-muted-foreground transition-colors hover:border-[#f472b6] hover:bg-[#fff7fb] hover:text-foreground dark:hover:bg-[#321924]" onClick={() => inputRef.current?.click()}>
                  <FilePlus2Icon className="size-4" /> 다른 PDF 더하기
                </button>
              </div>
            ) : (
              <button type="button" className="flex min-h-72 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center hover:border-[#f472b6]" onClick={() => inputRef.current?.click()}>
                <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-[#ffe4f1] text-[#be185d] dark:bg-[#4a1830] dark:text-[#f9a8d4]"><FilePlus2Icon className="size-5" /></div>
                <p className="text-sm font-medium">PDF 파일을 골라주세요</p>
                <p className="mt-1 text-xs text-muted-foreground">여러 개를 한 번에 선택할 수 있어요.</p>
              </button>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-border bg-card p-4 shadow-sm lg:sticky lg:top-8">
            <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-[#ffe4f1] text-[#be185d] dark:bg-[#4a1830] dark:text-[#f9a8d4]"><FilesIcon className="size-5" /></div>
            <h2 className="text-lg font-semibold">하나로 정리할게요</h2>
            <div className="mt-4 space-y-4">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="pdf-output-name">결과 파일 이름</label>
              <div className="relative"><Input id="pdf-output-name" value={outputName} onChange={(event) => setOutputName(event.target.value)} className="pr-12" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">.pdf</span></div>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">파일</p><p className="mt-1 font-mono">{files.length}개</p></div>
                <div><p className="text-xs text-muted-foreground">예상 용량</p><p className="mt-1 font-mono">{formatSize(totalSize)}</p></div>
              </div>
              <Button className="w-full gap-2 bg-[#db2777] text-white hover:bg-[#be185d]" disabled={files.length < 2 || !outputName.trim() || isMerging} onClick={mergeFiles}>
                {isMerging ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                {isMerging ? "PDF 합치는 중…" : "PDF 합치기"}
              </Button>
              <p className="text-center text-[11px] leading-4 text-muted-foreground">선택한 파일은 이 브라우저 안에서만 처리돼요.</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
