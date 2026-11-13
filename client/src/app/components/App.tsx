"use client";

import { usePipecatClient, usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ConnectButton } from "@/components/pipecat/connect-button";
import { UserAudioControl } from "@/components/pipecat/user-audio-control";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTimeline } from "@/hooks/use-timeline";
import { useTimelineCapture } from "@/hooks/use-timeline-capture";
import { cn } from "@/lib/utils";

import { AudioPanel } from "./AudioPanel";
import { ChatPanel } from "./ChatPanel";
import { EventsPanel } from "./EventsPanel";
import { TimingPanel } from "./TimingPanel";

interface AppProps {
  onConnect: () => void;
  onDisconnect: () => void;
  error: string | null;
  onDismissError: () => void;
  role: string;
  onRoleChange: (role: string) => void;
}

function ServiceBadges() {
  const { model } = useTimeline();
  const services = model.config?.services;
  if (!services?.length) {
    return <span className="text-xs text-muted-foreground">STT → LLM → TTS (cascade) · SmallWebRTC</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {services.map((s) => (
        <span key={s.kind} className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-[11px]">
          <span className="text-muted-foreground uppercase">{s.kind}</span> {s.provider}/{s.model}
        </span>
      ))}
    </div>
  );
}

export const App = ({ onConnect, onDisconnect, error, onDismissError, role, onRoleChange }: AppProps) => {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const [showEvents, setShowEvents] = useState(false);
  useTimelineCapture();

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) client.initDevices().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const idle = transportState === "disconnected" || transportState === "initialized" || transportState === "error";

  return (
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">AI面接 POC <span className="font-normal text-muted-foreground">· Japanese interviewer</span></h1>
          <ServiceBadges />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            ポジション
            <Input
              value={role}
              onChange={(e) => onRoleChange(e.target.value)}
              disabled={!idle}
              className="h-9 w-48"
              aria-label="Interview role"
            />
          </label>
          <UserAudioControl size="lg" />
          <ConnectButton size="lg" onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Session error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismissError}>
              <XIcon />
            </Button>
          </AlertAction>
        </Alert>
      )}

      <AudioPanel className="shrink-0" />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <ChatPanel className="min-h-[320px]" />
        <TimingPanel className="min-h-[320px]" />
      </div>

      <div className="shrink-0">
        <button
          type="button"
          onClick={() => setShowEvents((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", !showEvents && "-rotate-90")} />
          Raw RTVI events
        </button>
        {showEvents && <EventsPanel className="mt-2 h-56" resetKey="smallwebrtc" />}
      </div>
    </div>
  );
};
