"use client";

import { PipecatClientAudio, PipecatClientProvider } from "@pipecat-ai/client-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { usePipecatApp } from "@/hooks/use-pipecat-app";

import { DEFAULT_ROLE, DEFAULT_TRANSPORT, startBotParams } from "../config";
import { App } from "./components/App";

export default function Home() {
  const [role, setRole] = useState(DEFAULT_ROLE);
  const params = useMemo(() => startBotParams(role.trim() || DEFAULT_ROLE), [role]);

  const { client, connect, disconnect, error, clearError } = usePipecatApp({
    transportType: DEFAULT_TRANSPORT,
    startBotParams: params,
  });

  if (!client) {
    return (
      <main className="flex h-dvh items-center justify-center p-4">
        {error ? (
          <Alert variant="destructive" className="max-w-md">
            <AlertTitle>Failed to set up the client</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <Spinner className="size-8" />
        )}
      </main>
    );
  }

  return (
    <PipecatClientProvider client={client}>
      <main className="h-dvh overflow-hidden">
        <App
          onConnect={connect}
          onDisconnect={disconnect}
          error={error}
          onDismissError={clearError}
          role={role}
          onRoleChange={setRole}
        />
      </main>
      <PipecatClientAudio />
    </PipecatClientProvider>
  );
}
