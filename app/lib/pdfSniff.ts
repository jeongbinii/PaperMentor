"use client";

// 큰 PDF(서버 업로드 한도 4.5MB 초과)는 서버로 보낼 수 없다. 대신 앞 1~2페이지 텍스트에서
// 논문 식별자(PMCID·DOI·PMID)를 뽑아 기존 식별자→PMC 경로(/api/pubmed)로 넘긴다.
// react-pdf(pdf.js)는 브라우저 전용 → 호출 시점에 동적 import(SSR 안전).
export async function sniffPdfIdentifier(file: File): Promise<string | null> {
  try {
    const { pdfjs } = await import("react-pdf");
    // PdfViewer와 동일한 워커(public/pdf.worker.min.mjs)
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const data = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    const pageCount = Math.min(2, doc.numPages);

    let text = "";
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      text +=
        " " +
        tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    }
    await doc.destroy();

    // 우선순위: PMCID > DOI > (라벨 있는) PMID
    const pmcid = text.match(/\bPMC\s?\d{5,9}\b/i)?.[0];
    if (pmcid) return pmcid.replace(/\s/g, "").toUpperCase();

    const doi = text
      .match(/10\.\d{4,9}\/[A-Za-z0-9._;()/:-]+/)?.[0]
      ?.replace(/[.,;:]+$/, "");
    if (doi) return doi;

    const pmid = text.match(/PMID\s*:?\s*(\d{5,9})/i)?.[1];
    if (pmid) return pmid;

    return null;
  } catch {
    return null;
  }
}
