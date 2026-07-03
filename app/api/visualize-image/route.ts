import { NextResponse } from "next/server";

// 이미지 생성 제공자: 환경변수에 있는 키로 자동 선택 (OpenAI 우선, 없으면 Gemini).
// 모델은 OPENAI_IMAGE_MODEL / GEMINI_IMAGE_MODEL 로 교체 가능.
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_SIZE = process.env.OPENAI_IMAGE_SIZE || "1536x1024"; // 가로형 (graphical abstract)
const OPENAI_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium"; // low | medium | high
// 한글 텍스트 품질이 좋은 상위 이미지 모델(Nano Banana Pro). 비용↑이나 결과물 차원이 다름.
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";
// Replicate 모델: flux(기본), ideogram(텍스트 특화). env로 교체 가능.
const FLUX_MODEL = process.env.REPLICATE_MODEL || "black-forest-labs/flux-1.1-pro";
const IDEOGRAM_MODEL =
  process.env.REPLICATE_IDEOGRAM_MODEL || "ideogram-ai/ideogram-v3-turbo";

// provider 라벨(사용자용) → 사용 가능 여부는 키 존재로 결정
export type ImageProvider = "gemini" | "openai" | "flux" | "ideogram";

type KeyFinding = { claim?: string; evidence?: string };

function buildPrompt(body: {
  title?: string;
  keyFindings?: KeyFinding[];
  methods?: string;
  results?: string;
  conclusion?: string;
}): string {
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

  return `${paperText}

위 내용을 한눈에 들어오도록 정리한 시각화 요약 이미지를 한 장 생성해줘. 설명 텍스트 말고 이미지를 직접 그려줘.

[스타일 규칙]
- 색은 절제해서 써. 장기·세포·환자군·기기 등 대상을 사실적으로 나타내기 위한 채색은 허용하되, 단순히 강조하려고 알록달록하게 칠하지 마. 배경·도형·화살표는 흰색과 회색, 옅은 한두 가지 색조 위주로.
- 저널 이름("NEJM" 등)이나 "graphical abstract"·"그래피컬 초록" 같은 제목/워터마크 문구를 이미지에 절대 넣지 마.
- 라벨과 텍스트는 모두 한글로, 꼭 필요한 최소한만.`;
}

// ── OpenAI gpt-image-1 ─────────────────────────────────────────────
async function generateOpenAI(apiKey: string, prompt: string) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt,
      size: OPENAI_SIZE,
      quality: OPENAI_QUALITY,
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
async function generateGemini(apiKey: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini API 오류 (${res.status})`;
    return { error: msg, status: res.status };
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
      error:
        "Gemini가 이미지를 반환하지 않았습니다. 모델 ID(GEMINI_IMAGE_MODEL)를 확인하세요.",
      status: 502,
      note,
    };
  return { image, note };
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
    const prompt = buildPrompt(body);

    // 요청한 provider (없으면 자동: gemini→openai→flux 순으로 가능한 것)
    const requested = typeof body.provider === "string" ? body.provider : "";
    const provider: ImageProvider = (
      requested ||
      (geminiKey ? "gemini" : openaiKey ? "openai" : "flux")
    ) as ImageProvider;

    const keyMissing = (label: string) =>
      NextResponse.json(
        { error: `${label} 키가 .env.local에 없습니다. 추가 후 서버를 재시작하세요.` },
        { status: 400 },
      );

    let result;
    if (provider === "gemini") {
      if (!geminiKey) return keyMissing("GEMINI_API_KEY");
      result = await generateGemini(geminiKey, prompt);
    } else if (provider === "openai") {
      if (!openaiKey) return keyMissing("OPENAI_API_KEY");
      result = await generateOpenAI(openaiKey, prompt);
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

    if ("error" in result && result.error) {
      return NextResponse.json(
        { error: result.error, note: "note" in result ? result.note : undefined },
        { status: result.status ?? 500 },
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
