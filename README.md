<p align="center">
  <h1 align="center">SubText</h1>
  <p align="center">
    <strong>내 영상. 내 언어. 내 컴퓨터.</strong><br/>
    <sub>클라우드 없이, 구독 없이, 타협 없이 — 온전히 로컬에서 돌아가는 AI 자막 도구.</sub>
  </p>
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

## 왜 SubText?

자막 만드느라 영상을 어딘가에 업로드하고, 분당 얼마씩 과금되고, 내 데이터가 어디로 가는지 모르는 경험 — 이제 그만.

| | 기존 서비스 | **SubText** |
|---|---|---|
| 데이터 | ☁️ 클라우드 업로드 | 🔒 내 PC에서 끝 |
| 비용 | 💳 월 구독 / 분당 과금 | 🆓 무료, 영원히 |
| 인터넷 | 📡 필수 | ✈️ 오프라인 OK |
| GPU | ❌ 서버 의존 | ⚡ 내 GPU 직접 활용 |

---

## 워크플로우

```
📂 파일 드롭  →  🎙️ 음성 인식  →  🌐 AI 번역  →  ✏️ 편집  →  💾 내보내기
```

**Drop it.** 영상이든 음성이든 끌어다 놓으세요.

**Transcribe it.** Whisper가 음성을 텍스트로 바꿉니다. 실시간으로요.

**Translate it.** 로컬 LLM이 세그먼트별로 번역합니다. 격식체, 구어체, 직역 — 원하는 톤을 고르세요.

**Edit it.** 파형 위에서 자막을 다듬고, 자르고, 붙이세요.

**Export it.** SRT · VTT · ASS · TXT. 끝.

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
HuggingFace 직결.

### 🎵 자막 편집기
파형 시각화 + 분할/병합 + 키보드 내비게이션.
전문 편집기 부럽지 않은 수준.

### 🌙 테마 & 언어
다크 / 라이트 자동 전환.
한국어 · English 지원.

</td>
</tr>
</table>

---

## 시스템 요구 사항

| | 최소 | 권장 |
|---|---|---|
| **OS** | Windows 10 (64-bit) | Windows 11 |
| **RAM** | 8 GB | 16 GB+ |
| **디스크** | 4 GB 여유 | 10 GB+ |
| **GPU** | 없어도 됨 | NVIDIA 4 GB+ VRAM |

> 💡 GPU가 없어도 CPU만으로 충분히 동작합니다. 다만 있으면 **확실히** 빠릅니다.

---

## 시작하기

```
다운로드  →  설치  →  마법사 따라가기  →  끝.
```

설치 마법사가 하드웨어를 감지하고, 프로필을 추천하고, 모델까지 받아줍니다.

Python? 커맨드 라인? **필요 없습니다.**

---

## 내부 구조

SubText는 세 개의 레이어로 구성됩니다.

```
┌─────────────────────────────────────────────┐
│  🖥️  React + TypeScript + Tailwind          │  ← UI
├─────────────────────────────────────────────┤
│  ⚙️  Tauri 2 (Rust)                         │  ← 데스크톱 셸, IPC, 파일 I/O
├─────────────────────────────────────────────┤
│  🐍  Python FastAPI (localhost:9111)         │  ← AI 엔진
│      ├ faster-whisper  → 음성 인식           │
│      └ llama-cpp-python → 번역              │
└─────────────────────────────────────────────┘
```

모든 통신은 localhost. 외부로 나가는 트래픽은 **제로.**

---

## 개발

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
├── commands*.rs            IPC 명령 핸들러 (13개)
├── model_downloader.rs     HuggingFace 다운로드 (이어받기 + SHA256)
├── hw_detector.rs          CPU · GPU · RAM · CUDA 감지
├── config_manager.rs       설정 CRUD
├── preset_manager.rs       프리셋 관리
├── python_manager.rs       Python 프로세스 생명주기
└── sse_client.rs           Server-Sent Events 스트리밍

python-server/              FastAPI 백엔드
├── stt_engine.py           faster-whisper 래퍼
├── llm_engine.py           llama-cpp-python 래퍼
├── prompt_builder.py       컨텍스트 윈도우 · 용어사전 주입
├── subtitle_formatter.py   SRT · VTT · ASS 변환
└── runtime_router.py       모델 로드/언로드 · 리소스 모니터링
```

</details>

---

<p align="center">
  <sub>Private — All rights reserved.</sub>
</p>
