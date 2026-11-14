// PDF text extraction for document ingestion. pdf-parse wraps pdfjs and runs purely in Node —
// no browser/Chromium. Scanned/image-only PDFs yield little/no text (handled by the caller's
// minimum-length check). Bounded output so a huge PDF can't blow up the model prompt.
import pdfParse from 'pdf-parse';

const MAX_CHARS = 60_000;

export interface PdfExtract {
  text: string;
  pages: number;
  title?: string;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtract> {
  const data = await pdfParse(buffer);
  const text = (data.text || '').replace(/\u0000/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = typeof data.info?.Title === 'string' ? (data.info.Title as string) : undefined;
  return { text: text.slice(0, MAX_CHARS), pages: data.numpages || 0, title };
}
