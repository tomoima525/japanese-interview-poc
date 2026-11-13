"use client";

import type { TransportState } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { usePipecatClient } from "@pipecat-ai/client-react";
import { useEffect } from "react";

import { type TimelineEventType, useTimelineStore } from "@/lib/timeline";

/**
 * Records the RTVI events the timeline needs, timestamped on arrival.
 * Mount once inside PipecatClientProvider.
 */
export function useTimelineCapture() {
  const client = usePipecatClient();

  useEffect(() => {
    if (!client) return;
    const { push, reset, setLive } = useTimelineStore.getState();

    const on = <A extends unknown[]>(
      event: RTVIEvent,
      handler: (...args: A) => void,
    ) => {
      client.on(event, handler as never);
      return () => client.off(event, handler as never);
    };
    const simple = (event: RTVIEvent, type: TimelineEventType) =>
      on(event, (data?: unknown) => push(type, data));

    let lastState: TransportState | null = null;
    const offs = [
      on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
        // A new connection attempt starts a fresh timeline.
        if (
          (state === "authenticating" || state === "connecting") &&
          lastState !== "authenticating" &&
          lastState !== "connecting"
        ) {
          reset();
          setLive(true);
          push("connected");
        }
        if (state === "disconnected" && lastState !== "disconnected") {
          if (useTimelineStore.getState().t0 !== null) push("disconnected");
          setLive(false);
        }
        lastState = state;
      }),
      simple(RTVIEvent.BotReady, "botReady"),
      simple(RTVIEvent.UserStartedSpeaking, "userTurnStart"),
      simple(RTVIEvent.UserStoppedSpeaking, "userTurnStop"),
      simple(RTVIEvent.BotStartedSpeaking, "botStartedSpeaking"),
      simple(RTVIEvent.BotStoppedSpeaking, "botStoppedSpeaking"),
      simple(RTVIEvent.BotInterrupted, "botInterrupted"),
      simple(RTVIEvent.BotLlmStarted, "botLlmStarted"),
      simple(RTVIEvent.BotLlmStopped, "botLlmStopped"),
      simple(RTVIEvent.BotTtsStarted, "botTtsStarted"),
      simple(RTVIEvent.BotTtsStopped, "botTtsStopped"),
      simple(RTVIEvent.BotOutput, "botOutput"),
      simple(RTVIEvent.Metrics, "metrics"),
      on(
        RTVIEvent.UserInput,
        (data: { text: string; final: boolean; input_type?: string }) => {
          if (data.input_type && data.input_type !== "transcription") return;
          push("userTranscript", {
            text: data.text,
            final: data.final,
            source: "userInput",
          });
        },
      ),
      on(RTVIEvent.UserTranscript, (data: { text: string; final: boolean }) =>
        push("userTranscript", {
          text: data.text,
          final: data.final,
          source: "userTranscript",
        }),
      ),
      on(
        RTVIEvent.ServerMessage,
        (data: { type?: string; speaking?: boolean; offset_ms?: number }) => {
          if (data?.type === "vad")
            push(
              data.speaking ? "vadStart" : "vadStop",
              undefined,
              data.offset_ms ?? 0,
            );
          else if (data?.type === "session-config") push("config", data);
        },
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);
}
