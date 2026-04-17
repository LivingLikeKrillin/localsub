# Preset Field Routing + Prompt Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user-visible preset settings (source/target language, style, quality, custom prompt, two-pass, LLM model) actually drive translation, and restructure the system prompt so custom instructions have a clear, high-priority slot.

**Architecture:** The bug is localized: `src-tauri/src/commands_translate.rs::start_translate` reads `config.*` for fields the preset owns. Fix is a `preset.field.or(config.field)` resolution layer before building the HTTP payload. Prompt redesign touches `python-server/prompt_builder.py::build_system_prompt` only; no schema changes needed there. No Rust/TS type changes required — all preset fields already exist.

**Tech Stack:** Rust (Tauri command), Python FastAPI (pydantic models, prompt construction), pytest for Python unit tests, cargo check for Rust validation, manual end-to-end verification in Tauri dev mode.

---

## File Structure

### Modify
- `python-server/prompt_builder.py` — restructure `build_system_prompt` for section-based layout with custom prompt slot at prescribed position
- `python-server/test_prompt_builder.py` — add tests for new prompt structure
- `src-tauri/src/commands_translate.rs:14-230` — add preset-field resolution helpers, replace `config.*` reads with resolved values

### No-op (for awareness)
- `src/types.ts`, `src/components/presets/PresetsPage.tsx` — all preset fields already in types and UI, no change required
- `python-server/translate_router.py` — existing `TranslateStartRequest` already accepts `source_lang`, `target_lang`, `style_preset`, `translation_quality`, `custom_prompt`, `two_pass`, `model_id`; just need to populate them from resolved preset values in Rust

---

## Self-contained scope notes

### Out of scope for this plan
- Vocabulary post-processing (separate plan)
- Legacy `config.active_glossary` removal (separate plan — must verify nothing else depends on it after this lands)
- Strict flag / fallback map extension
- Dynamic few-shot injection (separate plan — already validated by `test_fewshot_30_q5km.py`)

### Precedence rule (implemented by this plan)
`preset.X` wins when present and non-empty. `config.X` only fills in where preset has no value. For `custom_prompt`: preset wins when non-empty; otherwise config. No concatenation — research with 9B models shows concatenating multiple instruction blocks hurts rather than helps.

### Source-of-truth for "non-empty"
- Strings: `!s.is_empty()` and `!s.trim().is_empty()`
- `Option<T>`: `Some(v)` where v passes string check if applicable
- `whisper_model` / `llm_model` on Preset are `String` (not Option); treat empty string as "not set"

---

## Task 1: Restructure `build_system_prompt` (Python)

**Files:**
- Modify: `python-server/prompt_builder.py:24-49`
- Test: `python-server/test_prompt_builder.py` (append new tests)

- [ ] **Step 1.1: Write failing tests for new prompt structure**

Append to `python-server/test_prompt_builder.py`:

```python
# ── New structure: custom prompt placement and output-rule recency ──

def test_build_system_prompt_has_output_rule_last_when_no_custom():
    prompt = build_system_prompt("natural", "ja", "ko")
    lines = [line for line in prompt.splitlines() if line.strip()]
    # Last meaningful line is /no_think, the one before is the output rule
    assert lines[-1].startswith("/no_think")
    assert "output" in lines[-2].lower()


def test_build_system_prompt_custom_placed_before_output_rule():
    prompt = build_system_prompt(
        "natural", "ja", "ko",
        custom_prompt="Use Busan dialect.",
    )
    # Custom appears, and it appears before the output rule and /no_think
    idx_custom = prompt.find("Use Busan dialect.")
    idx_output = prompt.lower().find("output only")
    idx_no_think = prompt.find("/no_think")
    assert idx_custom != -1
    assert idx_custom < idx_output < idx_no_think


def test_build_system_prompt_custom_has_section_marker():
    prompt = build_system_prompt(
        "natural", "ja", "ko",
        custom_prompt="Keep character names unchanged.",
    )
    # Section marker introduces the custom block so the model can distinguish it
    assert "Additional instructions:" in prompt


def test_build_system_prompt_empty_custom_omits_section():
    prompt = build_system_prompt("natural", "ja", "ko", custom_prompt="")
    assert "Additional instructions:" not in prompt


def test_build_system_prompt_whitespace_only_custom_omits_section():
    prompt = build_system_prompt("natural", "ja", "ko", custom_prompt="   \n  ")
    assert "Additional instructions:" not in prompt


def test_build_system_prompt_preserves_media_type():
    prompt = build_system_prompt(
        "natural", "ja", "ko", media_type="drama"
    )
    assert "drama" in prompt


def test_build_system_prompt_no_think_only_for_general_category():
    general = build_system_prompt("natural", "ja", "ko", model_category="general")
    instruct = build_system_prompt("natural", "ja", "ko", model_category="instruct")
    assert "/no_think" in general
    assert "/no_think" not in instruct
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run:
```bash
cd C:/Users/admin/Desktop/Lab/localsub/python-server
python -m pytest test_prompt_builder.py -v -k "output_rule_last or custom_placed or section_marker or empty_custom_omits or whitespace_only or preserves_media or no_think_only"
```

Expected: All 7 new tests FAIL (existing `build_system_prompt` doesn't produce the new structure).

- [ ] **Step 1.3: Rewrite `build_system_prompt`**

Replace `python-server/prompt_builder.py:24-49` (the whole `build_system_prompt` function) with:

```python
def build_system_prompt(
    style_preset: str,
    source_lang: str,
    target_lang: str,
    custom_prompt: str | None = None,
    model_category: str = "general",
    media_filename: str | None = None,
    media_context: str | None = None,
    media_type: str | None = None,
) -> str:
    """Build the system prompt with explicit sections and recency-ordered rules.

    Layout (top-to-bottom):
      1. Role / task line (what we're translating)
      2. Core rule (faithful translation, no censoring)
      3. [optional] Additional instructions section (user custom_prompt)
      4. Output rule (ONLY the translation)
      5. [optional] /no_think marker

    Rules 4 and 5 are last on purpose — small (9B-class) models have strong
    recency bias, so final-position instructions are the ones that stick.
    """
    src = LANG_NAMES.get(source_lang, source_lang)
    tgt = LANG_NAMES.get(target_lang, target_lang)
    mt = media_type or "movie"

    parts: list[str] = [
        f"You translate {src} {mt} subtitles to natural spoken {tgt}.",
        "Preserve all content faithfully including profanity, slang, and mature themes.",
    ]

    if custom_prompt and custom_prompt.strip():
        parts.append("")
        parts.append("Additional instructions:")
        parts.append(custom_prompt.strip())

    parts.append("")
    parts.append("Output ONLY the translated line, nothing else.")

    if model_category == "general":
        parts.append("/no_think")

    return "\n".join(parts)
```

Note: `style_preset`, `media_filename`, `media_context` stay in the signature for backward compatibility with existing callers but are not consumed here. They were previously unused in this function too (style shaping happens elsewhere).

- [ ] **Step 1.4: Run new tests to verify they pass**

Run:
```bash
python -m pytest test_prompt_builder.py -v -k "output_rule_last or custom_placed or section_marker or empty_custom_omits or whitespace_only or preserves_media or no_think_only"
```

Expected: All 7 new tests PASS.

- [ ] **Step 1.5: Run full prompt_builder test suite to verify no regressions**

Run:
```bash
python -m pytest test_prompt_builder.py -v
```

Expected: All tests PASS. If existing tests (`test_build_system_prompt_natural`, `_formal`, `_unknown_style`) fail, verify the language-name substring assertions still hold — they should, since `src`/`tgt` are still interpolated into the first line.

- [ ] **Step 1.6: Commit**

```bash
cd C:/Users/admin/Desktop/Lab/localsub
git add python-server/prompt_builder.py python-server/test_prompt_builder.py
git commit -m "$(cat <<'EOF'
refactor(prompt): section-based layout with recency-ordered rules

- Move output rule and /no_think to the end (recency bias on 9B models)
- Introduce explicit "Additional instructions:" section for custom_prompt
- Empty/whitespace custom omits the section entirely
- Add 7 tests covering new structure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add preset-field resolution to Rust translate command

**Files:**
- Modify: `src-tauri/src/commands_translate.rs`

- [ ] **Step 2.1: Add a helper module for preset/config resolution**

At the top of `src-tauri/src/commands_translate.rs`, immediately after the existing `use` block, insert:

```rust
// ── Preset/config field resolution ──
// When a preset is active, its field wins if non-empty.
// Otherwise fall back to the equivalent config field.

fn resolve_str<'a>(preset_val: Option<&'a str>, config_val: &'a str) -> &'a str {
    match preset_val {
        Some(s) if !s.trim().is_empty() => s,
        _ => config_val,
    }
}

fn resolve_opt_str(preset_val: Option<&str>, config_val: Option<&str>) -> Option<String> {
    match preset_val {
        Some(s) if !s.trim().is_empty() => Some(s.to_string()),
        _ => config_val.filter(|s| !s.trim().is_empty()).map(str::to_string),
    }
}

fn resolve_bool(preset_val: Option<bool>, config_val: Option<bool>) -> Option<bool> {
    preset_val.or(config_val)
}
```

- [ ] **Step 2.2: Replace `source_lang` / `target_lang` / `style_preset` reads in the request body**

Find the `body` construction in `commands_translate.rs` (currently around line 175, the `serde_json::json!({...})` block that sets `"source_lang": config.source_language` etc.).

Before that block, insert the resolved values:

```rust
    // Resolve per-field: preset wins when set, config fills in otherwise.
    let p_source_lang = preset.as_ref().map(|p| p.source_lang.as_str());
    let p_target_lang = preset.as_ref().map(|p| p.target_lang.as_str());
    let p_style = preset.as_ref().map(|p| p.translation_style.as_str());

    let resolved_source_lang = resolve_str(p_source_lang, &config.source_language).to_string();
    let resolved_target_lang = resolve_str(p_target_lang, &config.target_language).to_string();
    let resolved_style = resolve_str(p_style, &config.style_preset).to_string();
```

Then replace the three lines inside the `serde_json::json!({...})` body:

Before:
```rust
        "source_lang": config.source_language,
        "target_lang": config.target_language,
        "context_window": config.context_window,
        "style_preset": config.style_preset,
```

After:
```rust
        "source_lang": resolved_source_lang,
        "target_lang": resolved_target_lang,
        "context_window": config.context_window,
        "style_preset": resolved_style,
```

- [ ] **Step 2.3: Replace `translation_quality` / `custom_prompt` / `two_pass` reads**

Below the body initializer (these fields are added conditionally further down — around line 200-210), replace:

Before:
```rust
    // Translation quality settings
    body["translation_quality"] = serde_json::json!(
        config.translation_quality.as_deref().unwrap_or("balanced")
    );
    if let Some(ref prompt) = config.custom_translation_prompt {
        body["custom_prompt"] = serde_json::json!(prompt);
    }
    let two_pass = config.two_pass_translation
        .unwrap_or_else(|| config.translation_quality.as_deref() == Some("best"));
    body["two_pass"] = serde_json::json!(two_pass);
```

After:
```rust
    // Translation quality / custom prompt / two-pass — preset wins when set.
    let resolved_quality = resolve_opt_str(
        preset.as_ref().and_then(|p| p.translation_quality.as_deref()),
        config.translation_quality.as_deref(),
    )
    .unwrap_or_else(|| "balanced".to_string());
    body["translation_quality"] = serde_json::json!(resolved_quality);

    let resolved_custom_prompt = resolve_opt_str(
        preset.as_ref().and_then(|p| p.custom_translation_prompt.as_deref()),
        config.custom_translation_prompt.as_deref(),
    );
    if let Some(ref prompt) = resolved_custom_prompt {
        body["custom_prompt"] = serde_json::json!(prompt);
    }

    let resolved_two_pass = resolve_bool(
        preset.as_ref().and_then(|p| p.two_pass_translation),
        config.two_pass_translation,
    )
    .unwrap_or_else(|| resolved_quality == "best");
    body["two_pass"] = serde_json::json!(resolved_two_pass);
```

- [ ] **Step 2.4: Prefer `preset.llm_model` over `config.active_llm_model`**

Find the existing `llm_model_id` resolution block (currently around line 85-100, the one that reads `config.active_llm_model`).

Before:
```rust
    let manifest = manifest_manager::load_manifest(&config)?;
    let llm_model_id = config
        .active_llm_model
        .as_deref()
        .and_then(|id| {
            manifest
                .models
                .iter()
                .find(|m| m.id == id && m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        })
        .or_else(|| {
            manifest
                .models
                .iter()
                .find(|m| m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        });
```

After:
```rust
    let manifest = manifest_manager::load_manifest(&config)?;

    // Preset.llm_model wins when set and ready; else config.active_llm_model; else first ready.
    let preset_llm = preset
        .as_ref()
        .map(|p| p.llm_model.as_str())
        .filter(|s| !s.is_empty());

    let llm_model_id = preset_llm
        .and_then(|id| {
            manifest
                .models
                .iter()
                .find(|m| m.id == id && m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        })
        .or_else(|| {
            config.active_llm_model.as_deref().and_then(|id| {
                manifest
                    .models
                    .iter()
                    .find(|m| m.id == id && m.model_type == "llm" && m.status == "ready")
                    .map(|m| m.id.clone())
            })
        })
        .or_else(|| {
            manifest
                .models
                .iter()
                .find(|m| m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        });
```

- [ ] **Step 2.5: Log which source each resolved value came from**

After the `resolved_custom_prompt` block (inside the quality section from Step 2.3), insert:

```rust
    log::info!(
        "Translation config resolved — lang={}→{}, style={}, quality={}, two_pass={}, custom_prompt={}, llm={} (preset={})",
        resolved_source_lang,
        resolved_target_lang,
        resolved_style,
        resolved_quality,
        resolved_two_pass,
        if resolved_custom_prompt.is_some() { "set" } else { "none" },
        llm_model_id.as_deref().unwrap_or("<none>"),
        preset.as_ref().map(|p| p.name.as_str()).unwrap_or("<none>"),
    );
```

- [ ] **Step 2.6: Run `cargo check` to verify it compiles**

Run:
```bash
cd C:/Users/admin/Desktop/Lab/localsub/src-tauri
cargo check --message-format=short 2>&1 | tail -20
```

Expected: `Finished` with no errors. Pre-existing `unused variable: msg` warning around line 227 is fine — not introduced by this plan.

- [ ] **Step 2.7: Commit**

```bash
cd C:/Users/admin/Desktop/Lab/localsub
git add src-tauri/src/commands_translate.rs
git commit -m "$(cat <<'EOF'
fix: route preset fields to translation pipeline

Previously only preset.media_type and preset.vocabulary_id flowed
to Python; every other preset field (source_lang, target_lang,
translation_style, translation_quality, custom_translation_prompt,
two_pass_translation, llm_model) was silently ignored while
config.* was used. Switching preset in the UI therefore had no
effect on translation behaviour.

Resolve each field via "preset wins when set, config fills in":
- resolve_str / resolve_opt_str / resolve_bool helpers
- llm_model_id tries preset -> config.active_llm_model -> first ready
- Log the resolved values so pipeline issues are debuggable

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Manual end-to-end verification

This task has no automated tests — Rust integration tests for Tauri commands require heavy state mocking that exceeds this plan's scope. Instead, verify by running the app and checking logs.

**Files:** (none modified; verification only)

- [ ] **Step 3.1: Launch the app**

Run:
```bash
cd C:/Users/admin/Desktop/Lab/localsub
npm run tauri dev
```

Wait for the window to open and the Python server health check to pass (watch for `INFO: Uvicorn running on http://127.0.0.1:9111` in the log).

- [ ] **Step 3.2: Create a test preset with distinguishing values**

In the app UI:
1. Navigate to Presets page
2. Click "New preset"
3. Fill in with values that differ from your current config:
   - Name: "Test Routing"
   - source_lang: pick something different from your default
   - target_lang: pick something different from your default
   - translation_style: pick the opposite of config (e.g. formal if config is casual)
   - translation_quality: "best"
   - custom_translation_prompt: "TEST_MARKER_123: Translate in bro-speak."
   - two_pass: toggle opposite of default
4. Save.

- [ ] **Step 3.3: Run a short translation using the preset and check the log**

1. Go to Dashboard, create a New Job, drop a short video/audio file.
2. Select the "Test Routing" preset.
3. Hit start, wait for STT to finish and translation to start.
4. Open the log file: `%APPDATA%\LocalSub\logs\tauri.log`
5. Search for the line starting with `Translation config resolved —`.

Expected: The line reports the preset's values (not config's). Specifically:
- `lang=<preset.source_lang>→<preset.target_lang>`
- `style=<preset.translation_style>`
- `quality=best`
- `two_pass=<preset.two_pass_translation>`
- `custom_prompt=set`
- `preset=Test Routing`

- [ ] **Step 3.4: Confirm the custom prompt reached the LLM system prompt**

Also in `%APPDATA%\LocalSub\logs\tauri.log` (or the Python server stderr captured into it), search for `TEST_MARKER_123`.

Expected: The marker appears in the system prompt the Python server builds, inside an `Additional instructions:` block positioned before `Output ONLY the translated line`.

If it doesn't appear, grep the Python server log and/or temporarily add a `log.debug` in `prompt_builder.build_system_prompt` to dump the final string.

- [ ] **Step 3.5: Delete the test preset**

Remove the "Test Routing" preset via the UI — it was verification scaffolding.

- [ ] **Step 3.6: Commit nothing**

This task only produces verification artefacts (logs), no code to commit.

---

## Task 4: Update translation-pipeline-issues backlog

**Files:**
- Modify: `docs/translation-pipeline-issues.md`

- [ ] **Step 4.1: Move items A1–A7 and D1–D5 to "G. 최근 해결된 항목"**

Open `docs/translation-pipeline-issues.md` and edit:

1. In section A, change the "현재 동작" column for rows A1 through A7 from "전역 config 사용" to "✅ preset 우선, config fallback" and move them to section G with a note `(this-plan-commit-hash)`.
2. In section D, change D1–D3 and D5 to ✅ and add a note `(this-plan-commit-hash)`. D4 (precedence) is also resolved — preset-wins-when-nonempty.
3. A8 (`whisper_model`) remains ❌ — this plan did not touch STT routing. Leave it open.

After editing, commit:

```bash
cd C:/Users/admin/Desktop/Lab/localsub
git add docs/translation-pipeline-issues.md
git commit -m "docs: mark preset routing + prompt redesign items as resolved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

- [ ] **Step 4.2: Replace the placeholder `(this-plan-commit-hash)` with the real hash**

Find the two previous commits from Tasks 1 and 2:

```bash
git log --oneline -5
```

Amend `docs/translation-pipeline-issues.md` to substitute the placeholder with the short hashes (e.g. `a1b2c3d` for prompt refactor, `e4f5g6h` for Rust routing).

```bash
git add docs/translation-pipeline-issues.md
git commit --amend --no-edit
```

---

## Self-Review (done before publishing this plan)

**Spec coverage:**
- A1 source_lang ✓ Task 2.2
- A2 target_lang ✓ Task 2.2
- A3 translation_style ✓ Task 2.2
- A4 translation_quality ✓ Task 2.3
- A5 custom_translation_prompt ✓ Task 2.3
- A6 two_pass_translation ✓ Task 2.3
- A7 llm_model ✓ Task 2.4
- A8 whisper_model — intentionally deferred (different code path, separate plan)
- D1 custom placement ✓ Task 1.3 (placed before output rule)
- D2 output rule last ✓ Task 1.3
- D3 section markers ✓ Task 1.3 (`Additional instructions:`)
- D4 precedence ✓ Task 2 (preset wins when non-empty)
- D5 `/no_think` placement ✓ Task 1.3 (absolute last)

**Placeholder scan:** No TBDs, no "handle edge cases", no "similar to X"; every code step has full code.

**Type consistency:** `resolve_str` / `resolve_opt_str` / `resolve_bool` used with matching types. `Preset.translation_style` is `String` (from state.rs), matched by `resolve_str`. `Preset.translation_quality` is `Option<String>`, matched by `resolve_opt_str`. `Preset.two_pass_translation` is `Option<bool>`, matched by `resolve_bool`.

---

## Not in this plan (next plans)

- F6, F7 UI polish (tiny CSS, suggest separate 5-min plan)
- Vocabulary-based post-processing (Groups 4, 5)
- Dynamic few-shot (Group 6)
- Legacy `config.active_glossary` removal (Group 7) — blocked on this plan landing
- A8 `whisper_model` preset routing — touches STT command, separate plan
