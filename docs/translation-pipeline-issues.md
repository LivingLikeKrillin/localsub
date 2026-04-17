# Translation Pipeline — Known Issues & Refactor Backlog

번역 파이프라인(프리셋 → Rust 백엔드 → Python LLM → 후처리)에서 발견된 문제들을
카테고리별로 정리한 백로그 문서. 우선순위는 "사용자 체감 큰 버그 → 품질 이슈 → 확장 → 기술 부채" 순.

---

## A. 프리셋 ↔ 번역 파이프라인 연결 누락

사용자가 프리셋 UI에서 편집하는 필드 대부분이 실제 번역에 반영되지 않음.
`commands_translate.rs`는 대부분 `config.*`(전역 설정)을 읽고 있고 `preset.*`을 무시함.

| # | Preset 필드 | 현재 동작 | 기대 동작 |
|---|---|---|---|
| A1 | `source_lang` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A2 | `target_lang` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A3 | `translation_style` (style_preset) | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A4 | `translation_quality` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A5 | `custom_translation_prompt` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A6 | `two_pass_translation` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A7 | `llm_model` | ✅ preset 우선, config fallback (`2105ec1`) | preset 우선 |
| A8 | `whisper_model` | (확인 필요) | preset 우선 |
| A9 | `media_type` | ✅ preset 사용 | 정상 |
| A10 | `vocabulary_id` | ✅ preset 사용 (`d693acd` 에서 수정) | 정상 |

> 프리셋 필드 10개 중 실제 반영 2개. 프리셋 기능이 사실상 허상.

**해결 방향**: `commands_translate.rs` 에서 `preset.X ?? config.X` 패턴으로 값 해결.

---

## B. Vocabulary / 용어 사전

| # | 항목 | 상태 |
|---|---|---|
| B1 | Vocabulary → LLM 입력 chat turn 주입 | ✅ 작동 (`d693acd`) |
| B2 | Vocabulary → 후처리 fallback 치환 | ❌ 미구현 (하드코딩 맵만) |
| B3 | Vocabulary entry `strict` 플래그 | ❌ 없음 (엄격 치환 불가) |
| B4 | Vocabulary `context`, `note` 필드 | ❌ 저장만 되고 LLM에 전달 안 됨 |
| B5 | **Dynamic few-shot: 직전 3개 번역 chat turn 주입** — `test_fewshot_30_q5km.py`에서 D 방식으로 검증, 스타일 일관성 향상 확인됨. prompt_builder + llm_engine 루프에 recent buffer 관리 추가 필요. 기본 window=3, 프리셋 옵션으로 노출 (0=비활성) | ❌ 미구현 (검증됨) |

---

## C. 후처리 / `_fix_untranslated`

| # | 항목 | 상태 |
|---|---|---|
| C1 | `_JA_FALLBACK_MAP` 하드코딩 (22개) | ❌ 사용자 관리 불가 |
| C2 | 일본어→한국어 전용 (다른 언어쌍 없음) | ❌ |
| C3 | 완전 일치에만 fallback 작동 (부분/변형형 불가) | ❌ |
| C4 | Vocabulary 기반 후처리 치환 없음 (B2 중복) | ❌ |
| C5 | 용어 일관성 검증 없음 (LLM이 사전 무시해도 감지 못함) | ❌ |

**해결 방향**: `_JA_FALLBACK_MAP` 삭제 → 기본 Vocabulary (`Japanese Common Expressions`)로 이전 →
후처리에서 현재 Vocabulary 조회해 치환.

---

## D. 시스템 프롬프트 설계

| # | 항목 | 상태 |
|---|---|---|
| D1 | 커스텀 프롬프트 위치가 기본 규칙과 혼재 | ✅ 해결 (`488e1a0`) |
| D2 | 출력 규칙이 맨 끝이 아님 (recency 이점 미활용) | ✅ 해결 (`488e1a0`) |
| D3 | 섹션 구분자(`Additional:` 등) 없음 | ✅ 해결 (`488e1a0`) |
| D4 | 프리셋/전역 커스텀 프롬프트 우선순위 미정의 | ✅ 해결 (`488e1a0`) |
| D5 | `/no_think` 토큰 배치 검토 필요 | ✅ 해결 (`488e1a0`) |

**해결 방향 (9B 소형 모델 기준)**:
- 핵심 규칙은 끝에 (recency)
- 섹션 분리 (`Additional instructions:` 마커)
- 프리셋 custom이 있으면 최우선, 없으면 config fallback

```
You translate {src} {mt} subtitles to natural spoken {tgt}.
Preserve all content faithfully including profanity and mature themes.

Additional instructions:
{custom_prompt}

Output ONLY the translated line, nothing else.
/no_think
```

---

## E. 데이터 일관성 / 아키텍처

| # | 항목 | 상태 |
|---|---|---|
| E1 | 레거시 `config.active_glossary` 시스템 병존 | ⚠️ UI 없음, 수동 수정만 가능 |
| E2 | `build_refine_messages`가 glossary 파라미터 받지만 사용 안 함 | 🐛 누락 |
| E3 | `build_batch_messages`는 glossary를 **텍스트로** 주입 (chat turn 아님) | ⚠️ 다른 메커니즘, 현재 비활성 |
| E4 | Vocabulary 언어 메타(`source_lang/target_lang`)가 필터링에 미활용 | ⚠️ 언어쌍 맞지 않는 vocab도 선택 가능 |

---

## F. UI / UX

| # | 항목 | 상태 |
|---|---|---|
| F1 | 프리셋 편집 다이얼로그 `initial` state 리셋 안 됨 | ✅ 수정 |
| F2 | Save 버튼 비활성화 (F1 연결) | ✅ 수정 |
| F3 | `_JA_FALLBACK_MAP` 내용이 UI에 노출 안 됨 | ❌ |
| F4 | Vocabulary entry `strict` 속성 편집 UI (B3 연결) | ❌ (필요시) |
| F5 | 기본 Vocabulary 미제공 — 신규 설치 시 빈 상태 | ⚠️ |
| F6 | 미리보기 결과 테이블이 **5~6줄만 표시** (ScrollArea `max-h-48` 하드캡) — 내부적으로는 전체 처리되지만 표시 잘림 | ❌ |
| F7 | 설정 > 모델에서 설치 상태 구분이 **뱃지 1개로만** 표시됨 — 카드 배경/테두리 색상으로 설치된 모델을 한눈에 구분되게 | ❌ |

---

## G. 최근 해결된 항목

| # | 항목 | 커밋 |
|---|---|---|
| G1 | FewShotSet / Vocabulary 이중 시스템 통합 | `d693acd` |
| G2 | `preset.vocabulary_id` 번역 파이프라인 연결 | `d693acd` |
| G3 | 프리셋 편집 다이얼로그 state 리셋 | (다음 커밋) |
| G4 | 프롬프트 구조 재설계 (D1–D5): 섹션 기반 배치, recency 우선, `Additional instructions:` 구분자 | `488e1a0` |
| G5 | 프리셋 필드 번역 파이프라인 반영 (A1–A7): source/target_lang, style, quality, custom_prompt, two_pass, llm_model | `2105ec1` |
| G6 | 시스템 프롬프트 `/no_think`을 맨 끝에 배치 (D5 연결) | `488e1a0` |

---

## 우선순위 그룹

### 🔴 사용자 체감 큰 버그
- **A8**: 프리셋 필드 반영 — `whisper_model` 라우팅 (A1~A7은 `2105ec1`에서 해결)

### 🟡 품질 영향 (은근한 문제)
- **B2, C1~C5**: 후처리 치환 (용어 일관성)
- (D1~D5는 `488e1a0`에서 해결됨)

### 🟢 기능 확장
- **B3, F3, F4**: strict 플래그 + UI
- **B5**: Dynamic few-shot (직전 N개 주입) — 테스트로 효과 검증됨
- **E4**: Vocabulary 언어쌍 필터링
- **F5**: 기본 Vocabulary 번들

### ⚪ 청소 / 기술 부채
- **E1**: 레거시 `active_glossary` 시스템 제거
- **E2**: `build_refine_messages` unused 파라미터 정리
- **E3**: batch 모드 glossary 주입 방식 통일 (chat turn으로)
- **B4**: `context/note` 필드 — 사용하든 제거하든 결정

---

## 다음 작업 시 결정할 것

1. **한 번에 어디까지 묶어서 할 것인가**
   - 최소: A (프리셋 반영)
   - 중간: A + D (프롬프트 재설계)
   - 풀: A + B + C + D (후처리까지)

2. **레거시 `config.active_glossary` 제거 여부**
   - 완전 제거 → 마이그레이션 고민
   - 유지 → 복잡도 증가

3. **strict 플래그 필요성**
   - 실제로 용어가 깨지는 빈도가 높은지 정량 확인 후 결정
   - 불필요하면 B3, F4 스킵

4. **기본 Vocabulary 번들 방식**
   - 설치 시 1회 복사 (사용자가 삭제 가능)
   - 리소스에 내장 + 항상 로드 (사용자 편집 시 override 레이어)
