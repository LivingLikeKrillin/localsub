<p align="center">
  <img src="public/logo.png" alt="LocalSub" width="120" />
</p>
<h1 align="center">LocalSub</h1>
<p align="center">
  <strong>내 영상. 내 언어. 내 컴퓨터.</strong><br/>
  <sub>클라우드 없이, 구독 없이, 타협 없이 — 온전히 로컬에서 돌아가는 AI 자막 도구.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri_2-Rust-F46623?style=flat-square&logo=rust" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/React_18-TypeScript-3178C6?style=flat-square&logo=typescript" alt="React 18" />
  <img src="https://img.shields.io/badge/Python-FastAPI-009688?style=flat-square&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/License-Private-555?style=flat-square" alt="License" />
</p>

---

## 한 줄 요약

> 영상을 던지면 자막이 나옵니다. 번역까지. 전부 내 PC에서.

---

## 왜 LocalSub?

자막 만드느라 영상을 어딘가에 업로드하고, 분당 얼마씩 과금되고, 내 데이터가 어디로 가는지 모르는 경험 — 이제 그만.

| | 기존 서비스 | **LocalSub** |
|---|---|---|
| 데이터 | ☁️ 클라우드 업로드 | 🔒 내 PC에서 끝 |
| 비용 | 💳 월 구독 / 분당 과금 | 🆓 무료, 영원히 |
| 인터넷 | 📡 필수 | ✈️ 오프라인 OK |
| GPU | ❌ 서버 의존 | ⚡ 내 GPU 직접 활용 |

---

## 워크플로우

```
📂 파일 드롭  →  🎙️ 음성 인식  →  🗣️ 화자 검출  →  🌐 AI 번역  →  ✏️ 편집  →  💾 내보내기
```

**Drop it.** 영상이든 음성이든 끌어다 놓으세요.

**Transcribe it.** AI가 음성을 텍스트로 바꿉니다. 실시간으로요.

**Diarize it.** 누가 말했는지 자동으로 구분합니다. 선택 사항이라 필요할 때만 켜세요.

**Translate it.** AI가 자막 단위로 번역합니다. 격식체, 구어체, 직역 — 원하는 톤을 고르세요.

**Edit it.** 파형 위에서 자막을 다듬고, 자르고, 붙이세요.

**Export it.** SRT · VTT · ASS · TXT. 화자 라벨 포함. 끝.

---

## ✨ 기능 하이라이트

<table>
<tr>
<td width="50%">

### 🎯 드래그 앤 드롭
파일 던지고, 프리셋 고르면 끝.
복잡한 설정 없이 바로 시작.

### 🔄 번역 프리셋
언어 쌍 + 스타일 + 용어사전을
한 번 세팅하고 계속 재사용.

### 📖 용어사전
"이건 이렇게 번역해" 를 정의.
CSV로 한 번에 밀어넣기 가능.

### 🗣️ 화자 검출
"누가 말했지?" 를 AI가 자동 구분.
인터넷 없이도 작동하는 완전 로컬 처리.

### 📦 일괄 처리
파일 여러 개? 큐에 넣고 자동 처리.
하나씩 기다릴 필요 없음.

</td>
<td width="50%">

### 🎛️ 하드웨어 프로필
Lite · Balanced · Power 중 자동 추천.
내 PC 사양에 딱 맞는 세팅.

### 🧠 모델 관리
앱 안에서 AI 모델 탐색, 다운로드, 교체.
원하는 모델을 골라 쓸 수 있음.

### 🎵 자막 편집기
파형 시각화 + 분할/병합 + 키보드 내비게이션.
전문 편집기 부럽지 않은 수준.

### 🌙 테마 & 언어
다크 / 라이트 자동 전환.
한국어 · English 지원.

### 🔗 외부 API 연동
로컬 AI 외에도 OpenAI, Anthropic 등
외부 번역 API를 선택적으로 사용 가능.

</td>
</tr>
</table>

---

## 지원 형식

### 입력 (영상 · 음성)

| 영상 | 음성 |
|---|---|
| MP4 · MKV · AVI · MOV · WebM | MP3 · WAV · M4A · FLAC |

### 출력 (자막)

| 형식 | 설명 |
|---|---|
| **SRT** | 가장 널리 쓰이는 자막 형식 |
| **VTT** | 웹 플레이어 호환 형식 |
| **ASS** | 스타일 지정이 가능한 고급 형식 |
| **TXT** | 텍스트만 추출 |

> 원문과 번역문을 함께 포함하는 이중 자막(Dual Subtitle) 내보내기도 지원합니다.

---

## 지원 언어

### 음성 인식

자동 감지를 포함해 8개 언어를 지원합니다.

| 언어 | 코드 |
|---|---|
| 자동 감지 | `auto` |
| English | `en` |
| 한국어 | `ko` |
| 日本語 | `ja` |
| 中文 | `zh` |
| Español | `es` |
| Français | `fr` |
| Deutsch | `de` |

### 번역

위 언어 간 양방향 번역을 지원하며, 4가지 스타일을 선택할 수 있습니다.

| 스타일 | 설명 |
|---|---|
| **직역** | 원문에 충실한 번역 |
| **자연스러운** | 자연스러운 문장으로 의역 |
| **구어체** | 일상 대화체 |
| **격식체** | 공식적인 톤 |

---

## 시스템 요구 사항

| | 최소 | 권장 |
|---|---|---|
| **OS** | Windows 10 (64-bit) | Windows 11 |
| **RAM** | 8 GB | 16 GB+ |
| **디스크** | 4 GB 여유 | 10 GB+ |
| **GPU** | 없어도 됨 | NVIDIA 4 GB+ VRAM |

> 💡 GPU가 없어도 CPU만으로 충분히 동작합니다. 다만 있으면 **확실히** 빠릅니다.

> 현재 Windows 전용입니다. macOS · Linux 지원은 향후 확장 예정입니다.

---

## 시작하기

```
다운로드  →  설치  →  마법사 따라가기  →  끝.
```

설치 마법사가 하드웨어를 감지하고, 프로필을 추천하고, 모델까지 받아줍니다.

Python? 커맨드 라인? **필요 없습니다.**

---

## 자주 묻는 질문

<details>
<summary><strong>GPU가 없으면 많이 느린가요?</strong></summary>

CPU만으로도 충분히 동작합니다. 다만 GPU가 있으면 음성 인식과 번역 속도가 눈에 띄게 빨라집니다. 설치 시 하드웨어 프로필(Lite · Balanced · Power)을 자동으로 추천해 주니, 내 PC에 맞는 설정으로 시작하게 됩니다.

</details>

<details>
<summary><strong>인터넷이 정말 필요 없나요?</strong></summary>

네, 모든 AI 처리는 내 PC에서 이루어집니다. 인터넷이 필요한 순간은 딱 두 번뿐입니다: 앱을 처음 다운로드할 때, 그리고 AI 모델을 받을 때. 그 이후로는 완전한 오프라인 사용이 가능합니다.

</details>

<details>
<summary><strong>영상 길이에 제한이 있나요?</strong></summary>

소프트웨어 자체의 길이 제한은 없습니다. 다만 긴 영상일수록 처리 시간과 메모리 사용량이 늘어나므로, PC 사양에 따라 체감 한계가 달라질 수 있습니다.

</details>

<details>
<summary><strong>자막 정확도는 어느 정도인가요?</strong></summary>

OpenAI Whisper 기반의 음성 인식 엔진을 사용하며, 음질이 좋은 영상에서는 상당히 높은 정확도를 보입니다. 결과물은 내장 편집기에서 바로 수정할 수 있으니, 틀린 부분만 다듬어 쓰면 됩니다.

</details>

<details>
<summary><strong>macOS나 Linux에서도 쓸 수 있나요?</strong></summary>

현재는 Windows 전용입니다. 내부적으로는 크로스 플랫폼 대응 코드가 준비되어 있어, 향후 macOS · Linux 지원이 계획되어 있습니다.

</details>

<details>
<summary><strong>내 데이터가 외부로 전송되나요?</strong></summary>

아닙니다. 모든 처리는 `localhost` 내에서 이루어지며, 외부로 나가는 네트워크 트래픽은 없습니다. 단, 외부 번역 API(OpenAI, Anthropic 등)를 선택적으로 사용할 경우에는 해당 API로 자막 텍스트가 전송됩니다.

</details>

---

<details>
<summary><h2>🔧 개발자 정보</h2></summary>

### 내부 구조

LocalSub은 세 개의 레이어로 구성됩니다.

```
┌─────────────────────────────────────────────┐
│  🖥️  React + TypeScript + Tailwind          │  ← UI
├─────────────────────────────────────────────┤
│  ⚙️  Tauri 2 (Rust)                         │  ← 데스크톱 셸, IPC, 파일 I/O
├─────────────────────────────────────────────┤
│  🐍  Python FastAPI (localhost:9111)         │  ← AI 엔진
│      ├ faster-whisper    → 음성 인식         │
│      ├ ONNX Runtime      → 화자 검출         │
│      └ llama-cpp-python  → 번역              │
└─────────────────────────────────────────────┘
```

모든 통신은 localhost. 외부로 나가는 트래픽은 **제로.**

### 개발 환경

```bash
# 준비물: Node.js 18+, Rust 1.70+
npm install

npm run tauri dev      # 개발 서버
npm run tauri build    # 프로덕션 빌드 (.exe)

npm run test           # 테스트
npm run test:watch     # 감시 모드
```

<details>
<summary><strong>📁 프로젝트 구조</strong></summary>

```
src/                        React 프론트엔드
├── components/
│   ├── ui/                 shadcn/ui 컴포넌트
│   ├── editor/             파형 · 자막 목록 · 편집 패널
│   ├── dashboard/          작업 테이블 · 새 작업 다이얼로그
│   ├── presets/            프리셋 · 용어사전 관리
│   ├── settings/           설정 패널 (6개 섹션)
│   └── setup/              설치 마법사
├── hooks/                  useConfig · useRuntime · usePipeline …
├── i18n/locales/           en.json · ko.json
└── types.ts                공유 타입 정의

src-tauri/src/              Rust 백엔드
├── commands*.rs            IPC 명령 핸들러 (15개)
├── model_downloader.rs     HuggingFace 다운로드 (이어받기 + SHA256)
├── hw_detector.rs          CPU · GPU · RAM · CUDA 감지
├── config_manager.rs       설정 CRUD
├── preset_manager.rs       프리셋 관리
├── python_manager.rs       Python 프로세스 생명주기
└── sse_client.rs           Server-Sent Events 스트리밍

python-server/              FastAPI 백엔드
├── stt_engine.py           faster-whisper 래퍼
├── diarization_engine.py   ONNX 화자 검출 엔진
├── llm_engine.py           llama-cpp-python 래퍼
├── prompt_builder.py       컨텍스트 윈도우 · 용어사전 주입
├── subtitle_formatter.py   SRT · VTT · ASS 변환
└── runtime_router.py       모델 로드/언로드 · 리소스 모니터링
```

</details>

</details>

---

<p align="center">
  <sub>Private — All rights reserved.</sub>
</p>
