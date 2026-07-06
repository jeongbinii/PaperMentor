import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Vercel 함수 실행 상한(초). 플랜 한도: Hobby=60, Pro=최대 300.
// Gemini Pro가 느리게라도 이미지를 끝까지 반환하도록 최대한 넉넉히 잡는다.
// Pro 플랜이면 이 값을 120~180으로 올리면 아래 타임아웃도 자동으로 함께 늘어난다.
export const maxDuration = 60;

// 이미지 생성 제공자: 환경변수에 있는 키로 자동 선택 (OpenAI 우선, 없으면 Gemini).
// 모델은 OPENAI_IMAGE_MODEL / GEMINI_IMAGE_MODEL 로 교체 가능.
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_SIZE = process.env.OPENAI_IMAGE_SIZE || "1536x1024"; // 가로형 (graphical abstract)
const OPENAI_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium"; // low | medium | high
// 한글 텍스트 품질이 좋은 상위 이미지 모델(Nano Banana Pro). 비용↑이나 결과물 차원이 다름.
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
// Gemini 1회 시도 제한(ms). 행(무한 대기)만 막고 나머지는 최대한 기다려준다.
// maxDuration에서 응답 파싱·네트워크 여유(5s)만 남기고 전부 이미지 생성에 쓴다
// (기존 30s → 55s). Pro가 느려도 끝까지 반환하면 잘라내지 않게. env로 상한 조정 가능.
const GEMINI_TIMEOUT_MS =
  Number(process.env.GEMINI_IMAGE_TIMEOUT_MS) || (maxDuration - 5) * 1000;
// 위 예산(GEMINI_TIMEOUT_MS) 안에서 최대 몇 번까지 재시도할지.
// Pro의 "HTTP200 빈 이미지"·혼잡 같은 일시 실패는 즉시 나므로, 시간이 남는 한
// 같은 3.0 Pro로 다시 찔러본다(다른 모델 폴백 아님). Hobby(60s 상한)에서 가장 효과적.
const GEMINI_MAX_ATTEMPTS = Number(process.env.GEMINI_IMAGE_MAX_ATTEMPTS) || 4;
const GEMINI_RETRY_BACKOFF_MS = 800;

// UI에서 선택 가능한 이미지 모델/품질 화이트리스트(임의 값 차단). 목록 밖이면 기본값 사용.
const GEMINI_MODELS = ["gemini-3-pro-image", "gemini-2.5-flash-image"];
const OPENAI_MODELS = ["gpt-image-1"];
const OPENAI_QUALITIES = ["low", "medium", "high", "auto"];
// Replicate 모델: flux(기본), ideogram(텍스트 특화). env로 교체 가능.
const FLUX_MODEL = process.env.REPLICATE_MODEL || "black-forest-labs/flux-1.1-pro";
const IDEOGRAM_MODEL =
  process.env.REPLICATE_IDEOGRAM_MODEL || "ideogram-ai/ideogram-v3-turbo";

// provider 라벨(사용자용) → 사용 가능 여부는 키 존재로 결정
export type ImageProvider = "gemini" | "openai" | "flux" | "ideogram";

type KeyFinding = { claim?: string; evidence?: string };

// labelLang: 그림에 렌더링할 라벨 언어. "ko"=Gemini(한글 렌더링 우수),
// "en"=GPT 등(한글이 깨지는 모델 → 영어 라벨로 우회).
function buildPrompt(
  body: {
    title?: string;
    keyFindings?: KeyFinding[];
    methods?: string;
    results?: string;
    conclusion?: string;
  },
  labelLang: "ko" | "en",
): string {
  const { title, keyFindings, methods, results, conclusion } = body;
  const kf = Array.isArray(keyFindings)
    ? keyFindings
        .map(
          (f, i) =>
            `${i + 1}. ${f.claim ?? ""}${f.evidence ? `\n   - 근거: ${f.evidence}` : ""}`,
        )
        .join("\n")
    : "";
  const paperText = [
    title ? `제목: ${title}` : "",
    kf ? `핵심 결과:\n${kf}` : "",
    methods ? `연구 방법: ${methods}` : "",
    results ? `주요 결과: ${results}` : "",
    conclusion ? `결론: ${conclusion}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (labelLang === "en") {
    // 원문 데이터는 한글이므로, 라벨은 영어로 번역해 그리라고 명시(한글 렌더링 깨짐 회피).
    return `${paperText}

Create a single graphical-abstract style summary image that captures the content above at a glance. The source text is in Korean — translate any labels you draw into clear, correctly spelled English. Draw the image itself, not explanatory prose.

[Style rules]
- Use restrained color. Realistic coloring of organs, cells, patient groups, or devices is allowed, but do not add colorful highlights merely for emphasis; keep backgrounds, shapes, and arrows mostly white, gray, and one or two pale tones.
- Never put a journal name ("NEJM" etc.) or watermark text such as "graphical abstract" in the image.
- All labels and text must be in clear, correctly spelled English, kept to the necessary minimum. Do not render any Korean characters.`;
  }

  return `${paperText}

위 내용을 한눈에 들어오도록 정리한 시각화 요약 이미지를 한 장 생성해줘. 설명 텍스트 말고 이미지를 직접 그려줘.

[스타일 규칙]
- 색은 절제해서 써. 장기·세포·환자군·기기 등 대상을 사실적으로 나타내기 위한 채색은 허용하되, 단순히 강조하려고 알록달록하게 칠하지 마. 배경·도형·화살표는 흰색과 회색, 옅은 한두 가지 색조 위주로.
- 저널 이름("NEJM" 등)이나 "graphical abstract"·"그래피컬 초록" 같은 제목/워터마크 문구를 이미지에 절대 넣지 마.
- 라벨과 텍스트는 모두 한글로, 꼭 필요한 최소한만.`;
}

// ── OpenAI gpt-image-1 ─────────────────────────────────────────────
async function generateOpenAI(
  apiKey: string,
  prompt: string,
  model: string,
  quality: string,
) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size: OPENAI_SIZE,
      quality,
      n: 1,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI API 오류 (${res.status})`;
    return { error: msg, status: res.status };
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) return { error: "OpenAI가 이미지를 반환하지 않았습니다.", status: 502 };
  return { image: `data:image/png;base64,${b64}` };
}

// ── Google Gemini ──────────────────────────────────────────────────
// transient=true 인 에러는 예산 안에서 재시도 신호로 쓴다(혼잡·시간초과·빈 응답).
type GenResult =
  | { image: string; note?: string }
  | { error: string; status: number; transient?: boolean; note?: string };

// 1회 시도. timeoutMs 안에 응답이 없으면 abort → transient 에러.
async function generateGeminiOnce(
  apiKey: string,
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<GenResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: ctrl.signal,
    });
  } catch {
    // abort(시간초과) 또는 네트워크 오류 → 재시도 대상
    return {
      error: `Gemini(${model}) 응답이 ${Math.round(timeoutMs / 1000)}초 내 오지 않았습니다.`,
      status: 504,
      transient: true,
    };
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini API 오류 (${res.status})`;
    // 혼잡·게이트웨이·일시장애는 재시도
    const transient = [429, 500, 502, 503, 504].includes(res.status);
    return { error: msg, status: res.status, transient };
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  let image = "";
  let note = "";
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType ?? inline.mime_type ?? "image/png";
      image = `data:${mime};base64,${inline.data}`;
    } else if (typeof p.text === "string") {
      note += p.text;
    }
  }
  if (!image)
    return {
      // HTTP 200인데 이미지가 없는 케이스(Pro 서빙 불안정 시 잦음) — 재시도 대상.
      error:
        "Gemini가 이미지를 반환하지 않았습니다. 모델 ID(GEMINI_IMAGE_MODEL)를 확인하세요.",
      status: 502,
      transient: true,
      note,
    };
  return { image, note };
}

// 데드라인(GEMINI_TIMEOUT_MS) 예산 안에서 같은 3.0 Pro를 재시도한다(폴백 아님).
// - 성공하면 즉시 반환.
// - "빈 이미지·혼잡·시간초과" 같은 일시 실패는 시간이 남는 한 다시 시도(빈 응답은 즉시
//   나므로 55초 안에 여러 번 가능 → 성공 확률↑). Hobby(60s 상한)에서 타임아웃 연장 대신 쓰는 지렛대.
// - 단일 시도가 오래 걸려도(느리게라도 완성되는 경우) 예산을 다 쓰도록 남은 시간을 통째로 준다.
// - 잘못된 모델 ID 등 하드 에러(transient=false)면 재시도 없이 그대로 반환.
async function generateGemini(
  apiKey: string,
  prompt: string,
  model: string,
): Promise<GenResult> {
  const deadline = Date.now() + GEMINI_TIMEOUT_MS;
  let last: GenResult = {
    error: "Gemini 요청을 시작하지 못했습니다.",
    status: 500,
    transient: true,
  };
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 3000) break; // 남은 시간이 너무 적으면 무의미한 시도 중단
    last = await generateGeminiOnce(apiKey, prompt, model, remaining);
    if ("image" in last) return last; // 성공
    if (!last.transient) return last; // 하드 에러 → 재시도 무의미
    // 일시 실패 → 시간이 남을 때만 짧은 백오프 후 재시도
    if (Date.now() + GEMINI_RETRY_BACKOFF_MS < deadline) {
      await new Promise((r) => setTimeout(r, GEMINI_RETRY_BACKOFF_MS));
    }
  }
  return last;
}

// ── Replicate (Flux / Ideogram 등, 인증 불필요한 결제) ──────────────
async function generateReplicate(token: string, prompt: string, model: string) {
  const create = await fetch(
    `https://api.replicate.com/v1/models/${model}/predictions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: { prompt, aspect_ratio: "3:2" },
      }),
    },
  );
  let pred = await create.json();
  if (!create.ok) {
    const msg =
      pred?.detail || pred?.error || `Replicate API 오류 (${create.status})`;
    return { error: msg, status: create.status };
  }
  // 비동기 모델이면 완료까지 폴링
  let tries = 0;
  const terminal = ["succeeded", "failed", "canceled"];
  while (pred?.status && !terminal.includes(pred.status) && tries < 45) {
    await new Promise((r) => setTimeout(r, 2000));
    const getUrl = pred?.urls?.get;
    if (!getUrl) break;
    const g = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    pred = await g.json();
    tries++;
  }
  if (pred?.status !== "succeeded") {
    return {
      error: pred?.error || `이미지 생성 실패 (status: ${pred?.status})`,
      status: 502,
    };
  }
  const out = pred.output;
  const imgUrl = Array.isArray(out) ? out[0] : out;
  if (!imgUrl || typeof imgUrl !== "string") {
    return { error: "Replicate가 이미지 URL을 반환하지 않았습니다.", status: 502 };
  }
  const imgRes = await fetch(imgUrl);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get("content-type") || "image/png";
  return { image: `data:${mime};base64,${buf.toString("base64")}` };
}

export async function POST(request: Request) {
  try {
    const replicateKey = process.env.REPLICATE_API_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!replicateKey && !openaiKey && !geminiKey) {
      return NextResponse.json(
        {
          error:
            "이미지 생성 키가 없습니다. .env.local에 GEMINI_API_KEY / OPENAI_API_KEY / REPLICATE_API_TOKEN 중 하나 이상을 추가한 뒤 서버를 재시작하세요.",
        },
        { status: 400 },
      );
    }

    const body = await request.json();

    // 요청한 provider (없으면 자동: gemini→openai→flux 순으로 가능한 것)
    const requested = typeof body.provider === "string" ? body.provider : "";
    const provider: ImageProvider = (
      requested ||
      (geminiKey ? "gemini" : openaiKey ? "openai" : "flux")
    ) as ImageProvider;

    // 한글 렌더링이 우수한 Gemini만 한글 라벨, 나머지(GPT 등)는 영어 라벨로 우회.
    const prompt = buildPrompt(body, provider === "gemini" ? "ko" : "en");

    // UI에서 지정한 모델/품질(화이트리스트 검증, 없으면 기본값).
    const reqModel = typeof body.model === "string" ? body.model : "";
    const reqQuality = typeof body.quality === "string" ? body.quality : "";

    const keyMissing = (label: string) =>
      NextResponse.json(
        { error: `${label} 키가 .env.local에 없습니다. 추가 후 서버를 재시작하세요.` },
        { status: 400 },
      );

    let result;
    if (provider === "gemini") {
      if (!geminiKey) return keyMissing("GEMINI_API_KEY");
      // 자동 폴백 없음 — 사용자가 고른(또는 기본 3.0 Pro) Gemini 모델만 사용.
      const model = GEMINI_MODELS.includes(reqModel) ? reqModel : GEMINI_MODEL;
      result = await generateGemini(geminiKey, prompt, model);
    } else if (provider === "openai") {
      if (!openaiKey) return keyMissing("OPENAI_API_KEY");
      const model = OPENAI_MODELS.includes(reqModel) ? reqModel : OPENAI_MODEL;
      const quality = OPENAI_QUALITIES.includes(reqQuality)
        ? reqQuality
        : OPENAI_QUALITY;
      result = await generateOpenAI(openaiKey, prompt, model, quality);
    } else if (provider === "flux") {
      if (!replicateKey) return keyMissing("REPLICATE_API_TOKEN");
      result = await generateReplicate(replicateKey, prompt, FLUX_MODEL);
    } else if (provider === "ideogram") {
      if (!replicateKey) return keyMissing("REPLICATE_API_TOKEN");
      result = await generateReplicate(replicateKey, prompt, IDEOGRAM_MODEL);
    } else {
      return NextResponse.json(
        { error: `알 수 없는 provider: ${provider}` },
        { status: 400 },
      );
    }

    // image가 있으면 성공, 없으면 에러 경로(재시도까지 소진 후에도 실패한 경우 포함).
    if (!("image" in result) || !result.image) {
      const error =
        "error" in result ? result.error : "이미지 생성에 실패했습니다.";
      const status = "status" in result ? result.status : 500;
      return NextResponse.json(
        { error, note: "note" in result ? result.note : undefined },
        { status: status ?? 500 },
      );
    }

    return NextResponse.json({
      image: result.image,
      provider,
      note: "note" in result ? result.note : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
