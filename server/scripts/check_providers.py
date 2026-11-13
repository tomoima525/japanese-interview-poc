"""Check Japanese STT/TTS provider setup and build a fake-mic test clip.

    uv run scripts/check_providers.py

- Lists Deepgram STT models that support Japanese (via /v1/models).
- Lists Cartesia Japanese voices and checks the configured voice exists.
- Probes which Cartesia sonic model ids are accepted (to confirm the latest).
- Synthesizes candidate answers in Japanese (Cartesia, a different voice than
  the interviewer) into test_audio/candidate.wav — used as a fake microphone
  for the end-to-end browser test (scripts/e2e).

Never prints API keys.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
import wave
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env", override=True)

from providers import DEFAULT_CARTESIA_JA_VOICE  # noqa: E402

CARTESIA_VERSION = "2025-04-16"
SAMPLE_RATE = 16000

# What the fake candidate says, with silence (seconds) before each answer.
CANDIDATE_SCRIPT = [
    (
        14.0,
        "はい、山田太郎と申します。現在、ウェブ系の会社でバックエンドエンジニアとして五年ほど働いています。主にゴー言語で決済システムを開発しています。",
    ),
    (
        16.0,
        "最近だと、決済APIのレイテンシ改善に取り組みました。ピーク時にタイムアウトが多発していたので、データベースのロック待ちを調査して、インデックスとトランザクションの範囲を見直しました。",
    ),
    (
        16.0,
        "チームでは週に一度、設計レビューの場を設けていて、意見が対立したときはデータを持ち寄って議論するようにしています。",
    ),
]
TRAILING_SILENCE = 30.0


async def deepgram_models(session: aiohttp.ClientSession):
    key = os.getenv("DEEPGRAM_API_KEY")
    if not key:
        print("Deepgram: no key")
        return
    async with session.get(
        "https://api.deepgram.com/v1/models", headers={"Authorization": f"Token {key}"}
    ) as r:
        if r.status != 200:
            print(f"Deepgram /v1/models → HTTP {r.status}")
            return
        data = await r.json()
    rows = set()
    for m in data.get("stt", []):
        langs = m.get("languages") or []
        ja = [lang for lang in langs if lang.startswith("ja") or lang == "multi"]
        if ja:
            rows.add(
                f"  {m.get('canonical_name')}  arch={m.get('architecture')}  "
                f"version={m.get('version')}  streaming={m.get('streaming')}  langs={ja}"
            )
    print("Deepgram STT models supporting Japanese:")
    print("\n".join(sorted(rows)) or "  (none listed)")


async def cartesia_voices(session: aiohttp.ClientSession) -> list[dict]:
    key = os.environ["CARTESIA_API_KEY"]
    headers = {"X-API-Key": key, "Cartesia-Version": CARTESIA_VERSION}
    voices: list[dict] = []
    url = "https://api.cartesia.ai/voices?language=ja&limit=100"
    async with session.get(url, headers=headers) as r:
        if r.status != 200:
            print(f"Cartesia /voices → HTTP {r.status}: {(await r.text())[:200]}")
            return []
        data = await r.json()
        voices = data.get("data", data) if isinstance(data, dict) else data
    print(f"Cartesia Japanese voices: {len(voices)}")
    for v in voices[:25]:
        print(f"  {v['id']}  {v.get('name')}  [{v.get('gender', '')}]")
    configured = os.getenv("CARTESIA_VOICE_ID") or DEFAULT_CARTESIA_JA_VOICE
    ok = any(v["id"] == configured for v in voices)
    print(f"Configured interviewer voice {configured}: {'FOUND' if ok else 'NOT in ja list'}")
    return voices


async def cartesia_tts(session, text: str, voice: str, model: str) -> tuple[int, bytes]:
    key = os.environ["CARTESIA_API_KEY"]
    headers = {
        "X-API-Key": key,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
    }
    body = {
        "model_id": model,
        "transcript": text,
        "voice": {"mode": "id", "id": voice},
        "language": "ja",
        "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": SAMPLE_RATE},
    }
    async with session.post("https://api.cartesia.ai/tts/bytes", json=body, headers=headers) as r:
        return r.status, await r.read()


async def main():
    async with aiohttp.ClientSession() as session:
        await deepgram_models(session)
        print()
        voices = await cartesia_voices(session)
        print()

        interviewer = os.getenv("CARTESIA_VOICE_ID") or DEFAULT_CARTESIA_JA_VOICE
        print("Cartesia model probe (short ja synthesis):")
        for model in ["sonic-3.6", "sonic-3.7", "sonic-4", "sonic-3-latest", "sonic-latest"]:
            status, audio = await cartesia_tts(session, "テストです。", interviewer, model)
            print(f"  {model:15s} HTTP {status}  {len(audio)} bytes")

        # Candidate voice: a male Japanese voice different from the interviewer.
        cand = next(
            (
                v["id"]
                for v in voices
                if v["id"] != interviewer and (v.get("gender") or "").startswith("m")
            ),
            next((v["id"] for v in voices if v["id"] != interviewer), interviewer),
        )
        print(f"\nCandidate voice for the fake mic: {cand}")
        pcm = bytearray()
        for silence, text in CANDIDATE_SCRIPT:
            pcm += b"\x00\x00" * int(silence * SAMPLE_RATE)
            status, audio = await cartesia_tts(session, text, cand, "sonic-3.6")
            if status != 200:
                raise SystemExit(f"Cartesia TTS failed: HTTP {status} {audio[:200]!r}")
            pcm += audio
        pcm += b"\x00\x00" * int(TRAILING_SILENCE * SAMPLE_RATE)

    out = ROOT / "test_audio" / "candidate.wav"
    out.parent.mkdir(exist_ok=True)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(pcm))
    out.write_bytes(buf.getvalue())
    print(f"Wrote {out} ({len(pcm) / 2 / SAMPLE_RATE:.1f}s)")


if __name__ == "__main__":
    asyncio.run(main())
