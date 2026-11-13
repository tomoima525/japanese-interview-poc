# AI面接 POC — Japanese interviewer voice agent (Pipecat)

A local proof-of-concept of a **Japanese-speaking interviewer** built on
[Pipecat](https://github.com/pipecat-ai/pipecat) 1.16 as a **cascade**:

```
Browser mic ──SmallWebRTC──▶ VAD + Smart Turn v3 ─▶ STT (ja) ─▶ OpenAI LLM ─▶ TTS (ja) ──SmallWebRTC──▶ Browser speaker
                                                         │                                       │
                                                         └──────── RTVI events (transcripts, turns, metrics) ─▶ UI
```

* **Backend** — `server/`: a Pipecat bot (`bot.py`) run by the Pipecat development runner,
  which serves the SmallWebRTC signalling endpoints (`/start`, `/sessions/{id}/api/offer`) on
  `http://localhost:7860`. It's adapted from Pipecat's `examples/getting-started/06-voice-agent.py`.
* **Frontend** — `client/`: Next.js app based on the official
  [`pipecat-examples/simple-chatbot/client/react`](https://github.com/pipecat-ai/pipecat-examples/tree/main/simple-chatbot/client/react)
  sample (`@pipecat-ai/client-js`, `client-react`, `small-webrtc-transport`), reduced to
  SmallWebRTC and extended with:
  * **Audio interface**: live spectra for the interviewer and the candidate, plus who holds the floor
    (待機中 idle / 聞いています listening / 考え中 thinking / 話しています speaking).
  * **Chat bubbles**: interviewer (green) and candidate (blue), with timing under each bubble
    (`start → end (duration)`, and for replies the latency from the candidate's turn end and
    from their last words). Unspoken text from an interrupted reply is struck through.
  * **Conversation tracks (timing panel)**: a scrollable timeline with tracks for
    candidate speech (VAD, with ticks when new words arrive), candidate turn (Smart Turn start → end),
    LLM generation, TTS synthesis, interviewer audio, turn-end → reply latency brackets, and
    barge-in markers. Above it are stat tiles: turns, median response latency, voice-to-voice latency,
    turn-detection delay, and STT/LLM/TTS TTFB. You can export a session as JSON (Copy/Download) and
    reload it later (Load JSON); **Sample** loads a demo session, so the UI works without API keys.

## Japanese STT / TTS choice

I found no independent, current head-to-head Japanese benchmark for streaming APIs, so the providers
are **switchable by env var**. `auto` picks the first one whose API key is set:

| | Default order (`auto`) | Pipecat service | Notes |
|---|---|---|---|
| **STT** | 1. **Soniox** `stt-rt-v6` | `SonioxSTTService` | Strong Japanese accuracy, fast endpointing; `language_hints=[ja]`, strict |
| | 2. ElevenLabs Scribe v2 realtime | `ElevenLabsRealtimeSTTService` | `language=ja` |
| | 3. **Deepgram** `nova-3` (or `flux-general-multi`) | `DeepgramSTTService` / `DeepgramFluxSTTService` | Fallback, `language=ja` |
| **TTS** | 1. **Cartesia** `sonic-3.6` | `CartesiaTTSService` | Lowest latency, native Japanese voices (default: *Japanese Woman Conversational*) |
| | 2. ElevenLabs `eleven_flash_v2_5` | `ElevenLabsTTSService` | Needs `ELEVENLABS_VOICE_ID` |
| | 3. Soniox `tts-rt-v2` | `SonioxTTSService` | |
| **LLM** | OpenAI `gpt-4.1` (`OPENAI_MODEL`) | `OpenAILLMService` | Japanese interviewer system prompt in `bot.py` |

The minimal setup that matches the brief: `OPENAI_API_KEY` + `DEEPGRAM_API_KEY` + `CARTESIA_API_KEY`.
Add `SONIOX_API_KEY` to switch STT to Soniox automatically. To compare providers, set them explicitly,
for example `STT_PROVIDER=deepgram TTS_PROVIDER=elevenlabs`. The models in use are shown as badges in the UI header.

End of turn is detected by Pipecat's default **Smart Turn v3**, which supports Japanese, on top of Silero VAD.
The VAD waits `VAD_STOP_SECS=0.8`s of silence (Pipecat default: 0.2) before asking Smart Turn.
Japanese answers often pause about 0.7s after a sentence like 「…取り組みました。」, which Smart Turn already
judges complete. At 0.2s the interviewer cut in mid-answer.

### Model check and measured results (2026-11-12)

Latest models, verified against the providers' APIs:
* **Cartesia:** `sonic-3.6` is the newest model ID. `sonic-3.7` and `sonic-4` return 404, and `sonic-latest` resolves to 3.6.
  The default voice exists in the Japanese voice list (77 voices; see `scripts/check_providers.py`).
* **Deepgram:** `nova-3` resolves to the newest Japanese build (`2026-11-04`, `ja`/`ja-JP`, streaming).
  The newer **Flux Multilingual** (`flux-general-multi`, has its own end-of-turn detection) is selectable with
  `DEEPGRAM_STT_MODEL=flux-general-multi`.

End-to-end runs of the real frontend and bot over SmallWebRTC. Chrome ran headless with a fake mic playing three
synthesized Japanese interview answers (`client/scripts/e2e.mjs`):

| STT setup | Japanese terms (Go言語 / レイテンシ / インデックスとトランザクション) | Premature turn ends | Median reply after last words | Median reply after turn end |
|---|---|---|---|---|
| Flux Multilingual | ✗ 合言語 / 零点種 / インデックス投資 | 1 | 1.48s | 0.81s |
| nova-3, VAD stop 0.2s | ✓ all correct | 2 (interviewer cut in) | 0.78s | 0.70s |
| **nova-3, VAD stop 0.8s (default)** | ✓ all correct | **0** | 1.48s | 0.68s |

The LLM (gpt-4.1) took about 510–730ms to first token, and Cartesia TTS took about 90–100ms to first audio.

### Re-run the checks

```bash
cd server && uv run scripts/check_providers.py     # models/voices + builds test_audio/candidate.wav
cd server && uv run scripts/stt_check.py nova-3    # stream the clip through an STT model
cd client && npm run e2e -- 105 my-run             # full browser test → client/e2e-output/my-run.{png,json,txt}
```
`npm run e2e` needs both servers running. The `.json` output can be opened with **Load JSON** in the UI.

## Run it

Prerequisites: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
# 1) backend
cd server
cp env.example .env        # fill in OPENAI_API_KEY + STT/TTS keys
uv sync
uv run bot.py              # → http://localhost:7860 (SmallWebRTC runner)
```

```bash
# 2) frontend (another terminal)
cd client
npm install
npm run dev                # → http://localhost:3000
```

Open http://localhost:3000, optionally change ポジション (the role being interviewed for), press
**Connect**, allow the microphone, and answer in Japanese. The interviewer introduces itself first.
`client/env.example` shows `BOT_START_URL` if the bot isn't on `localhost:7860`.

## Files

```
server/
  bot.py               pipeline, interviewer prompt, RTVI hooks (session-config message, kick-off)
  providers.py         Japanese STT/TTS/LLM factories + provider auto-selection
  timeline_observer.py relays raw VAD start/stop to the client (client-js doesn't surface them)
  scripts/             provider check, STT check
  env.example
client/src/
  lib/timeline.ts               raw RTVI events → tracks, chat messages, stats (pure, replayable)
  hooks/use-timeline-capture.ts timestamps RTVI events on arrival
  app/components/AudioPanel.tsx  audio interface
  app/components/ChatPanel.tsx   chat bubbles with timing
  app/components/TimingPanel.tsx stat tiles + conversation tracks + JSON export/import
client/public/sample-timeline.json  demo session for the Sample button
```

## Notes / limitations

* All timings are measured on the **client clock** when RTVI events arrive. Each one includes
  the one-way WebRTC data-channel delay, which is negligible locally. TTFB values come from Pipecat's
  server-side metrics.
* "Response after last words" uses the last VAD stop in the candidate's turn, so it is the
  closest proxy for voice-to-voice latency.
* SmallWebRTC is peer-to-peer and meant for local or dev use. For production, switch the runner transport to Daily
  or LiveKit; the pipeline code doesn't change.
