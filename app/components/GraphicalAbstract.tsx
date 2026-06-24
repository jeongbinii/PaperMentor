"use client";

import type { GraphicalAbstract as GAData, GAOutcome } from "../api/visualize/route";

const TONE: Record<
  GAOutcome["direction"],
  { box: string; value: string; pill: string; label: string }
> = {
  benefit: {
    box: "border-emerald-200 bg-emerald-50",
    value: "text-emerald-700",
    pill: "bg-emerald-100 text-emerald-700",
    label: "유리",
  },
  harm: {
    box: "border-rose-200 bg-rose-50",
    value: "text-rose-700",
    pill: "bg-rose-100 text-rose-700",
    label: "불리",
  },
  neutral: {
    box: "border-zinc-200 bg-zinc-50",
    value: "text-zinc-700",
    pill: "bg-zinc-200 text-zinc-600",
    label: "차이 없음·불확실",
  },
};

function DownArrow() {
  return (
    <div className="flex justify-center text-zinc-300" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l-5-5m5 5l5-5" />
      </svg>
    </div>
  );
}

function SetupCard({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {label}
        </div>
        <div className="text-sm leading-snug text-zinc-800 break-words">{text}</div>
      </div>
    </div>
  );
}

const IconPeople = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5a3 3 0 00-6 0M12 11a3 3 0 100-6 3 3 0 000 6zM4.5 19.5a2.5 2.5 0 014-2M19.5 19.5a2.5 2.5 0 00-4-2" />
  </svg>
);
const IconIntervention = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 14.5l5-5M7 17a3.5 3.5 0 010-5l5-5a3.5 3.5 0 015 5l-5 5a3.5 3.5 0 01-5 0z" />
  </svg>
);
const IconCompare = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M5 8h14M5 8l-2 4h4l-2-4zm14 0l-2 4h4l-2-4z" />
  </svg>
);

function OutcomeCard({ o }: { o: GAOutcome }) {
  const tone = TONE[o.direction];
  return (
    <div className={`rounded-lg border p-3 ${tone.box}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {o.primary && (
            <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              1차 결과
            </span>
          )}
          <span className="truncate text-xs font-medium text-zinc-600">{o.metric}</span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.pill}`}>
          {tone.label}
        </span>
      </div>
      <div className={`text-2xl font-bold leading-tight break-words ${tone.value}`}>
        {o.value || "—"}
      </div>
      {o.detail && <div className="mt-1 text-xs text-zinc-500 break-words">{o.detail}</div>}
    </div>
  );
}

export default function GraphicalAbstract({ data }: { data: GAData }) {
  return (
    <div className="space-y-3">
      {/* 헤드라인 */}
      <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white">
        {data.studyType && (
          <span className="mb-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">
            {data.studyType}
          </span>
        )}
        <p className="text-base font-semibold leading-snug">{data.headline}</p>
      </div>

      {/* 연구 설계 */}
      <div className="space-y-2">
        {data.population && (
          <SetupCard icon={IconPeople} label="연구 대상" text={data.population} />
        )}
        {data.intervention && (
          <>
            <DownArrow />
            <SetupCard icon={IconIntervention} label="중재 / 노출" text={data.intervention} />
          </>
        )}
        {data.comparison && (
          <>
            <DownArrow />
            <SetupCard icon={IconCompare} label="비교군" text={data.comparison} />
          </>
        )}
      </div>

      {/* 핵심 결과 */}
      {data.outcomes.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            핵심 결과
          </h4>
          {data.outcomes.map((o, i) => (
            <OutcomeCard key={i} o={o} />
          ))}
        </div>
      )}

      {/* 결론 */}
      {data.conclusion && (
        <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50 p-3">
          <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-500">
            결론
          </div>
          <p className="text-sm leading-relaxed text-zinc-800">{data.conclusion}</p>
        </div>
      )}

      <p className="pt-1 text-[11px] leading-relaxed text-zinc-400">
        AI가 본문에서 추출해 시각화한 요약입니다. 수치·해석은 원문을 확인하세요.
      </p>
    </div>
  );
}
