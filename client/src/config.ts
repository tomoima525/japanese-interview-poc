/**
 * Project configuration — SmallWebRTC only (peer-to-peer, runs locally).
 */

import type { APIRequest } from "@pipecat-ai/client-js";

import { registerTransport } from "@/lib/transports";

export type TransportType = "smallwebrtc";

registerTransport("smallwebrtc", async () => {
  const { SmallWebRTCTransport } = await import(
    "@pipecat-ai/small-webrtc-transport"
  );
  return SmallWebRTCTransport;
});

export const DEFAULT_TRANSPORT: TransportType = "smallwebrtc";

export const DEFAULT_ROLE = "ソフトウェアエンジニア";

/** POST /api/start → Pipecat runner /start; `body` reaches the bot as runner_args.body. */
export function startBotParams(role: string): APIRequest {
  return {
    endpoint: "/api/start",
    requestData: {
      createDailyRoom: false,
      enableDefaultIceServers: true,
      transport: "webrtc",
      body: { role },
    },
  };
}
