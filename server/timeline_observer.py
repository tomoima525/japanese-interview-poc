"""Relays raw VAD speech segments to the client for the timeline view.

The JS client (client-js) does not surface RTVI's `vad-user-*` messages as
events, so we forward them as generic server messages instead:

    {"type": "vad", "speaking": true|false, "offset_ms": <int>}

`offset_ms` is how long after the actual speech edge the VAD confirmed it
(start_secs / stop_secs); the client backdates the event by that much so
"last words" reflects when the candidate really stopped talking.

The client timestamps them on arrival, the same way it timestamps every other
RTVI event, so all timeline tracks share one clock.
"""

from __future__ import annotations

from pipecat.frames.frames import (
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.processors.frameworks.rtvi.processor import RTVIProcessor


class VADRelayObserver(BaseObserver):
    def __init__(self, rtvi: RTVIProcessor, *, start_secs: float, stop_secs: float):
        super().__init__(observe_every_push=False)
        self._rtvi = rtvi
        self._start_ms = int(start_secs * 1000)
        self._stop_ms = int(stop_secs * 1000)
        self._seen: set[int] = set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if not isinstance(frame, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)):
            return
        if frame.id in self._seen:
            return
        self._seen.add(frame.id)
        if len(self._seen) > 1000:
            self._seen.clear()
        speaking = isinstance(frame, VADUserStartedSpeakingFrame)
        offset = self._start_ms if speaking else self._stop_ms
        await self._rtvi.send_server_message(
            {"type": "vad", "speaking": speaking, "offset_ms": offset}
        )
