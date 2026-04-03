# LocalSub — AI Subtitle Generator & Translator

100% 로컬 AI 기반 자막 생성 및 번역 데스크톱 앱.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS v4 + Radix UI
- **Desktop**: Tauri 2 (Rust) — IPC, 파일 I/O, 프로세스 관리
- **AI Engine**: Python FastAPI (port 9111)
  - STT: faster-whisper (CTranslate2) / Qwen3-ASR (optional)
  - Translation: llama-cpp-python (GGUF models)
  - Diarization: ONNX Runtime (Silero VAD)
- **Build**: Vite + Cargo, Vitest (tests)

## Architecture

```
React UI ←→ Tauri IPC ←→ Rust Backend ←→ HTTP(9111) ←→ Python FastAPI
                                                            ↓
                                                     AI Models (GPU/CPU)
```

VRAM 관리: STT 시작 전 LLM 해제, 번역 시작 전 Whisper 해제. 동시 로딩 방지.

## Development

```bash
# Prerequisites: Node.js, Rust, Python 3.10+, CUDA toolkit
npm install
pip install -r python-server/requirements.txt
pip install llama-cpp-python  # CUDA build required for GPU

# Dev mode
npm run tauri dev
# Windows에서는 run-dev.bat 사용 (vcvarsall.bat + RUSTFLAGS 설정)

# Tests
npm test
```

## Key Directories

```
src/                  # React frontend
src-tauri/src/        # Rust backend (Tauri commands)
python-server/        # FastAPI AI inference server
  stt_engine.py       # STT (Whisper / Qwen3-ASR dual engine)
  llm_engine.py       # LLM translation (batch=1, rolling summary)
  prompt_builder.py   # Translation prompt construction
  translate_router.py # Translation API endpoints
```

## Model Catalog

`src-tauri/resources/model_catalog.json` — 모델 목록 관리.
Whisper 모델은 `model.bin` + `config.json` + `tokenizer.json` + `vocabulary.*` + `preprocessor_config.json` 필요.
⚠️ Whisper large-v3는 `preprocessor_config.json`이 반드시 있어야 128 mel channels 사용.

## Translation Pipeline

1. STT (Whisper) → segments with timestamps
2. Whisper 해제 (VRAM)
3. Auto-infer media context (첫 100 세그먼트로 장면/장르 추론)
4. LLM 로드 → 세그먼트별 번역 (BATCH_SIZE=1)
5. 25개마다 rolling summary 생성
6. 프롬프트: 심플하게 유지 (9B 모델에 복잡한 프롬프트는 역효과)

## Important Notes

- Python 서버는 앱 시작 시 자동 시작, 크래시 시 2초 후 자동 재시작
- STT/번역 시작 전 서버 health 체크 (최대 30회 대기)
- 프리셋의 모델/언어 설정이 번역에 아직 반영되지 않음 (전역 config 사용) — TODO
- `llama-cpp-python`은 소스 빌드 필요 (CUDA + MSVC). v0.3.18 사용 중
  - Windows 한국어 환경에서 jinja/utils.h 유니코드 빌드 에러 → `-DLLAMA_BUILD_TOOLS=OFF` 불가, 소스 패치 필요
- 앱 식별자: `com.localsub.app`, 데이터: `%APPDATA%/com.localsub.app/`
