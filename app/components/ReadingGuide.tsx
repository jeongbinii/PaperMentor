"use client";

import type {
  ReadingGuideResult,
  GuideStep,
  Positioning,
} from "../api/reading-guide/route";

type HelperTab = GuideStep["helperTab"];

const TAB_LABEL: Record<Exclude<HelperTab, "">, string> = {
  background: "배경지식",
  translate: "번역·설명",
  stats: "통계",
  reliability: "신뢰도",
  quiz: "퀴즈",
};

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function PositioningCard({ p }: { p: Positioning }) {
  const rows: { label: string; value: string }[] = [
    { label: "중재", value: p.intervention },
    { label: "치료 단계", value: p.lineOfTherapy },
    { label: "성격", value: p.status },
    { label: "비교 대상", value: p.comparator },
  ].filter((r) => r.value);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          치료 포지셔닝
        </span>
        <span className="text-[11px] text-emerald-600/80">
          이 치료가 지금 임상에서 어디에 있나
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2 text-sm">
            <span className="w-16 shrink-0 text-[12px] font-medium text-emerald-700">
              {r.label}
            </span>
            <span className="text-zinc-800">{r.value}</span>
          </div>
        ))}
      </div>
      {p.clinicalContext && (
        <p className="mt-2 border-t border-emerald-200 pt-2 text-sm leading-relaxed text-zinc-700">
          {p.clinicalContext}
        </p>
      )}
    </div>
  );
}

function StepCard({
  step,
  isLast,
  onOpenTab,
}: {
  step: GuideStep;
  isLast: boolean;
  onOpenTab: (tab: string) => void;
}) {
  return (
    <div className="relative flex gap-3">
      {/* 타임라인 */}
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-bold text-white">
          {step.order}
        </div>
        {!isLast && <div className="w-px flex-1 bg-zinc-200" />}
      </div>

      {/* 본문 */}
      <div className="min-w-0 flex-1 pb-4">
        <div className="text-sm font-semibold text-zinc-800">{step.section}</div>
        {step.goal && (
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-600">
            {step.goal}
          </p>
        )}

        {step.lookFor.length > 0 && (
          <ul className="mt-2 space-y-1">
            {step.lookFor.map((item, i) => (
              <li key={i} className="flex gap-1.5 text-[13px] text-zinc-700">
                <CheckIcon />
                <span className="leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        )}

        {step.watchOut && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[12px] leading-snug text-amber-700">
            ⚠ {step.watchOut}
          </p>
        )}

        {step.helperTab && (
          <button
            onClick={() => onOpenTab(step.helperTab)}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-blue-100 hover:text-blue-700"
          >
            막히면 → {TAB_LABEL[step.helperTab as Exclude<HelperTab, "">]} 탭
          </button>
        )}
      </div>
    </div>
  );
}

export default function ReadingGuide({
  data,
  onOpenTab,
}: {
  data: ReadingGuideResult;
  onOpenTab: (tab: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* 오리엔테이션 */}
      {data.firstReadFocus && (
        <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/70">
            처음 읽는다면
          </div>
          <p className="text-sm leading-relaxed">{data.firstReadFocus}</p>
        </div>
      )}

      {/* 치료 포지셔닝 (치료·중재 연구일 때만) */}
      {data.positioning && <PositioningCard p={data.positioning} />}

      {/* 단계별 읽기 로드맵 */}
      {data.steps.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            단계별 읽기 로드맵
          </div>
          <div>
            {data.steps.map((step, i) => (
              <StepCard
                key={step.order || i}
                step={step}
                isLast={i === data.steps.length - 1}
                onOpenTab={onOpenTab}
              />
            ))}
          </div>
        </div>
      )}

      <p className="pt-1 text-[11px] leading-relaxed text-zinc-400">
        AI가 본 논문에 맞춰 만든 읽기 길잡이입니다. 단계별로 직접 본문을 확인하며 읽어 보세요.
      </p>
    </div>
  );
}
