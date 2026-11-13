"""Stream test_audio/candidate.wav through a Deepgram STT model via Pipecat.

    uv run scripts/stt_check.py flux-general-multi
    uv run scripts/stt_check.py nova-3

Prints interim/final transcripts with timestamps, so Japanese accuracy and
finalization latency can be compared between models.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env", override=True)
logger.remove()
logger.add(sys.stderr, level="WARNING")

from pipecat.frames.frames import (  # noqa: E402
    EndFrame,
    ErrorFrame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
)
from pipecat.pipeline.pipeline import Pipeline  # noqa: E402
from pipecat.pipeline.worker import PipelineParams, PipelineWorker  # noqa: E402
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor  # noqa: E402
from pipecat.workers.runner import WorkerRunner  # noqa: E402

CHUNK_MS = 20


class Collector(FrameProcessor):
    def __init__(self, t0: list[float]):
        super().__init__()
        self._t0 = t0
        self.finals: list[str] = []

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        t = time.monotonic() - self._t0[0]
        if isinstance(frame, TranscriptionFrame):
            self.finals.append(frame.text)
            print(f"[{t:6.2f}s] FINAL   {frame.text}")
        elif isinstance(frame, InterimTranscriptionFrame):
            print(f"[{t:6.2f}s] interim {frame.text}")
        elif isinstance(frame, ErrorFrame):
            print(f"[{t:6.2f}s] ERROR   {frame.error}")
        await self.push_frame(frame, direction)


async def main(model: str):
    os.environ["STT_PROVIDER"] = "deepgram"
    os.environ["DEEPGRAM_STT_MODEL"] = model
    from providers import create_stt

    stt, info = create_stt()
    print(f"STT: {info}")
    t0 = [time.monotonic()]
    collector = Collector(t0)
    worker = PipelineWorker(
        Pipeline([stt, collector]),
        params=PipelineParams(audio_in_sample_rate=16000),
    )

    with wave.open(str(ROOT / "test_audio" / "candidate.wav"), "rb") as w:
        rate = w.getframerate()
        pcm = w.readframes(w.getnframes())
    # Only the speech portion (skip the trailing silence) to keep it short.
    pcm = pcm[: int(80 * rate) * 2]
    step = int(rate * CHUNK_MS / 1000) * 2

    async def feed():
        await asyncio.sleep(2.0)  # let the websocket connect
        t0[0] = time.monotonic()
        for i in range(0, len(pcm), step):
            await worker.queue_frame(
                InputAudioRawFrame(audio=pcm[i : i + step], sample_rate=rate, num_channels=1)
            )
            await asyncio.sleep(CHUNK_MS / 1000)  # real-time pacing
        await asyncio.sleep(3.0)
        await worker.queue_frame(EndFrame())

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await asyncio.gather(runner.run(), feed())
    print("\n=== finals ===")
    print("\n".join(collector.finals) or "(none)")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "flux-general-multi"))
