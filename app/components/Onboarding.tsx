"use client";

import { useState, type ReactNode } from "react";

// 처음 방문 시 화면 구성과 각 기능 사용법을 단계별로 안내한다.
// 실제 요소를 가리키는 스포트라이트 대신 개념 도식 + 단계 설명 — 탭이 분석 후에야
// 활성화되고 좁은 화면에선 패널이 접히므로 이 방식이 모바일까지 안정적이다.

// 화면 3분할 미니 도식
function LayoutSchematic() {
  const cols = [
    { label: "왼쪽", sub: "논문 원문" },
    { label: "가운데", sub: "핵심 요약" },
    { label: "오른쪽", sub: "읽기 도구" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cols.map((c, i) => (
        <div
          key={c.label}
          className={`rounded-lg border px-2 py-3 text-center ${
            i === 1 ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="text-[11px] font-semibold text-slate-700">{c.label}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// 탭/항목 나열용 소형 행 (이름 칩 + 한 줄 설명)
function Row({ name, desc }: { name: string; desc: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
        {name}
      </span>
      <span className="text-[13px] leading-relaxed text-slate-600">{desc}</span>
    </li>
  );
}

type Step = { eyebrow: string; title: string; body: ReactNode };

const STEPS: Step[] = [
  {
    eyebrow: "화면 구성",
    title: "세 부분으로 나뉜 화면",
    body: (
      <>
        <p>
          PaperMentor는 의학 논문을 단계별로 읽고 이해하도록 돕습니다. 화면은 크게 세 부분입니다.
        </p>
        <LayoutSchematic />
        <p className="text-[12px] text-slate-400">
          화면이 좁으면(모바일) 세 부분이 아래{" "}
          <b className="font-medium text-slate-500">원문 · 핵심요약 · 읽기도구</b> 탭으로 전환됩니다.
        </p>
      </>
    ),
  },
  {
    eyebrow: "1. 논문 불러오기",
    title: "왼쪽 위에서 시작",
    body: (
      <>
        <p>
          왼쪽 위 입력창에 <b className="font-semibold text-zinc-800">PubMed ID(PMID)</b>나{" "}
          <b className="font-semibold text-zinc-800">DOI</b>를 넣거나,{" "}
          <b className="font-semibold text-zinc-800">PDF 파일</b>을 끌어다 놓으세요.
        </p>
        <p>
          분석이 시작되면 잠시 뒤 가운데에 요약이 나타나고, 왼쪽에는 논문 원문이 표시됩니다.
        </p>
        <p className="text-[12px] text-slate-400">
          예: PMID 36531956 · DOI 10.3389/fcell.2022.1073688
        </p>
      </>
    ),
  },
  {
    eyebrow: "2. 핵심 요약",
    title: "가운데 — 요약과 근거",
    body: (
      <>
        <p>
          분석하면 <b className="font-semibold text-zinc-800">핵심 결과 · 배경 · 방법 · 결론</b>이
          정리됩니다. 맨 위 시각화 요약으로 전체 흐름을 한눈에 볼 수 있습니다.
        </p>
        <p>
          핵심 결과 항목을 누르면, 그 근거가 왼쪽 원문에서{" "}
          <span className="rounded bg-yellow-200 px-1 text-zinc-900">형광펜</span>으로 표시되고 해당
          위치로 이동합니다.
        </p>
      </>
    ),
  },
  {
    eyebrow: "3. 읽기 도구",
    title: "오른쪽 — 목적별 도구 탭",
    body: (
      <>
        <p>오른쪽 탭에서 목적에 맞는 도구를 고르세요. 분석이 끝나면 자동으로 준비됩니다.</p>
        <ul className="space-y-1.5">
          <Row name="읽기 가이드" desc="어디부터 어떻게 읽을지 단계별 길잡이" />
          <Row name="배경지식" desc="논문을 이해하는 데 필요한 사전 지식" />
          <Row name="통계 해석" desc="논문에 나온 통계 수치의 의미 풀이" />
          <Row name="퀴즈" desc="내용 이해를 확인하는 문제" />
          <Row name="Q&A" desc="논문 내용에 대해 자유롭게 질문" />
        </ul>
      </>
    ),
  },
  {
    eyebrow: "4. 발표 슬라이드",
    title: "논문을 .pptx로 내보내기",
    body: (
      <>
        <p>
          <b className="font-semibold text-zinc-800">발표 슬라이드</b> 탭에서 논문을 발표용
          파일(.pptx)로 내려받습니다. 두 가지 방식이 있습니다.
        </p>
        <ul className="space-y-1.5">
          <Row name="요약 그대로" desc="분석 결과를 그대로 조립 — 내용이 원문 분석과 동일" />
          <Row name="AI 재구성" desc="논문 내용·요약을 바탕으로 AI와 함께 맞춤 구성" />
        </ul>
        <p className="text-[12px] text-slate-400">
          AI 재구성에는 추가 요구사항(강조점·분량)을 적을 수 있고, 원문 그림도 자동 포함됩니다.
        </p>
      </>
    ),
  },
  {
    eyebrow: "그 밖에",
    title: "용어 해설과 내 서재",
    body: (
      <>
        <p>
          <b className="font-semibold text-zinc-800">용어 해설</b> — 가운데 위 용어 해설을 켜고,
          모르는 단어를 탭(데스크톱은 드래그)하면 그 자리에서 뜻풀이가 나옵니다.
        </p>
        <p>
          <b className="font-semibold text-zinc-800">내 서재</b> — 로그인하면 분석한 논문을 저장하고
          나중에 다시 볼 수 있습니다.
        </p>
        <p className="text-[12px] text-slate-400">
          이 안내는 가운데 위 <b className="font-medium text-slate-500">? 사용 안내</b>로 언제든 다시
          볼 수 있어요.
        </p>
      </>
    ),
  },
];

export default function Onboarding({
  onClose,
  onNeverShow,
}: {
  onClose: () => void;
  onNeverShow: () => void;
}) {
  const [i, setI] = useState(0);
  const last = STEPS.length - 1;
  const step = STEPS[i];
  const isLast = i === last;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
            {step.eyebrow}
          </span>
          <span className="text-[11px] tabular-nums text-slate-400">
            {i + 1} / {STEPS.length}
          </span>
        </div>
        <h3 className="text-base font-semibold text-zinc-900">{step.title}</h3>

        {/* 본문 — 단계 전환 시 높이 점프를 줄이려 최소 높이 고정 */}
        <div className="mt-3 min-h-[172px] space-y-3 text-sm leading-relaxed text-zinc-600">
          {step.body}
        </div>

        {/* 진행 점 (클릭으로 이동 가능) */}
        <div className="mt-4 flex justify-center gap-1.5">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              aria-label={`${idx + 1}단계 보기`}
              onClick={() => setI(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-5 bg-blue-600" : "w-1.5 bg-slate-300 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>

        {/* 네비게이션 */}
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={onNeverShow}
            className="text-[12px] text-slate-400 hover:text-slate-600"
          >
            다시 보지 않음
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI((v) => Math.max(0, v - 1))}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
              >
                이전
              </button>
            )}
            {isLast ? (
              <button
                onClick={onClose}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
              >
                시작하기
              </button>
            ) : (
              <button
                onClick={() => setI((v) => Math.min(last, v + 1))}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
              >
                다음
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
