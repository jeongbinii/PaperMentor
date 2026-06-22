"use client";

import { useEffect, useRef, useState } from "react";

export default function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current || !code) return;

    let cancelled = false;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        fontFamily: "inherit",
      });

      const id = `mermaid-${Math.random().toString(36).slice(2)}`;

      mermaid
        .render(id, code)
        .then(({ svg }) => {
          if (!cancelled && ref.current) {
            ref.current.innerHTML = svg;
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "다이어그램 렌더링 오류");
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
        다이어그램 렌더링 실패: {error}
        <pre className="mt-2 text-zinc-500 whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return <div ref={ref} className="w-full overflow-x-auto" />;
}
