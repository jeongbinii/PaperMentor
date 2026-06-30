"use client";

import type {
  GraphicalAbstract as GAData,
  GANode,
  GAEdge,
  GAPathway,
} from "../api/visualize/route";

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

const NODE_STYLE: Record<GANode["kind"], string> = {
  molecule: "border-indigo-200 bg-indigo-50 text-indigo-900",
  process: "border-amber-200 bg-amber-50 text-amber-900",
  phenotype: "border-rose-200 bg-rose-50 text-rose-900",
};

function PathwayConnector({ effect, label }: { effect: GAEdge["effect"]; label: string }) {
  const inhibit = effect === "inhibit";
  const color = inhibit ? "#e11d48" : effect === "activate" ? "#059669" : "#a1a1aa";
  const word = label || (inhibit ? "억제" : effect === "activate" ? "활성" : "");
  return (
    <div className="flex items-center justify-center gap-1.5 py-0.5">
      <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden>
        <line x1="11" y1="0" x2="11" y2={inhibit ? 20 : 17} stroke={color} strokeWidth="2" />
        {inhibit ? (
          <line x1="4" y1="21" x2="18" y2="21" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        ) : (
          <path d="M6 16 L11 24 L16 16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {word && (
        <span className="text-[11px] font-medium" style={{ color }}>
          {word}
        </span>
      )}
    </div>
  );
}

function PathwayDiagram({ pathway }: { pathway: GAPathway }) {
  const { nodes, edges } = pathway;
  if (!nodes || nodes.length === 0) return null;

  const edgeBetween = (a: GANode, b: GANode): GAEdge =>
    edges.find((e) => e.from === a.id && e.to === b.id) ??
    edges.find((e) => e.from === b.id && e.to === a.id) ?? {
      from: a.id,
      to: b.id,
      effect: "lead",
      label: "",
    };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        핵심 기전
      </div>
      <div className="flex flex-col items-stretch">
        {nodes.map((n, i) => (
          <div key={n.id || i}>
            <div
              className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${
                NODE_STYLE[n.kind] ?? NODE_STYLE.molecule
              }`}
            >
              {n.label}
            </div>
            {i < nodes.length - 1 && (
              <PathwayConnector {...edgeBetween(n, nodes[i + 1])} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-[10px] text-zinc-400">
        <span>↓ 활성·귀결</span>
        <span className="text-rose-500">⊣ 억제</span>
      </div>
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

      {/* 핵심 기전 도식 (기전 사슬이 있을 때만) */}
      <PathwayDiagram pathway={data.pathway} />

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
