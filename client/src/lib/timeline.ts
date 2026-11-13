/**
 * Conversation timeline: raw RTVI events (timestamped on arrival) → derived
 * tracks, chat messages and timing stats.
 *
 * Only raw events are stored; everything else is a pure function of them,
 * so a session exported as JSON can be loaded back and re-rendered exactly.
 */

import { create } from "zustand";

// ---------------------------------------------------------------- raw events

export type TimelineEventType =
  | "connected"
  | "disconnected"
  | "botReady"
  | "vadStart"
  | "vadStop"
  | "userTurnStart"
  | "userTurnStop"
  | "userTranscript"
  | "botLlmStarted"
  | "botLlmStopped"
  | "botTtsStarted"
  | "botTtsStopped"
  | "botStartedSpeaking"
  | "botStoppedSpeaking"
  | "botInterrupted"
  | "botOutput"
  | "metrics"
  | "config";

export interface TimelineEvent {
  /** Milliseconds since the session started (client clock). */
  t: number;
  type: TimelineEventType;
  data?: unknown;
}

export interface ServiceInfo {
  kind: "stt" | "llm" | "tts";
  provider: string;
  model: string;
}

export interface SessionConfig {
  role?: string;
  services?: ServiceInfo[];
}

// ------------------------------------------------------------- derived model

export interface Span {
  start: number;
  /** Undefined while still open. */
  end?: number;
}

export interface VadSegment extends Span {
  /** Times at which new (interim/final) transcript text arrived. */
  ticks: number[];
}

export interface UserTurn extends Span {
  id: string;
  /** Finalized transcript text. */
  text: string;
  /** Latest interim text (shown while the turn is open). */
  interim: string;
  /** Last VAD stop inside this turn (≈ when the candidate's last word ended). */
  lastWordsAt?: number;
}

export interface BotSegment {
  id: string;
  /** Text already spoken aloud. */
  spoken: string;
  /** Text queued but not yet spoken (dropped if interrupted). */
  remaining: string;
}

export interface BotTurn {
  id: string;
  /** When the LLM started generating this response. */
  llmStart: number;
  llmEnd?: number;
  /** First / last audio of this response. */
  audioStart?: number;
  audioEnd?: number;
  segments: BotSegment[];
  interrupted: boolean;
  /** The user turn this response answers, if any. */
  replyTo?: string;
  /** User turn end → first audio. */
  responseLatency?: number;
  /** Candidate's last words (VAD stop) → first audio. */
  latencyFromLastWords?: number;
}

export interface MetricSample {
  t: number;
  kind: "stt" | "llm" | "tts" | "other";
  processor: string;
  /** Seconds. */
  value: number;
}

export type ChatMessage =
  | { role: "user"; turn: UserTurn }
  | { role: "bot"; turn: BotTurn };

export interface TimelineModel {
  vad: VadSegment[];
  userTurns: UserTurn[];
  botTurns: BotTurn[];
  botSpeech: Span[];
  llm: Span[];
  tts: Span[];
  interruptions: number[];
  ttfb: MetricSample[];
  messages: ChatMessage[];
  config: SessionConfig | null;
  /** Time of the last event (ms). */
  end: number;
}

function classifyProcessor(name: string): MetricSample["kind"] {
  const n = name.toLowerCase();
  if (n.includes("stt")) return "stt";
  if (n.includes("tts")) return "tts";
  if (n.includes("llm")) return "llm";
  return "other";
}

const last = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

/** Pure derivation of the timeline model from raw events. */
export function deriveTimeline(events: readonly TimelineEvent[]): TimelineModel {
  const m: TimelineModel = {
    vad: [],
    userTurns: [],
    botTurns: [],
    botSpeech: [],
    llm: [],
    tts: [],
    interruptions: [],
    ttfb: [],
    messages: [],
    config: null,
    end: 0,
  };
  let botSpeaking = false;
  let lastUserTurnEnded: UserTurn | undefined;
  let seenUserInput = false;
  const segmentIndex = new Map<string, BotSegment>();
  let userSeq = 0;
  let botSeq = 0;

  const openUserTurn = (t: number): UserTurn => {
    const turn: UserTurn = {
      id: `u${++userSeq}`,
      start: t,
      text: "",
      interim: "",
    };
    m.userTurns.push(turn);
    m.messages.push({ role: "user", turn });
    return turn;
  };

  const currentBotTurn = (t: number): BotTurn => {
    const turn = last(m.botTurns);
    const lastUser = last(m.userTurns);
    // Bot speech/text with no LLM run since the candidate last spoke (e.g. a
    // TTSSpeakFrame) starts a new bot turn.
    const stale =
      turn !== undefined &&
      !botSpeaking &&
      turn.audioEnd !== undefined &&
      lastUser !== undefined &&
      lastUser.start > turn.audioEnd;
    return !turn || stale ? newBotTurn(t) : turn;
  };

  const newBotTurn = (t: number): BotTurn => {
    const turn: BotTurn = {
      id: `b${++botSeq}`,
      llmStart: t,
      segments: [],
      interrupted: false,
    };
    // A response to the most recent finished user turn (if not answered yet).
    if (lastUserTurnEnded && !m.botTurns.some((b) => b.replyTo === lastUserTurnEnded!.id)) {
      turn.replyTo = lastUserTurnEnded.id;
    }
    m.botTurns.push(turn);
    m.messages.push({ role: "bot", turn });
    return turn;
  };

  for (const ev of events) {
    const { t } = ev;
    m.end = Math.max(m.end, t);
    switch (ev.type) {
      case "config":
        m.config = ev.data as SessionConfig;
        break;

      case "vadStart":
        if (!last(m.vad) || last(m.vad)!.end !== undefined) {
          m.vad.push({ start: t, ticks: [] });
        }
        break;
      case "vadStop": {
        const seg = last(m.vad);
        if (seg && seg.end === undefined) seg.end = t;
        const turn = last(m.userTurns);
        if (turn) turn.lastWordsAt = t;
        break;
      }

      case "userTurnStart": {
        const open = last(m.userTurns);
        if (!open || open.end !== undefined) openUserTurn(t);
        if (botSpeaking) {
          m.interruptions.push(t);
          const turn = last(m.botTurns);
          if (turn) turn.interrupted = true;
        }
        break;
      }
      case "userTurnStop": {
        const turn = last(m.userTurns);
        if (turn && turn.end === undefined) {
          turn.end = t;
          if (turn.lastWordsAt === undefined || turn.lastWordsAt < turn.start) {
            turn.lastWordsAt = t;
          }
          lastUserTurnEnded = turn;
        }
        break;
      }
      case "userTranscript": {
        const d = ev.data as { text: string; final: boolean; source?: string };
        if (d.source === "userInput") seenUserInput = true;
        else if (seenUserInput) break; // prefer UserInput over the legacy event
        if (!d.text?.trim()) break;
        let turn = last(m.userTurns);
        // Late transcript for a closed turn is still part of it unless the
        // bot has already answered (then it belongs to a new utterance).
        if (!turn || (turn.end !== undefined && m.botTurns.some((b) => b.replyTo === turn!.id && b.audioStart !== undefined && b.audioStart < t))) {
          turn = openUserTurn(t);
        }
        if (d.final) {
          turn.text = turn.text ? `${turn.text}${d.text}` : d.text;
          turn.interim = "";
        } else {
          turn.interim = d.text;
        }
        const seg = last(m.vad);
        if (seg && (seg.end === undefined || t - seg.end < 1500)) seg.ticks.push(t);
        break;
      }

      case "botLlmStarted":
        m.llm.push({ start: t });
        newBotTurn(t);
        break;
      case "botLlmStopped": {
        const span = last(m.llm);
        if (span && span.end === undefined) span.end = t;
        const turn = last(m.botTurns);
        if (turn && turn.llmEnd === undefined) turn.llmEnd = t;
        break;
      }
      case "botTtsStarted":
        if (!last(m.tts) || last(m.tts)!.end !== undefined) m.tts.push({ start: t });
        break;
      case "botTtsStopped": {
        const span = last(m.tts);
        if (span && span.end === undefined) span.end = t;
        break;
      }

      case "botStartedSpeaking": {
        botSpeaking = true;
        m.botSpeech.push({ start: t });
        const turn = currentBotTurn(t);
        if (turn.audioStart === undefined) {
          turn.audioStart = t;
          const replied = m.userTurns.find((u) => u.id === turn.replyTo);
          if (replied?.end !== undefined) {
            turn.responseLatency = t - replied.end;
            if (replied.lastWordsAt !== undefined) {
              turn.latencyFromLastWords = t - replied.lastWordsAt;
            }
          }
        }
        break;
      }
      case "botStoppedSpeaking": {
        botSpeaking = false;
        const span = last(m.botSpeech);
        if (span && span.end === undefined) span.end = t;
        const turn = last(m.botTurns);
        if (turn) turn.audioEnd = t;
        break;
      }
      case "botInterrupted": {
        // Pipecat broadcasts an interruption on every user turn start, even
        // when the bot is silent; only a cut-off of audible speech counts.
        if (!botSpeaking) break;
        const turn = last(m.botTurns);
        if (turn) turn.interrupted = true;
        if (!m.interruptions.some((x) => Math.abs(x - t) < 500)) {
          m.interruptions.push(t);
        }
        break;
      }

      case "botOutput": {
        const d = ev.data as {
          text: string;
          segment_id?: number;
          will_be_spoken?: boolean;
          spoken_status?: string;
          spoken_progress?: { accumulated_text: string; remaining_text: string };
          output_type?: string;
        };
        if (d.will_be_spoken === false) break;
        const turn = currentBotTurn(t);
        const key = `${turn.id}:${d.segment_id ?? turn.segments.length}`;
        let seg = segmentIndex.get(key);
        if (!seg) {
          seg = { id: key, spoken: "", remaining: "" };
          segmentIndex.set(key, seg);
          turn.segments.push(seg);
        }
        if (d.spoken_progress) {
          seg.spoken = d.spoken_progress.accumulated_text;
          seg.remaining = d.spoken_progress.remaining_text;
        } else if (d.spoken_status === "completed") {
          seg.spoken = d.text;
          seg.remaining = "";
        } else {
          seg.remaining = d.text;
        }
        break;
      }

      case "metrics": {
        const d = ev.data as {
          ttfb?: { processor: string; value: number }[];
        };
        for (const s of d.ttfb ?? []) {
          if (typeof s.value !== "number" || s.value <= 0) continue;
          m.ttfb.push({
            t,
            kind: classifyProcessor(s.processor),
            processor: s.processor,
            value: s.value,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return m;
}

// ------------------------------------------------------------------ stats

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
}

export interface TimelineStats {
  userTurns: number;
  botTurns: number;
  interruptions: number;
  medianResponseMs?: number;
  medianFromLastWordsMs?: number;
  medianTurnDetectMs?: number;
  medianTtfbMs: Partial<Record<MetricSample["kind"], number>>;
}

export function computeStats(m: TimelineModel): TimelineStats {
  const responses = m.botTurns
    .map((b) => b.responseLatency)
    .filter((x): x is number => x !== undefined && x >= 0);
  const fromLastWords = m.botTurns
    .map((b) => b.latencyFromLastWords)
    .filter((x): x is number => x !== undefined && x >= 0);
  const turnDetect = m.userTurns
    .filter((u) => u.end !== undefined && u.lastWordsAt !== undefined)
    .map((u) => u.end! - u.lastWordsAt!)
    .filter((x) => x >= 0);
  const medianTtfbMs: TimelineStats["medianTtfbMs"] = {};
  for (const kind of ["stt", "llm", "tts"] as const) {
    const v = median(m.ttfb.filter((s) => s.kind === kind).map((s) => s.value * 1000));
    if (v !== undefined) medianTtfbMs[kind] = v;
  }
  return {
    userTurns: m.userTurns.filter((u) => u.text || u.interim).length,
    botTurns: m.botTurns.filter((b) => b.audioStart !== undefined).length,
    interruptions: m.interruptions.length,
    medianResponseMs: median(responses),
    medianFromLastWordsMs: median(fromLastWords),
    medianTurnDetectMs: median(turnDetect),
    medianTtfbMs,
  };
}

// ------------------------------------------------------------------ store

interface TimelineState {
  events: TimelineEvent[];
  /** performance.now() at session start; null until the first event. */
  t0: number | null;
  /** True while events are being captured live. */
  live: boolean;
  /** Record an event; `backdateMs` shifts it earlier (e.g. VAD confirmation delay). */
  push: (type: TimelineEventType, data?: unknown, backdateMs?: number) => void;
  reset: () => void;
  setLive: (live: boolean) => void;
  load: (events: TimelineEvent[]) => void;
}

export const useTimelineStore = create<TimelineState>()((set, get) => ({
  events: [],
  t0: null,
  live: false,
  push: (type, data, backdateMs = 0) => {
    const now = performance.now();
    let { t0 } = get();
    if (t0 === null) {
      t0 = now;
      set({ t0 });
    }
    const ev: TimelineEvent = { t: Math.max(0, Math.round(now - t0 - backdateMs)), type, data };
    // Keep events time-ordered even when one is backdated.
    set((s) => {
      const events = [...s.events, ev];
      if (backdateMs > 0) events.sort((a, b) => a.t - b.t);
      return { events };
    });
  },
  reset: () => set({ events: [], t0: null }),
  setLive: (live) => set({ live }),
  load: (events) => set({ events, t0: null, live: false }),
}));

/** Current session time (ms) for drawing still-open spans. */
export function sessionNow(): number {
  const { t0, live, events } = useTimelineStore.getState();
  if (t0 === null || !live) return events.length ? events[events.length - 1]!.t : 0;
  return performance.now() - t0;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function formatSecs(ms: number | undefined, digits = 2): string {
  return ms === undefined ? "—" : `${(ms / 1000).toFixed(digits)}s`;
}
