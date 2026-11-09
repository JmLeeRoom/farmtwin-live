"use client";

import { useCallback, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn" | "error" | "ok";
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return { toasts, push };
}

const TONE: Record<Toast["tone"], string> = {
  info: "bg-slate-900 text-white",
  ok: "bg-emerald-700 text-white",
  warn: "bg-amber-500 text-slate-950",
  error: "bg-red-600 text-white",
};

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${TONE[t.tone]}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
