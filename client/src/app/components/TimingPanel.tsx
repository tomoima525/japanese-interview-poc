"use client";

import { ActivityIcon, ClipboardCopyIcon, DownloadIcon, MinusIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSessionNow, useTimeline } from "@/hooks/use-timeline";
import {
  formatSecs,
  type Span,
  type TimelineEvent,
  type TimelineModel,
  type TimelineStats,
  useTimelineStore,
} from "@/lib/timeline";
import { cn } from "@/lib/utils";

import { Panel, PanelHeader, PanelTitle } from "./Panel";

// ------------------------------------------------------------------ tiles

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{label}</div>
    </div>
  );
}

function StatTiles({ stats }: { stats: TimelineStats }) {
  const ms = (v?: number) => (v === undefined ? "—" : `${Math.round(v)}ms`);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile value={`${stats.botTurns} / ${stats.userTurns}`} label="interviewer / candidate turns" />
      <Tile value={formatSecs(stats.medianResponseMs)} label="median response after turn end" />
      <Tile value={formatSecs(stats.medianFromLastWordsMs)} label="median response after last words (voice-to-voice)" />
      <Tile value={formatSecs(stats.medianTurnDetectMs)} label="median turn-detection delay (last words → turn end)" />
      <Tile value={ms(stats.medianTtfbMs.stt)} label="median STT TTFB" />
      <Tile value={ms(stats.medianTtfbMs.llm)} label="median LLM TTFB" />
      <Tile value={ms(stats.medianTtfbMs.tts)} label="median TTS TTFB" />
      <Tile value={`${stats.interruptions}`} label="interruptions (barge-in)" />
    </div>
  );
}

// --------------------------------------------------------------- timeline

const LABEL_W = 132;
const AXIS_H = 22;
const ROW_H = 36;

const TRACKS = [
  { key: "vad", label: "Candidate speech", hint: "VAD; ticks = new words" },
  { key: "userTurn", label: "Candidate turn", hint: "smart-turn start → end" },
  { key: "llm", label: "LLM", hint: "generation" },
  { key: "tts", label: "TTS", hint: "synthesis" },
  { key: "bot", label: "Interviewer speech", hint: "audio playback" },
  { key: "markers", label: "Latency", hint: "turn end → reply" },
] as const;

const rowY = (key: (typeof TRACKS)[number]["key"]) =>
  AXIS_H + TRACKS.findIndex((t) => t.key === key) * ROW_H;

function Bars({
  spans,
  now,
  x,
  y,
  h,
  className,
  title,
}: {
  spans: Span[];
  now: number;
  x: (ms: number) => number;
  y: number;
  h: number;
  className: string;
  title: (s: Span) => string;
}) {
  return (
    <>
      {spans.map((s, i) => {
        const end = s.end ?? now;
        return (
          <rect
            key={i}
            x={x(s.start)}
            y={y}
            width={Math.max(2, x(end) - x(s.start))}
            height={h}
            rx={3}
            className={cn(className, s.end === undefined && "animate-pulse")}
          >
            <title>{title(s)}</title>
          </rect>
        );
      })}
    </>
  );
}

const dur = (s: Span, now: number) => formatSecs((s.end ?? now) - s.start);

function TimelineChart({
  model,
  now,
  pxPerSec,
  follow,
}: {
  model: TimelineModel;
  now: number;
  pxPerSec: number;
  follow: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const endMs = Math.max(now, model.end);
  const width = Math.max(viewW, (endMs / 1000) * pxPerSec + 80);
  const height = AXIS_H + TRACKS.length * ROW_H + 4;
  const x = (ms: number) => (ms / 1000) * pxPerSec + 8;

  useEffect(() => {
    const el = scrollRef.current;
    if (follow && el) el.scrollLeft = el.scrollWidth;
  }, [follow, width]);

  const tickStep = pxPerSec >= 90 ? 1 : pxPerSec >= 40 ? 5 : pxPerSec >= 15 ? 10 : 30;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s * pxPerSec <= width; s += tickStep) out.push(s);
    return out;
  }, [width, pxPerSec, tickStep]);

  const userTurnSpans = model.userTurns;
  const pad = 8;

  return (
    <div className="flex rounded-lg border bg-background/60">
      {/* fixed labels */}
      <div className="shrink-0 border-r" style={{ width: LABEL_W }}>
        <div style={{ height: AXIS_H }} />
        {TRACKS.map((t) => (
          <div key={t.key} className="flex flex-col justify-center px-2.5" style={{ height: ROW_H }}>
            <div className="text-xs font-medium leading-tight">{t.label}</div>
            <div className="text-[10px] leading-tight text-muted-foreground">{t.hint}</div>
          </div>
        ))}
      </div>
      {/* scrolling chart */}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
        <svg width={width} height={height} className="block select-none">
          {/* grid + axis */}
          {ticks.map((s) => (
            <g key={s}>
              <line x1={x(s * 1000)} x2={x(s * 1000)} y1={AXIS_H - 4} y2={height} className="stroke-border" strokeWidth={1} />
              <text x={x(s * 1000) + 3} y={14} className="fill-muted-foreground font-mono text-[10px]">
                {s}s
              </text>
            </g>
          ))}
          {TRACKS.map((t, i) => (
            <line key={t.key} x1={0} x2={width} y1={AXIS_H + (i + 1) * ROW_H} y2={AXIS_H + (i + 1) * ROW_H} className="stroke-border/50" />
          ))}

          {/* candidate speech (VAD) + word ticks */}
          <Bars spans={model.vad} now={now} x={x} y={rowY("vad") + pad} h={ROW_H - 2 * pad} className="fill-blue-600/80" title={(s) => `Candidate speaking ${dur(s, now)}`} />
          {model.vad.flatMap((seg, i) =>
            seg.ticks.map((t, j) => (
              <line key={`${i}-${j}`} x1={x(t)} x2={x(t)} y1={rowY("vad") + pad + 3} y2={rowY("vad") + ROW_H - pad - 3} className="stroke-blue-100" strokeWidth={1.5} />
            )),
          )}

          {/* candidate turn (smart-turn) */}
          <Bars spans={userTurnSpans} now={now} x={x} y={rowY("userTurn") + 13} h={10} className="fill-sky-400/25 stroke-sky-400" title={(s) => `Candidate turn ${dur(s, now)}`} />
          {userTurnSpans
            .filter((u) => u.end !== undefined)
            .map((u) => (
              <circle key={u.id} cx={x(u.end!)} cy={rowY("userTurn") + 18} r={4} className="fill-sky-300">
                <title>Turn end detected</title>
              </circle>
            ))}

          {/* LLM + TTS */}
          <Bars spans={model.llm} now={now} x={x} y={rowY("llm") + 12} h={12} className="fill-violet-500/80" title={(s) => `LLM ${dur(s, now)}`} />
          <Bars spans={model.tts} now={now} x={x} y={rowY("tts") + 12} h={12} className="fill-amber-500/80" title={(s) => `TTS ${dur(s, now)}`} />

          {/* interviewer speech */}
          <Bars spans={model.botSpeech} now={now} x={x} y={rowY("bot") + pad} h={ROW_H - 2 * pad} className="fill-emerald-600/85" title={(s) => `Interviewer speaking ${dur(s, now)}`} />
          {model.botTurns
            .filter((b) => b.audioStart !== undefined)
            .map((b) => {
              const text = b.segments.map((s) => s.spoken || s.remaining).join("");
              const w = x(b.audioEnd ?? now) - x(b.audioStart!);
              if (w < 40 || !text) return null;
              const chars = Math.max(1, Math.floor((w - 8) / 12));
              return (
                <text key={b.id} x={x(b.audioStart!) + 4} y={rowY("bot") + ROW_H / 2 + 4} className="pointer-events-none fill-emerald-50 text-[11px]">
                  {text.length > chars ? `${text.slice(0, chars - 1)}…` : text}
                </text>
              );
            })}

          {/* latency brackets: turn end → first audio */}
          {model.botTurns.map((b) => {
            const u = model.userTurns.find((t) => t.id === b.replyTo);
            if (!u?.end || b.audioStart === undefined || b.responseLatency === undefined) return null;
            const y = rowY("markers") + 14;
            const x1 = x(u.end);
            const x2 = x(b.audioStart);
            return (
              <g key={b.id}>
                {u.lastWordsAt !== undefined && u.lastWordsAt < u.end && (
                  <line x1={x(u.lastWordsAt)} x2={x1} y1={y} y2={y} className="stroke-sky-400/60" strokeWidth={2} strokeDasharray="3 3" />
                )}
                <line x1={x1} x2={x2} y1={y} y2={y} className="stroke-rose-300" strokeWidth={2} />
                <line x1={x1} x2={x1} y1={y - 5} y2={y + 5} className="stroke-rose-300" strokeWidth={2} />
                <line x1={x2} x2={x2} y1={y - 5} y2={y + 5} className="stroke-rose-300" strokeWidth={2} />
                <text x={(x1 + x2) / 2} y={y + 15} textAnchor="middle" className="fill-rose-200 font-mono text-[10px]">
                  {formatSecs(b.responseLatency)}
                </text>
                <title>
                  {`Response ${formatSecs(b.responseLatency)} after turn end` +
                    (b.latencyFromLastWords !== undefined ? `, ${formatSecs(b.latencyFromLastWords)} after last words` : "")}
                </title>
              </g>
            );
          })}

          {/* interruptions */}
          {model.interruptions.map((t, i) => {
            const cx = x(t);
            const cy = rowY("bot") + ROW_H / 2;
            return (
              <g key={i} className="stroke-red-500" strokeWidth={2.5}>
                <line x1={cx - 5} x2={cx + 5} y1={cy - 5} y2={cy + 5} />
                <line x1={cx - 5} x2={cx + 5} y1={cy + 5} y2={cy - 5} />
                <title>Candidate barged in</title>
              </g>
            );
          })}

          {/* now cursor */}
          <line x1={x(now)} x2={x(now)} y1={AXIS_H - 4} y2={height} className="stroke-foreground/40" strokeDasharray="2 3" />
        </svg>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["bg-blue-600", "Candidate speech (ticks: new words)"],
    ["bg-sky-400", "Candidate turn / end detected"],
    ["bg-violet-500", "LLM generation"],
    ["bg-amber-500", "TTS synthesis"],
    ["bg-emerald-600", "Interviewer audio"],
    ["bg-rose-300", "Turn end → reply latency"],
    ["bg-red-500", "Barge-in"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cn("inline-block size-2.5 rounded-sm", c)} />
          {l}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ panel

const ZOOMS = [10, 20, 40, 60, 90, 120, 180];

export function TimingPanel({ className }: { className?: string }) {
  const { model, stats, events } = useTimeline();
  const now = useSessionNow();
  const live = useTimelineStore((s) => s.live);
  const [zoom, setZoom] = useState(3);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events }, null, 2);

  const copy = async () => {
    await navigator.clipboard.writeText(exportJson());
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `interview-timeline-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const loadText = (text: string) => {
    try {
      const parsed = JSON.parse(text) as { events?: TimelineEvent[] };
      if (!Array.isArray(parsed.events)) throw new Error("missing events[]");
      useTimelineStore.getState().load(parsed.events);
    } catch (err) {
      alert(`Could not load timeline JSON: ${err instanceof Error ? err.message : err}`);
    }
  };
  const load = async (file: File) => loadText(await file.text());
  const loadSample = async () => loadText(await (await fetch("/sample-timeline.json")).text());

  return (
    <Panel aria-label="Timing" className={className}>
      <PanelHeader className="justify-between">
        <PanelTitle className="flex items-center gap-2">
          <ActivityIcon className="size-4" />
          Timing
        </PanelTitle>
        <span className={cn("font-mono text-xs", live ? "text-emerald-400" : "text-muted-foreground")}>
          {live ? "● live" : events.length ? "recorded" : "idle"}
        </span>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <StatTiles stats={stats} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={follow} onCheckedChange={setFollow} />
            Follow live
          </label>
          <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            <MinusIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
            <PlusIcon />
          </Button>
          <span className="font-mono text-xs text-muted-foreground">{ZOOMS[zoom]}px/s</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy} disabled={!events.length}>
              <ClipboardCopyIcon /> {copied ? "Copied" : "Copy JSON"}
            </Button>
            <Button variant="outline" size="sm" onClick={download} disabled={!events.length}>
              <DownloadIcon /> Download
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={live}>
              <UploadIcon /> Load JSON
            </Button>
            <Button variant="outline" size="sm" onClick={loadSample} disabled={live}>
              Sample
            </Button>
            <Button variant="outline" size="sm" onClick={() => useTimelineStore.getState().reset()} disabled={live || !events.length}>
              <Trash2Icon /> Clear
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void load(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <TimelineChart model={model} now={now} pxPerSec={ZOOMS[zoom]!} follow={follow} />
        <Legend />
      </div>
    </Panel>
  );
}
