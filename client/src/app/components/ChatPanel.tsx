"use client";

import { MessagesSquareIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useTimeline } from "@/hooks/use-timeline";
import {
  type BotTurn,
  type ChatMessage,
  formatClock,
  formatSecs,
  type UserTurn,
} from "@/lib/timeline";
import { cn } from "@/lib/utils";

import { Panel, PanelHeader, PanelTitle } from "./Panel";

function span(start?: number, end?: number) {
  if (start === undefined) return null;
  if (end === undefined) return `${formatClock(start)} → …`;
  return `${formatClock(start)} → ${formatClock(end)} (${formatSecs(end - start)})`;
}

function UserBubble({ turn }: { turn: UserTurn }) {
  const open = turn.end === undefined;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-blue-800/60 bg-blue-950/80 px-4 py-2.5 text-blue-50 shadow-sm">
        <div className="mb-0.5 text-[10px] font-semibold tracking-wider uppercase opacity-60">
          Candidate
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {turn.text}
          {turn.interim && <span className="opacity-60">{turn.interim}</span>}
          {!turn.text && !turn.interim && (
            <span className="italic opacity-60">{open ? "話しています…" : "（聞き取れませんでした）"}</span>
          )}
        </p>
        <div className="mt-1 text-right font-mono text-[11px] opacity-60">
          {span(turn.start, turn.end)}
        </div>
      </div>
    </div>
  );
}

function BotBubble({ turn, isLast }: { turn: BotTurn; isLast: boolean }) {
  const spoken = turn.segments.map((s) => s.spoken).join("");
  const remaining = turn.segments.map((s) => s.remaining).join("");
  const thinking = !spoken && !remaining && turn.audioStart === undefined;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-emerald-800/60 bg-emerald-950/80 px-4 py-2.5 text-emerald-50 shadow-sm">
        <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold tracking-wider uppercase opacity-60">
          Interviewer
          {turn.interrupted && (
            <span className="rounded bg-red-500/30 px-1.5 py-px text-[9px] text-red-200 normal-case">
              interrupted
            </span>
          )}
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {spoken}
          {remaining && (
            <span className={cn("opacity-50", turn.interrupted && "line-through")}>
              {remaining}
            </span>
          )}
          {thinking && (
            <span className="italic opacity-60">{isLast ? "考え中…" : "（応答なし）"}</span>
          )}
        </p>
        <div className="mt-1 font-mono text-[11px] opacity-60">
          {span(turn.audioStart, turn.audioEnd) ?? `LLM ${formatClock(turn.llmStart)}`}
          {turn.responseLatency !== undefined && (
            <>
              {" · "}
              {formatSecs(turn.responseLatency)} after candidate&apos;s turn
              {turn.latencyFromLastWords !== undefined &&
                `, ${formatSecs(turn.latencyFromLastWords)} after last words`}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function isVisible(msg: ChatMessage, isLast: boolean) {
  // Hide VAD blips that produced no words once the turn is over.
  if (msg.role === "user") return isLast || msg.turn.end === undefined || !!(msg.turn.text || msg.turn.interim);
  const t = msg.turn;
  return isLast || t.audioStart !== undefined || t.segments.some((s) => s.spoken || s.remaining);
}

export function ChatPanel({ className }: { className?: string }) {
  const { model } = useTimeline();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [model]);

  const messages = model.messages;
  return (
    <Panel aria-label="Conversation" className={className}>
      <PanelHeader className="justify-between">
        <PanelTitle className="flex items-center gap-2">
          <MessagesSquareIcon className="size-4" />
          Conversation
        </PanelTitle>
        <span className="font-mono text-xs text-muted-foreground">
          {model.messages.length} messages
        </span>
      </PanelHeader>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            「Connect」を押してマイクを許可すると、面接官が日本語で話しかけます。
            <br />
            Press Connect, allow the mic, and answer in Japanese.
          </p>
        )}
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          if (!isVisible(msg, isLast)) return null;
          return msg.role === "user" ? (
            <UserBubble key={msg.turn.id} turn={msg.turn} />
          ) : (
            <BotBubble key={msg.turn.id} turn={msg.turn} isLast={isLast} />
          );
        })}
      </div>
    </Panel>
  );
}
