"use client";

import {
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { MicIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";

import { AudioVisualizerBar } from "@/components/pipecat/audio-visualizer-bar";
import { cn } from "@/lib/utils";

import { Panel } from "./Panel";

type Speaker = "idle" | "listening" | "thinking" | "speaking";

function StatusPill({ state }: { state: Speaker }) {
  const map: Record<Speaker, [string, string]> = {
    idle: ["待機中", "bg-muted text-muted-foreground"],
    listening: ["聞いています", "bg-blue-500/20 text-blue-300"],
    thinking: ["考え中", "bg-violet-500/20 text-violet-300"],
    speaking: ["話しています", "bg-emerald-500/20 text-emerald-300"],
  };
  const [label, cls] = map[state];
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

/** Live audio interface: interviewer + candidate spectra and who holds the floor. */
export function AudioPanel({ className }: { className?: string }) {
  const transportState = usePipecatClientTransportState();
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, () => {
    setBotSpeaking(true);
    setBotThinking(false);
  });
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, () => setBotSpeaking(false));
  useRTVIClientEvent(RTVIEvent.BotLlmStarted, () => setBotThinking(true));
  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking, () => {
    setUserSpeaking(true);
    setBotThinking(false);
  });
  useRTVIClientEvent(RTVIEvent.UserStoppedSpeaking, () => setUserSpeaking(false));
  useRTVIClientEvent(RTVIEvent.Disconnected, () => {
    setBotSpeaking(false);
    setBotThinking(false);
    setUserSpeaking(false);
  });

  const connecting =
    transportState === "authenticating" ||
    transportState === "authenticated" ||
    transportState === "connecting" ||
    transportState === "connected";
  const ready = transportState === "ready";

  const botState: Speaker = !ready ? "idle" : botSpeaking ? "speaking" : botThinking ? "thinking" : "listening";
  const userState: Speaker = !ready ? "idle" : userSpeaking ? "speaking" : botSpeaking ? "listening" : "idle";

  return (
    <Panel aria-label="Audio" className={cn("grid grid-cols-2 divide-x", className)}>
      <div className={cn("flex flex-col gap-2 p-3 transition-colors", botSpeaking && "bg-emerald-500/5")}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Volume2Icon className="size-4 text-emerald-400" /> 面接官 Interviewer
          </span>
          <StatusPill state={botState} />
        </div>
        <div className="h-16 text-emerald-400">
          <AudioVisualizerBar
            participantType="bot"
            barCount={24}
            barWidth={6}
            barGap={6}
            barMaxHeight={60}
            barOrigin="center"
            isConnecting={connecting}
            isThinking={ready && botThinking && !botSpeaking}
          />
        </div>
      </div>
      <div className={cn("flex flex-col gap-2 p-3 transition-colors", userSpeaking && "bg-blue-500/5")}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <MicIcon className="size-4 text-blue-400" /> 候補者 Candidate (you)
          </span>
          <StatusPill state={userState} />
        </div>
        <div className="h-16 text-blue-400">
          <AudioVisualizerBar
            participantType="local"
            barCount={24}
            barWidth={6}
            barGap={6}
            barMaxHeight={60}
            barOrigin="center"
            isConnecting={connecting}
          />
        </div>
      </div>
    </Panel>
  );
}
