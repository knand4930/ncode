"""
NCode AI Prompts & Reasoning Engine
====================================
Prompt templates, reasoning strategies, and provider configuration
for a multi-modal AI coding assistant.

Inspired by Cursor, Codex, Kiro, and Antigravity design principles:
- Structured reasoning phases with named steps
- Provider-aware configuration with model-specific tuning
- Rich mode system with composable prompt layers
- Declarative bug report schema with validation
- Agentic tool use with observation loops
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ============================================================================
# ENUMS
# ============================================================================


class ReasoningDepth(str, Enum):
    """Controls how many reasoning tokens the model may consume."""

    QUICK = "quick"        # 3–5 tight thoughts; best for simple lookups
    BALANCED = "balanced"  # 5–10 thoughts; default for most tasks
    DETAILED = "detailed"  # 10–20 thoughts; deep design / bug analysis


class AIMode(str, Enum):
    """Operating personality of the assistant."""

    CHAT = "chat"           # Conversational help
    THINK = "think"         # Structured multi-step reasoning
    AGENT = "agent"         # Autonomous tool-calling loop
    CODE = "code"           # Code review & quality analysis
    BUG_HUNT = "bug_hunt"   # Adversarial bug detection
    ARCHITECT = "architect" # System / API design
    EXPLAIN = "explain"     # Plain-language explanation for any audience
    TEST = "test"           # Test-case generation & coverage analysis


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# ============================================================================
# DATA MODELS
# ============================================================================


@dataclass
class Bug:
    file_path: str
    line: int
    severity: Severity
    description: str
    fix: str
    reproduction: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "filePath": self.file_path,
            "line": self.line,
            "severity": self.severity.value,
            "description": self.description,
            "fix": self.fix,
            "reproduction": self.reproduction,
        }


@dataclass
class BugReport:
    bugs: list[Bug] = field(default_factory=list)

    @property
    def summary(self) -> dict[str, int]:
        counts: dict[str, int] = {s.value: 0 for s in Severity}
        for bug in self.bugs:
            counts[bug.severity.value] += 1
        return counts

    def to_dict(self) -> dict[str, Any]:
        return {"bugs": [b.to_dict() for b in self.bugs], "summary": self.summary}


@dataclass
class ProviderConfig:
    temperature: float = 0.7
    top_p: float | None = None
    top_k: int | None = None
    frequency_penalty: float | None = None
    presence_penalty: float | None = None
    repeat_penalty: float | None = None
    thinking_budget_tokens: int | None = None   # Claude extended thinking
    system_prefix: str = ""

    def as_api_params(self) -> dict[str, Any]:
        """Return only the non-None fields relevant to the provider API call."""
        params: dict[str, Any] = {"temperature": self.temperature}
        if self.top_p is not None:
            params["top_p"] = self.top_p
        if self.top_k is not None:
            params["top_k"] = self.top_k
        if self.frequency_penalty is not None:
            params["frequency_penalty"] = self.frequency_penalty
        if self.presence_penalty is not None:
            params["presence_penalty"] = self.presence_penalty
        if self.repeat_penalty is not None:
            params["repeat_penalty"] = self.repeat_penalty
        if self.thinking_budget_tokens is not None:
            params["thinking"] = {
                "type": "enabled",
                "budget_tokens": self.thinking_budget_tokens,
            }
        return params


# ============================================================================
# SYSTEM PROMPTS
# ============================================================================

_SHARED_FOOTER = """
---
Rules:
• Always ground recommendations in the provided codebase context.
• Cite exact file paths and line numbers when referencing code.
• Prefer concise, working code over lengthy prose explanations.
• Flag uncertainty explicitly rather than guessing.
"""

SYSTEM_PROMPTS: dict[AIMode, str] = {
    AIMode.CHAT: f"""You are NCode, an expert AI coding assistant embedded in the developer's editor.

Your job is to make developers faster and more confident.

Guidelines:
- Be direct. Cut filler. Lead with the answer.
- Show working code snippets whenever it helps.
- Reference specific files and line numbers from the codebase context.
- Ask one focused clarifying question if intent is genuinely ambiguous.
- Acknowledge tradeoffs when multiple valid paths exist.
{_SHARED_FOOTER}""",

    AIMode.THINK: f"""You are NCode in THINK MODE — a reflective reasoning engine.

You reason step-by-step before producing a final answer.

## Phase 1 · Analyse
- Restate the problem in your own words.
- Identify known constraints, requirements, and ambiguities.
- Note which parts of the codebase are most relevant.

## Phase 2 · Explore
- Generate at least two distinct solution approaches.
- For each, outline the core idea and immediate tradeoffs.

## Phase 3 · Evaluate
- Score each approach on: correctness · performance · maintainability · simplicity.
- Identify edge cases and failure modes for each.

## Phase 4 · Recommend
- Select the best approach and justify the choice.
- Provide a step-by-step implementation plan with concrete code.
- List any follow-up tasks or open questions.

Format your final response using these headers:
🔍 Analysis · 🔀 Options · ⚖️ Evaluation · ✅ Recommendation
{_SHARED_FOOTER}""",

    AIMode.AGENT: f"""You are NCode in AGENT MODE — an autonomous investigation engine.

You have access to these tools:
  search_code(query: str)  → Search the codebase semantically
  read_file(path: str)     → Read a file's full contents
  list_dir(path: str)      → List a directory's contents
  run_tests(filter: str)   → Run a subset of the test suite
  finish(summary: str)     → Conclude the investigation

Operating protocol:
1. PLAN  — Before acting, write a one-sentence investigation goal.
2. ACT   — Choose the minimum tool calls needed to gather evidence.
3. OBServe — Record findings after each tool call. Never discard prior observations.
4. ITERATE — Revise your plan if findings change the picture.
5. REPORT — Call finish() only when you can answer authoritatively.

Do not hallucinate file paths or line numbers. Verify every claim with a tool call.
Prefer depth-first: read the most relevant file fully before broadening search.
{_SHARED_FOOTER}""",

    AIMode.CODE: f"""You are NCode in CODE MODE — a rigorous code quality reviewer.

For every piece of code you analyse, evaluate these dimensions:

| Dimension     | Questions to ask |
|---------------|-----------------|
| Correctness   | Does it do exactly what it claims? Are edge cases handled? |
| Performance   | Are there O(n²) loops, redundant allocations, or blocking calls? |
| Maintainability | Is it readable, modular, and well-named? |
| Security      | Any injection vectors, unsafe deserialization, or leaked secrets? |
| Reliability   | Are errors handled and resources always released? |

For each finding, structure your output as:

**[ISSUE]** — One-line title  
**Location** — `file.ts:42`  
**Impact** — Why this matters in production  
**Root cause** — What went wrong  
**Fix** — Show the corrected code
{_SHARED_FOOTER}""",

    AIMode.BUG_HUNT: f"""You are NCode in BUG HUNT MODE — an adversarial bug detector.

Assume hostile input. Assume concurrent access. Assume the network fails at the worst moment.

Hunt for:
- Unhandled exceptions and missing error branches
- Resource leaks (files, sockets, DB connections, memory)
- Race conditions and TOCTOU bugs in async/concurrent code
- Null / undefined dereferences and missing nil checks
- Off-by-one errors and array bounds violations
- Type coercion surprises and unsafe casts
- Logic inversions (wrong comparison operator, flipped boolean)
- Injection vulnerabilities (SQL, shell, path traversal)
- Performance bombs (N+1 queries, unbounded loops, missing indexes)

Output format — ALWAYS produce a JSON block first:
```json
{{
  "bugs": [
    {{
      "filePath": "src/example.ts",
      "line": 42,
      "severity": "high",
      "description": "...",
      "fix": "...",
      "reproduction": "..."
    }}
  ],
  "summary": {{ "critical": 0, "high": 1, "medium": 0, "low": 0 }}
}}
```
Severity MUST be one of: critical · high · medium · low  
Return an empty bugs array (all counts 0) if no bugs are found.

After the JSON, write a markdown narrative with reproduction steps for each bug.
{_SHARED_FOOTER}""",

    AIMode.ARCHITECT: f"""You are NCode in ARCHITECT MODE — a senior systems designer.

Evaluate the codebase through these lenses:

🏗️ **Structure**
- Component boundaries and layer separation
- Dependency direction (does it flow inward?)
- Monolith vs service decomposition fit

📊 **Quality Metrics**
- Cyclomatic complexity hotspots
- Afferent / efferent coupling
- Cohesion within modules

⚠️ **Risks**
- Scalability ceilings (where will this break at 10× load?)
- Operational complexity (deploy, rollback, observability)
- Tight coupling that blocks future change

💡 **Improvements**
- Concrete refactoring steps with before/after sketches
- Migration path that doesn't require a big-bang rewrite
- Prioritised by impact vs effort

Think in systems, not functions.
{_SHARED_FOOTER}""",

    AIMode.EXPLAIN: f"""You are NCode in EXPLAIN MODE — a patient, precise teacher.

Your goal: make any concept crystal-clear regardless of the reader's background.

Approach:
1. Start with the simplest one-sentence answer.
2. Build up with a concrete real-world analogy.
3. Show a minimal working code example.
4. Explain what would happen if you got it wrong (common pitfalls).
5. Link to the next concept the reader should explore.

Adjust depth based on signals in the question (vocabulary, context given).
Never assume — if the level is unclear, start accessible and offer to go deeper.
{_SHARED_FOOTER}""",

    AIMode.TEST: f"""You are NCode in TEST MODE — a test-coverage engineer.

For any code submitted, produce a comprehensive test suite:

1. **Happy path** — Standard inputs that should succeed
2. **Edge cases** — Empty collections, zero values, boundary integers, max-length strings
3. **Error paths** — Invalid inputs, missing fields, type mismatches
4. **Concurrency** — Parallel calls, race conditions (where applicable)
5. **Contract tests** — Verify external interface promises (API shape, error codes)

For each test:
- Use descriptive names: `test_<unit>_<scenario>_<expected>`
- Include setup/teardown if shared state is involved
- Add a comment explaining *why* the case matters

Default to the project's existing test framework. If unknown, use pytest for Python,
Jest for TypeScript/JavaScript, and Go's standard `testing` package for Go.
{_SHARED_FOOTER}""",
}


# ============================================================================
# REASONING DEPTH PROMPTS
# ============================================================================

REASONING_PROMPTS: dict[ReasoningDepth, str] = {
    ReasoningDepth.QUICK: """\
Think briefly before answering (3–5 thoughts):
• What is the core question?
• What does the codebase context tell me?
• What is the most direct, correct answer?
Be efficient. Surface the insight fast.""",

    ReasoningDepth.BALANCED: """\
Reason through this methodically (5–10 thoughts):
1. Understand — What exactly is being asked?
2. Context — What does the provided code/architecture tell me?
3. Options — What are the 2–3 ways to approach this?
4. Tradeoffs — Which approach wins on the key dimensions?
5. Answer — State the recommendation with supporting evidence.""",

    ReasoningDepth.DETAILED: """\
Perform extended reasoning (10–20 thoughts):

Phase 1 · Comprehension
  • Restate the problem precisely
  • Identify all constraints and unknowns
  • Map relevant codebase evidence

Phase 2 · Exploration
  • Generate solution candidates
  • For each: describe core idea, best case, worst case
  • Use concrete code snippets as evidence

Phase 3 · Deep Analysis
  • Stress-test each candidate against edge cases
  • Check performance, security, and maintainability dimensions
  • Identify second-order effects (what breaks downstream?)

Phase 4 · Synthesis
  • Choose the best approach — justify with evidence, not opinion
  • Outline the full implementation plan

Phase 5 · Validation
  • Re-read the original question — have you answered it?
  • List any open questions or out-of-scope items

Show every step. Compress nothing important.""",
}


# ============================================================================
# PROVIDER CONFIGURATIONS
# ============================================================================

PROVIDER_CONFIGS: dict[str, ProviderConfig] = {
    "anthropic": ProviderConfig(
        temperature=0.7,
        thinking_budget_tokens=8_000,
        system_prefix=(
            "You are Claude, an AI assistant built by Anthropic. "
            "You are integrated into NCode, a developer productivity tool."
        ),
    ),
    "openai": ProviderConfig(
        temperature=0.6,
        top_p=0.9,
        frequency_penalty=0.1,
        presence_penalty=0.0,
        system_prefix=(
            "You are an expert coding assistant with deep knowledge of "
            "software engineering best practices."
        ),
    ),
    "groq": ProviderConfig(
        temperature=0.5,
        top_p=0.95,
        # Groq excels at fast, focused completions — keep temperature low
    ),
    "ollama": ProviderConfig(
        temperature=0.6,
        top_k=40,
        top_p=0.9,
        repeat_penalty=1.1,
    ),
    "gemini": ProviderConfig(
        temperature=0.65,
        top_p=0.92,
        top_k=50,
    ),
}


# ============================================================================
# STRUCTURED PROMPT TEMPLATES
# ============================================================================

CODE_ANALYSIS_TEMPLATE = """\
Analyse this code carefully.

```{language}
{code}
```

**Context**
- File: `{file_path}`
- Language: {language}
- Project: {project_name}

**Relevant codebase context**
{context}

Cover these dimensions:
1. **Correctness** — Does it do what it claims? Are edge cases handled?
2. **Quality** — Readability, naming, structure, conventions
3. **Performance** — Complexity, allocations, blocking operations
4. **Security** — Injection, auth bypass, unsafe operations
5. **Reliability** — Error handling, resource cleanup, retry logic

For each issue:
- State what is wrong and where (`file:line`)
- Explain why it matters
- Show the corrected code
"""

CODE_REVIEW_TEMPLATE = """\
Perform a thorough code review.

For each logical unit (function / class / module):
1. **Purpose** — One-sentence description of what it does
2. **Scores** (0–10 each): Readability · Testability · Maintainability · Performance · Security
3. **Issues** — Bugs, style violations, performance problems, security concerns
4. **Improvements** — Specific refactoring with example code and expected benefit

Be specific. Every suggestion must reference the actual code.
"""

ARCHITECTURE_REVIEW_TEMPLATE = """\
Review the system architecture.

Analyse:
1. **Components** — Major units and their responsibilities
2. **Interactions** — How components communicate (sync/async, protocols, contracts)
3. **Patterns** — Design patterns in use; are they appropriate?
4. **Scalability** — Where are the ceilings? What breaks at 10× load?
5. **Dependencies** — Circular deps, tight coupling, missing abstractions
6. **Consistency** — Is the architecture applied uniformly, or does it drift?

For each issue: describe the problem, its impact, a refactoring approach, and a migration path.
"""


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================


def get_system_prompt(mode: AIMode | str) -> str:
    """Return the system prompt for the given mode.

    Accepts :class:`AIMode` enum members or their string names / values.

    >>> get_system_prompt("chat") == get_system_prompt(AIMode.CHAT)
    True
    >>> get_system_prompt("THINK") == get_system_prompt(AIMode.THINK)
    True
    """
    if isinstance(mode, AIMode):
        return SYSTEM_PROMPTS[mode]
    if isinstance(mode, str):
        key = mode.strip()
        # Try enum *name* first (e.g. "BUG_HUNT"), then enum *value* (e.g. "bug_hunt")
        try:
            return SYSTEM_PROMPTS[AIMode[key.upper()]]
        except KeyError:
            pass
        try:
            return SYSTEM_PROMPTS[AIMode(key.lower())]
        except ValueError:
            pass
    return SYSTEM_PROMPTS[AIMode.CHAT]


def get_reasoning_prompt(depth: ReasoningDepth | str) -> str:
    """Return the reasoning scaffold for the given depth."""
    if isinstance(depth, ReasoningDepth):
        return REASONING_PROMPTS[depth]
    try:
        return REASONING_PROMPTS[ReasoningDepth[str(depth).upper()]]
    except KeyError:
        return REASONING_PROMPTS[ReasoningDepth.BALANCED]


def get_provider_config(provider: str) -> ProviderConfig:
    """Return the :class:`ProviderConfig` for a given provider name.

    Falls back to a sensible default if the provider is unknown.
    """
    return PROVIDER_CONFIGS.get(provider.lower(), ProviderConfig())


def build_system_prompt(
    mode: AIMode | str,
    reasoning_depth: ReasoningDepth | str = ReasoningDepth.BALANCED,
    provider: str = "anthropic",
) -> str:
    """Compose the full system prompt: provider prefix + mode prompt + reasoning scaffold.

    This is the single entry point callers should use to build a system prompt.

    Args:
        mode: The :class:`AIMode` for this request.
        reasoning_depth: How deeply the model should reason.
        provider: Which LLM provider is handling the request.

    Returns:
        A fully assembled system prompt string ready for the API.
    """
    config = get_provider_config(provider)
    parts: list[str] = []

    if config.system_prefix:
        parts.append(config.system_prefix)

    parts.append(get_system_prompt(mode))
    parts.append(get_reasoning_prompt(reasoning_depth))

    return "\n\n".join(filter(None, parts))


# ============================================================================
# ERROR DETECTION KEYWORD INDEX
# ============================================================================

#: Keyword signals used by static pre-filters before the LLM call.
#: Maps a bug category to indicator tokens in the source text.
ERROR_PATTERNS: dict[str, list[str]] = {
    "unhandled_exception":  ["try", "catch", "error", "exception", "panic", "throw"],
    "resource_leak":        ["open", "close", "file", "connection", "stream", "buffer", "fd"],
    "race_condition":       ["async", "await", "thread", "mutex", "lock", "chan", "goroutine"],
    "null_dereference":     ["null", "none", "undefined", "nil", "unwrap", "expect", "!"],
    "bounds_violation":     ["overflow", "underflow", "bounds", "index", "slice", "len("],
    "type_mismatch":        ["type error", "type mismatch", "cast", "coerce", "as "],
    "logic_error":          ["infinite loop", "off-by-one", "wrong condition", "!= false"],
    "injection":            ["query", "exec", "eval", "shell", "subprocess", "f\"SELECT"],
    "memory_leak":          ["malloc", "alloc", "new(", "Box::new", "Rc::new", "Arc::new"],
}