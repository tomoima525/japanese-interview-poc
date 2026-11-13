"use client";

import { useEffect, useMemo, useState } from "react";

import {
  computeStats,
  deriveTimeline,
  sessionNow,
  useTimelineStore,
} from "@/lib/timeline";

/** Derived timeline model + stats, recomputed when events change. */
export function useTimeline() {
  const events = useTimelineStore((s) => s.events);
  const model = useMemo(() => deriveTimeline(events), [events]);
  const stats = useMemo(() => computeStats(model), [model]);
  return { events, model, stats };
}

/** Session clock that ticks (~15 fps) while live, for drawing open spans. */
export function useSessionNow(): number {
  const live = useTimelineStore((s) => s.live);
  const events = useTimelineStore((s) => s.events);
  const [now, setNow] = useState(() => sessionNow());
  useEffect(() => {
    setNow(sessionNow());
    if (!live) return;
    const id = window.setInterval(() => setNow(sessionNow()), 66);
    return () => window.clearInterval(id);
  }, [live, events]);
  return now;
}
