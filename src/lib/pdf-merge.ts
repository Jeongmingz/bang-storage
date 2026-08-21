import type { PDFDocument as PDFDocumentType } from "pdf-lib";

export async function mergePdfFiles(files: File[]) {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();

  for (const file of files) {
    let source: PDFDocumentType;
    try {
      source = await PDFDocument.load(await file.arrayBuffer());
    } catch (error) {
      throw new Error(`“${file.name}” 파일을 읽을 수 없어요. 암호가 설정됐거나 손상된 PDF인지 확인해주세요.`, {
        cause: error,
      });
    }

    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return merged.save();
}

export function getPdfDownloadName(value: string) {
  const baseName = value.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?\"<>|]/g, "_");
  return `${baseName || "합친 PDF"}.pdf`;
}
