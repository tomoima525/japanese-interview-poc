"""Japanese interviewer voice agent (Pipecat cascade: STT → LLM → TTS).

Transport: SmallWebRTC (peer-to-peer, runs locally — no media server needed).

Run:
    uv run bot.py            # serves http://localhost:7860 (SmallWebRTC)

The React client in ../client talks to this server through the Pipecat
runner's /start + /sessions/{id}/api/offer endpoints.
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import (
    PipelineParams,
    PipelineWorker,
    ProcessorUnusablePolicy,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

from providers import create_llm, create_stt, create_tts
from timeline_observer import VADRelayObserver

load_dotenv(override=True)

DEFAULT_ROLE = "ソフトウェアエンジニア"

# Silence (s) before the turn model is asked whether the candidate is done.
# Japanese answers often pause ~0.5-0.7s between sentences ending in 「〜ました。」,
# which Smart Turn already judges complete; a slightly longer wait keeps the
# interviewer from cutting in mid-answer. Lower it for snappier small talk.
VAD_STOP_SECS = float(os.getenv("VAD_STOP_SECS", "0.8"))

SYSTEM_PROMPT_TEMPLATE = """\
あなたは採用面接官の「佐藤」です。これから「{role}」ポジションの一次面接を日本語の音声で行います。

# 進め方
- 最初に短く自己紹介し、面接の流れ（約10分、質問は4〜5問）を説明してから、候補者に簡単な自己紹介をお願いしてください。
- 質問は必ず一度に一つだけ。候補者の回答を受けて、具体的なエピソード・役割・数字・学びを深掘りする追加質問を最大1〜2回してください。
- 主なテーマ: 経歴とこれまでの役割 / 最近取り組んだ技術的に難しい課題 / チームでの協働や対立の解消 / 志望動機 / 候補者からの質問。
- 候補者の話を遮らず、相槌は「なるほど」「ありがとうございます」程度に短く。回答を評価・採点する発言はしないでください。
- 全テーマが終わったら、候補者からの質問を受け付け、最後にお礼を述べて今後の流れ（後日メールで連絡）を伝えて締めくくってください。

# 話し方（音声で読み上げられます）
- 丁寧なビジネス敬語（です・ます調）で、自然な話し言葉にしてください。
- 1回の発話は2文以下で短く。箇条書き、記号、絵文字、マークダウン、英語の略語の多用は避けてください。
- 数字や固有名詞は読み上げやすい形で書いてください。
- 候補者が英語で話した場合も、日本語で返答してください。
"""

# SmallWebRTC is the only transport this POC enables.
transport_params = {
    "webrtc": lambda: TransportParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
    ),
}


def _body(runner_args: RunnerArguments) -> dict[str, Any]:
    body = getattr(runner_args, "body", None)
    return body if isinstance(body, dict) else {}


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    body = _body(runner_args)
    role = str(body.get("role") or DEFAULT_ROLE)[:80]
    logger.info(f"Starting interviewer bot (role={role})")

    stt, stt_info = create_stt()
    tts, tts_info = create_tts()
    llm, llm_info = create_llm(SYSTEM_PROMPT_TEMPLATE.format(role=role))

    vad_params = VADParams(stop_secs=VAD_STOP_SECS)
    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer(params=vad_params)),
    )

    pipeline = Pipeline(
        [
            transport.input(),  # mic audio from the browser (SmallWebRTC)
            stt,  # Japanese speech → text
            user_aggregator,  # turn detection + user context
            llm,  # OpenAI
            tts,  # Japanese text → speech
            transport.output(),  # audio back to the browser
            assistant_aggregator,  # what the bot actually said
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,  # TTFB / processing metrics → RTVI "metrics" events
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    # Raw VAD segments let the client draw the candidate's actual speech
    # separately from the (smart-turn) user turn boundaries.
    worker.add_observer(
        VADRelayObserver(
            worker.rtvi, start_secs=vad_params.start_secs, stop_secs=vad_params.stop_secs
        )
    )

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        logger.info("Client ready — sending config and starting the interview")
        await rtvi.send_server_message(
            {
                "type": "session-config",
                "role": role,
                "services": [stt_info.as_dict(), llm_info.as_dict(), tts_info.as_dict()],
            }
        )
        context.add_message(
            {
                "role": "developer",
                "content": "面接を開始してください。まず自己紹介と面接の流れの説明から始めてください。",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    """Entry point used by the Pipecat runner (and Pipecat Cloud)."""
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    import sys

    from pipecat.runner.run import main

    # Default to the SmallWebRTC transport when no -t/--transport flag is given.
    if not any(a in ("-t", "--transport") or a.startswith("--transport=") for a in sys.argv[1:]):
        sys.argv += ["-t", "webrtc"]
    main()
