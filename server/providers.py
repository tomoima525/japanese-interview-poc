"""Japanese-capable STT / TTS / LLM service factories.

Provider choice is driven by environment variables so the POC can compare
vendors without code changes:

    STT_PROVIDER = soniox | deepgram | elevenlabs     (default: auto)
    TTS_PROVIDER = cartesia | elevenlabs | soniox     (default: auto)

"auto" picks the first provider in the preference list whose API key is set.
Preference order reflects Japanese quality for a real-time voice agent:

  STT: Soniox (strong Japanese accuracy + fast endpointing) > ElevenLabs Scribe
       realtime > Deepgram nova-3 (fallback requested in the brief). "nova-3"
       resolves to Deepgram's newest Japanese build; DEEPGRAM_STT_MODEL=
       flux-general-multi selects Flux Multilingual (newest model family, with
       its own end-of-turn detection) — in our tests it was slower and less
       accurate on Japanese technical terms than nova-3.
  TTS: Cartesia sonic-3.6 (lowest latency, native Japanese voices) >
       ElevenLabs flash v2.5 > Soniox TTS
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from loguru import logger
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transcriptions.language import Language

# Cartesia "Japanese Woman Conversational". Override with CARTESIA_VOICE_ID.
DEFAULT_CARTESIA_JA_VOICE = "2b568345-1d48-4047-b25f-7baccf842eb0"


@dataclass
class ProviderInfo:
    kind: str
    provider: str
    model: str

    def as_dict(self) -> dict:
        return {"kind": self.kind, "provider": self.provider, "model": self.model}


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value else default


def _pick(kind: str, requested: str | None, preference: list[tuple[str, str]]) -> str:
    """Resolve 'auto' (or unset) to the first provider whose key is present."""
    if requested and requested != "auto":
        return requested
    for provider, key_var in preference:
        if _env(key_var):
            return provider
    raise RuntimeError(
        f"No API key found for any {kind} provider. Set one of: "
        + ", ".join(k for _, k in preference)
    )


# --------------------------------------------------------------------------- STT


def create_stt():
    provider = _pick(
        "STT",
        _env("STT_PROVIDER"),
        [
            ("soniox", "SONIOX_API_KEY"),
            ("elevenlabs", "ELEVENLABS_API_KEY"),
            ("deepgram", "DEEPGRAM_API_KEY"),
        ],
    )

    if provider == "soniox":
        from pipecat.services.soniox.stt import SonioxSTTService

        model = _env("SONIOX_STT_MODEL", "stt-rt-v6")
        stt = SonioxSTTService(
            api_key=os.environ["SONIOX_API_KEY"],
            settings=SonioxSTTService.Settings(
                model=model,
                language_hints=[Language.JA],
                language_hints_strict=True,
            ),
        )
    elif provider == "elevenlabs":
        from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService

        model = _env("ELEVENLABS_STT_MODEL", "scribe_v2_realtime")
        stt = ElevenLabsRealtimeSTTService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            settings=ElevenLabsRealtimeSTTService.Settings(
                model=model,
                language=Language.JA,
            ),
        )
    elif provider == "deepgram":
        model = _env("DEEPGRAM_STT_MODEL", "nova-3")
        if model.startswith("flux"):
            # Flux: Deepgram's newest conversational STT with built-in
            # end-of-turn detection; Pipecat adopts its turn strategies.
            from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService

            stt = DeepgramFluxSTTService(
                api_key=os.environ["DEEPGRAM_API_KEY"],
                settings=DeepgramFluxSTTService.Settings(
                    model=model,
                    language_hints=[Language.JA],
                ),
            )
        else:
            from pipecat.services.deepgram.stt import DeepgramSTTService

            stt = DeepgramSTTService(
                api_key=os.environ["DEEPGRAM_API_KEY"],
                settings=DeepgramSTTService.Settings(
                    model=model,
                    language=Language.JA,
                    smart_format=True,
                    punctuate=True,
                ),
            )
    else:
        raise RuntimeError(f"Unknown STT_PROVIDER: {provider}")

    info = ProviderInfo("stt", provider, model)
    logger.info(f"STT → {info}")
    return stt, info


# --------------------------------------------------------------------------- TTS


def create_tts():
    provider = _pick(
        "TTS",
        _env("TTS_PROVIDER"),
        [
            ("cartesia", "CARTESIA_API_KEY"),
            ("elevenlabs", "ELEVENLABS_API_KEY"),
            ("soniox", "SONIOX_API_KEY"),
        ],
    )

    if provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        model = _env("CARTESIA_TTS_MODEL", "sonic-3.6")
        tts = CartesiaTTSService(
            api_key=os.environ["CARTESIA_API_KEY"],
            settings=CartesiaTTSService.Settings(
                model=model,
                voice=_env("CARTESIA_VOICE_ID", DEFAULT_CARTESIA_JA_VOICE),
                language=Language.JA,
            ),
        )
    elif provider == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        model = _env("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5")
        voice = _env("ELEVENLABS_VOICE_ID")
        if not voice:
            raise RuntimeError("ELEVENLABS_VOICE_ID is required for ElevenLabs TTS")
        tts = ElevenLabsTTSService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            settings=ElevenLabsTTSService.Settings(
                model=model,
                voice=voice,
                language=Language.JA,
            ),
        )
    elif provider == "soniox":
        from pipecat.services.soniox.tts import SonioxTTSService

        model = _env("SONIOX_TTS_MODEL", "tts-rt-v2")
        settings = SonioxTTSService.Settings(model=model, language=Language.JA)
        if voice := _env("SONIOX_VOICE"):
            settings.voice = voice
        tts = SonioxTTSService(api_key=os.environ["SONIOX_API_KEY"], settings=settings)
    else:
        raise RuntimeError(f"Unknown TTS_PROVIDER: {provider}")

    info = ProviderInfo("tts", provider, model)
    logger.info(f"TTS → {info}")
    return tts, info


# --------------------------------------------------------------------------- LLM


def create_llm(system_instruction: str):
    model = _env("OPENAI_MODEL", "gpt-4.1")
    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAILLMService.Settings(
            model=model,
            system_instruction=system_instruction,
        ),
    )
    info = ProviderInfo("llm", "openai", model)
    logger.info(f"LLM → {info}")
    return llm, info
