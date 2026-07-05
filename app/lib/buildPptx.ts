// 슬라이드 플랜 → pptx Buffer. 담백·정적·클린 템플릿(강조색 1개, 장식 최소).
import pptxgen from "pptxgenjs";
import type { DeckPlan, SlideSpec } from "./slidePlan";

type Pptx = InstanceType<typeof pptxgen>;
type Slide = ReturnType<Pptx["addSlide"]>;

// key -> "image/xxx;base64,...." (route가 원본 그림을 fetch해 채움)
export type ImageMap = Record<string, string>;

const NAVY = "13233F";
const INK = "1E293B";
const MUTED = "64748B";
const ACCENT = "0D9488";
const CARD = "F1F5F9";
const WHITE = "FFFFFF";
// 한글이 주력이라 한글 글리프가 있는 폰트 사용(PowerPoint/Windows 기본 탑재). Calibri는 한글이 없어 대체됨.
const F = "Malgun Gothic";

// 본문 영역 세로 경계 — 푸터(y 5.28)를 넘지 않도록 모든 카드/텍스트가 이 안에 들어온다.
const BODY_TOP = 1.72;
const BODY_BOTTOM = 5.14;

// 렌더 폭 기준 클립(전각/한글=2, 그 외=1). for..of로 코드포인트 단위 → 서로게이트 안전.
function clipW(s: string, maxUnits: number): string {
  const t = (s || "").trim();
  let w = 0;
  let out = "";
  for (const ch of t) {
    const wide = /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
    const cw = wide ? 2 : 1;
    if (w + cw > maxUnits) {
      return `${out.replace(/[\s,.;·]+$/, "")}…`;
    }
    out += ch;
    w += cw;
  }
  return out;
}

function footer(s: Slide, page: number): void {
  s.addText("PaperMentor · 논문 발표 슬라이드", {
    x: 0.6, y: 5.28, w: 6, h: 0.25, fontSize: 9, color: MUTED, fontFace: F, margin: 0,
  });
  s.addText(String(page), {
    x: 8.9, y: 5.28, w: 0.5, h: 0.25, align: "right", fontSize: 9, color: MUTED, fontFace: F, margin: 0,
  });
}

function header(s: Slide, spec: SlideSpec): void {
  if (spec.eyebrow) {
    s.addText(spec.eyebrow, {
      x: 0.6, y: 0.42, w: 8.8, h: 0.3, fontSize: 12, bold: true, color: ACCENT, fontFace: F, margin: 0, charSpacing: 1,
    });
  }
  s.addText(clipW(spec.title, 90), {
    x: 0.6, y: spec.eyebrow ? 0.78 : 0.55, w: 8.8, h: 0.72, fontSize: 24, bold: true, color: NAVY, fontFace: F, margin: 0, valign: "middle", fit: "shrink",
  });
}

function titleSlide(p: Pptx, meta: DeckPlan["meta"]): void {
  const s = p.addSlide();
  s.background = { color: WHITE };
  s.addShape(p.ShapeType.ellipse, { x: 0.62, y: 1.15, w: 0.22, h: 0.22, fill: { color: ACCENT } });
  // 긴 의학 논문 제목은 흔하므로 길이에 따라 폰트 티어링(원문 제목을 자르지 않고 그대로 보이게)
  const tlen = Array.from(meta.title).length;
  const tf = tlen <= 90 ? 26 : tlen <= 150 ? 22 : 18;
  s.addText(clipW(meta.title, 340), {
    x: 0.6, y: 1.5, w: 8.8, h: 2.0, fontSize: tf, bold: true, color: NAVY, fontFace: F, valign: "top", margin: 0, lineSpacingMultiple: 1.05, fit: "shrink",
  });
  const metaLine = [meta.journal, meta.date].filter(Boolean).join("  ·  ");
  if (metaLine) {
    s.addText(clipW(metaLine, 160), { x: 0.62, y: 3.7, w: 8.8, h: 0.4, fontSize: 14, color: ACCENT, fontFace: F, margin: 0, fit: "shrink" });
  }
  if (meta.authors.length) {
    const authors = meta.authors.slice(0, 6).join(", ") + (meta.authors.length > 6 ? " 외" : "");
    s.addText(clipW(authors, 170), { x: 0.62, y: 4.15, w: 8.8, h: 0.4, fontSize: 12, color: MUTED, fontFace: F, margin: 0, fit: "shrink" });
  }
  const ids = [meta.pmid ? `PMID ${meta.pmid}` : "", meta.doi ? `DOI ${meta.doi}` : ""].filter(Boolean).join("     ·     ");
  if (ids) {
    s.addText(clipW(ids, 170), { x: 0.62, y: 4.95, w: 8.8, h: 0.3, fontSize: 10.5, color: MUTED, fontFace: F, margin: 0, fit: "shrink" });
  }
}

function bulletsBody(s: Slide, bullets: string[]): void {
  const items = bullets
    .filter(Boolean)
    .slice(0, 5)
    .map((b) => ({ text: clipW(b, 240), options: { bullet: { code: "2022" }, paraSpaceAfter: 10, color: INK } }));
  s.addText(items, {
    x: 0.7, y: BODY_TOP, w: 8.6, h: BODY_BOTTOM - BODY_TOP, fontSize: 14.5, color: INK, fontFace: F, valign: "top", margin: 0, lineSpacingMultiple: 1.08, fit: "shrink",
  });
}

function textBody(s: Slide, text: string): void {
  s.addText(clipW(text, 320), {
    x: 0.7, y: 1.85, w: 8.6, h: 2.9, fontSize: 20, bold: true, color: NAVY, fontFace: F, valign: "middle", margin: 0, lineSpacingMultiple: 1.18, fit: "shrink",
  });
}

function keyFindingsBody(s: Slide, p: Pptx, items: { claim: string; evidence?: string }[]): void {
  const list = items.slice(0, 4);
  const n = list.length || 1;
  const gap = 0.12;
  const step = (BODY_BOTTOM - BODY_TOP) / n;
  const h = Math.min(0.95, step - gap);
  list.forEach((it, i) => {
    const y = BODY_TOP + i * step;
    s.addShape(p.ShapeType.roundRect, { x: 0.6, y, w: 8.8, h, rectRadius: 0.06, fill: { color: CARD } });
    const parts: { text: string; options: object }[] = [
      { text: clipW(it.claim, 110), options: { bold: true, color: NAVY, fontSize: 14, breakLine: true } },
    ];
    if (it.evidence) parts.push({ text: clipW(it.evidence, 100), options: { color: MUTED, fontSize: 10.5 } });
    s.addText(parts, { x: 0.85, y: y + 0.04, w: 8.3, h: h - 0.08, fontFace: F, valign: "middle", margin: 0, lineSpacingMultiple: 1.0, fit: "shrink" });
  });
}

function statsBody(s: Slide, p: Pptx, items: { metric: string; value: string; meaning: string }[]): void {
  const list = items.slice(0, 5);
  const n = list.length || 1;
  const gap = 0.11;
  const step = (BODY_BOTTOM - BODY_TOP) / n;
  const h = Math.min(0.72, step - gap);
  list.forEach((it, i) => {
    const y = BODY_TOP + i * step;
    s.addShape(p.ShapeType.roundRect, { x: 0.6, y, w: 8.8, h, rectRadius: 0.06, fill: { color: CARD } });
    s.addText(clipW(`${it.metric}  ${it.value}`, 44), {
      x: 0.85, y: y + 0.03, w: 3.25, h: h - 0.06, bold: true, color: ACCENT, fontSize: 12.5, fontFace: F, valign: "middle", margin: 0, fit: "shrink",
    });
    s.addText(clipW(it.meaning, 130), {
      x: 4.25, y: y + 0.03, w: 4.9, h: h - 0.06, color: INK, fontSize: 11, fontFace: F, valign: "middle", margin: 0, lineSpacingMultiple: 1.0, fit: "shrink",
    });
  });
}

// base64 data URI(image/xxx;base64,...)에서 원본 픽셀 크기 파싱. PNG·JPEG·GIF 지원. 실패 시 null.
function imageAspect(dataUri: string): { w: number; h: number } | null {
  const i = dataUri.indexOf("base64,");
  if (i === -1) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(dataUri.slice(i + 7), "base64");
  } catch {
    return null;
  }
  if (buf.length < 24) return null;
  // PNG: IHDR의 width/height (big-endian, offset 16/20)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF: offset 6/8 (little-endian)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // JPEG: SOF 마커에서 height/width
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
      }
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) return null;
      off += 2 + len;
    }
  }
  return null;
}

type Box = { x: number; y: number; w: number; h: number };

// 원본 비율을 유지하며 박스 안에 최대 크기로 중앙 배치. 치수 파싱 실패 시 contain 폴백.
function fitImage(
  data: string,
  box: Box,
): Box & { sizing?: { type: "contain"; w: number; h: number } } {
  const dim = imageAspect(data);
  if (!dim || dim.w <= 0 || dim.h <= 0) {
    return { ...box, sizing: { type: "contain", w: box.w, h: box.h } };
  }
  const scale = Math.min(box.w / dim.w, box.h / dim.h);
  const w = dim.w * scale;
  const h = dim.h * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function figureBody(s: Slide, data: string, caption: string, points?: string[]): void {
  if (points && points.length) {
    // AI 재구성: 그림 + 발표용 한국어 설명 불릿(원문 캡션을 담백하게 distill)
    s.addImage({ data, ...fitImage(data, { x: 1.0, y: 1.5, w: 8.0, h: 2.55 }) });
    const items = points.slice(0, 3).map((b) => ({
      text: clipW(b, 220),
      options: { bullet: { code: "2022" }, paraSpaceAfter: 6, color: INK },
    }));
    s.addText(items, {
      x: 0.7, y: 4.16, w: 8.6, h: BODY_BOTTOM - 4.16, fontSize: 12.5, color: INK, fontFace: F, valign: "top", margin: 0, lineSpacingMultiple: 1.05, fit: "shrink",
    });
  } else {
    // 설명 없음(compose 조립 등) → 원본 캡션을 넉넉히
    s.addImage({ data, ...fitImage(data, { x: 0.9, y: 1.55, w: 8.2, h: 2.95 }) });
    if (caption) {
      s.addText(clipW(caption, 360), {
        x: 0.7, y: 4.6, w: 8.6, h: BODY_BOTTOM - 4.6, fontSize: 10.5, color: MUTED, fontFace: F, valign: "top", margin: 0, lineSpacingMultiple: 1.03, fit: "shrink",
      });
    }
  }
}

function contentSlide(p: Pptx, spec: SlideSpec, page: number, images: ImageMap): void {
  const s = p.addSlide();
  s.background = { color: WHITE };
  header(s, spec);
  const body = spec.body;
  if (body) {
    if (body.kind === "bullets") bulletsBody(s, body.bullets);
    else if (body.kind === "text") textBody(s, body.text);
    else if (body.kind === "keyFindings") keyFindingsBody(s, p, body.items);
    else if (body.kind === "stats") statsBody(s, p, body.items);
    else if (body.kind === "figure") {
      const data = images[body.imageKey];
      if (data) figureBody(s, data, body.caption, body.points);
    }
  }
  footer(s, page);
}

export async function buildPptxBuffer(plan: DeckPlan, images: ImageMap): Promise<Buffer> {
  const p = new pptxgen();
  p.layout = "LAYOUT_16x9";
  p.author = "PaperMentor";
  p.title = clipW(plan.meta.title, 120);

  titleSlide(p, plan.meta);
  plan.slides.forEach((spec, i) => contentSlide(p, spec, i + 2, images));

  const buf = (await p.write({ outputType: "nodebuffer" })) as Buffer;
  return buf;
}
