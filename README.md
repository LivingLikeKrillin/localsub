# SubText

AI-powered local subtitle translator. Speech-to-text and LLM translation running entirely on your machine — no cloud, no data leaks.

## Features

- **Offline-first** — All processing happens locally. Your data never leaves your device.
- **STT pipeline** — Audio → subtitle segments via [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2)
- **LLM translation** — Segment-by-segment translation via [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) (GGUF models)
- **Model management** — Download, verify (SHA-256), and switch between GGUF models from HuggingFace
- **Hardware-aware profiles** — Lite / Balanced / Power presets based on detected RAM & GPU VRAM
- **Subtitle editor** — Waveform visualization, split/merge, inline editing, audio playback
- **Export formats** — SRT, VTT, ASS, TXT (with BOM)
- **Translation presets & glossaries** — Reusable style/terminology configurations
- **Bilingual UI** — English & Korean

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (React 18 + TypeScript + Vite)    │
│  shadcn/ui · Tailwind v4 · lucide-react     │
├─────────────────────────────────────────────┤
│  Tauri 2 Shell (Rust)                       │
│  IPC · Model downloads · HW detection       │
│  Config/Preset/Subtitle CRUD                │
├──────────────── HTTP/SSE ───────────────────┤
│  FastAPI Server (Python 3.12)               │
│  faster-whisper · llama-cpp-python · psutil  │
│  localhost:9111                              │
└─────────────────────────────────────────────┘
```

**Pages**: Dashboard · Editor · Presets · Settings

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| Rust | 1.70+ |
| Python | 3.12 (embeddable, bundled at runtime) |

NVIDIA GPU is optional — CUDA acceleration is auto-detected and used when available.

## Getting Started

```bash
# Install dependencies
npm install

# Development (Vite + Tauri)
npm run tauri dev

# Production build
npm run tauri build
```

The first launch runs a setup wizard that installs the bundled Python environment and downloads selected models.

## Project Structure

```
src/                     # React frontend
├── components/
│   ├── ui/              # shadcn/ui components (47+)
│   ├── editor/          # Waveform, SubtitleList, EditPanel
│   ├── dashboard/       # Job table, NewJobDialog
│   ├── presets/          # PresetCard, VocabCard, CRUD dialogs
│   └── settings/        # 6-section settings panel
├── hooks/               # useConfig, useRuntime, usePipeline, ...
├── i18n/locales/        # en.json, ko.json
└── app.css              # Theme system (CSS variables, light/dark)

src-tauri/src/           # Rust backend
├── lib.rs               # Tauri app entry
├── commands*.rs         # IPC command handlers
├── model_downloader.rs  # HuggingFace download with resume
├── hw_detector.rs       # CPU/GPU/RAM/disk detection
├── config_manager.rs    # App configuration CRUD
├── preset_manager.rs    # Translation presets
├── subtitle_manager.rs  # Per-job subtitle storage
└── python_manager.rs    # Python subprocess lifecycle

python-server/           # FastAPI backend
├── main.py              # Server entry (uvicorn)
├── stt_engine.py        # faster-whisper wrapper
├── llm_engine.py        # llama-cpp-python wrapper
├── prompt_builder.py    # Context window & glossary injection
└── runtime_router.py    # Model load/unload, resource polling
```

## Data Paths

All user data is stored under `%APPDATA%/com.subtext.app/`:

| Path | Content |
|------|---------|
| `config.json` | App configuration |
| `models/` | Downloaded GGUF models |
| `presets/` | Translation presets |
| `vocabularies/` | Glossary files |
| `jobs/` | Job metadata & subtitles |
| `python-env/` | Bundled Python runtime |

## Tech Stack

**Frontend**: React 18 · TypeScript · Vite 6 · Tailwind CSS v4 · shadcn/ui · Radix UI · lucide-react · react-resizable-panels · sonner · i18next

**Desktop**: Tauri 2 · reqwest · tokio · serde · sysinfo · tauri-plugin-dialog

**Backend**: FastAPI · uvicorn · faster-whisper · llama-cpp-python · psutil · sse-starlette

## License

Private — All rights reserved.
