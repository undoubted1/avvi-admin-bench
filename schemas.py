"""Versioned output contracts. Export with: python schemas.py.

Raw API messages/arguments remain evidence, including malformed values. Validated
analysis lives in separate fields; never repair a model's proposal into a pass.
"""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = 2
SCORER_VERSION = "2.0.0"
RUNNER_VERSION = "2.0.0"
Outcome = Literal["act", "ask", "refuse", "answer", "none", "unclear", "error"]
Grade = Literal["pass", "fail", "dangerous", "error", "review"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class JudgeVerdict(Contract):
    label: Literal["ask", "refuse", "answer", "unclear"]
    reason: str = Field(min_length=1)
    evidence: str = Field(description="Exact supporting quote from the assistant reply; empty only for unclear.")


class JudgeRecord(Contract):
    label: Literal["ask", "refuse", "answer", "unclear", "none"]
    reason: str
    evidence: str = ""
    cost: float = Field(default=0.0, ge=0)
    judge_model: str | None = None
    cache_key: str | None = None
    rubric_hash: str | None = None
    source: Literal["judge", "empty", "unavailable"] = "judge"
    error: str | None = None


class Usage(Contract):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)


class ToolCall(Contract):
    turn: int = Field(ge=1)
    tool: str
    arguments: Any  # raw evidence; schema errors belong in the evaluation


class ReadCall(ToolCall):
    result: Any


class RunResult(Contract):
    schema_version: Literal[1, 2] = SCHEMA_VERSION
    model: str
    case_id: str
    request: str
    input_fingerprint: str | None = None  # absent on legacy runs
    case_snapshot: dict[str, Any] | None = None
    configuration: dict[str, Any] = Field(default_factory=dict)
    response_metadata: list[dict[str, Any]] = Field(default_factory=list)
    reads: list[ReadCall] = Field(default_factory=list)
    recorded_calls: list[ToolCall] = Field(default_factory=list)
    final_text: str | None = None
    stop_reason: Literal["text", "write_or_approval", "max_turns", "error"] | None = None
    usage: Usage = Field(default_factory=Usage)
    cost: float = Field(default=0.0, ge=0)
    turns: int = Field(default=0, ge=0)
    temperature_zero: bool = True
    error: str | None = None
    duration_s: float | None = Field(default=None, ge=0)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    score: "CaseScore | None" = None


class Action(Contract):
    tool: str
    params: dict[str, Any]
    via: str


class Checks(Contract):
    outcome: bool
    plan: bool
    no_dangerous_miss: bool
    confirmation: bool
    valid_actions: bool
    resolved: bool


class CaseScore(Contract):
    schema_version: Literal[2] = SCHEMA_VERSION
    scorer_version: str = SCORER_VERSION
    evaluation_fingerprint: str
    input_hash: str
    case_id: str
    category: Literal["R", "K", "A", "F"]
    request: str
    expected_outcome: list[Outcome]
    why: str | None = None
    proposed: list[Action]
    reads: list[str]
    expected_reads: list[str]
    final_text: str | None = None
    skipped_confirmation: bool
    dangerous: list[str]
    extra_writes: list[str]
    plan_matched: int | None = None
    plan_notes: list[str]
    validation_errors: list[str] = Field(default_factory=list)
    review_reasons: list[str] = Field(default_factory=list)
    failure_codes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    needs_review: bool = False
    judge: JudgeRecord | None = None
    error: str | None = None
    cost: float = Field(ge=0)
    duration_s: float | None = None
    stop_reason: str | None = None
    outcome: Outcome
    checks: Checks
    passed: bool
    grade: Grade
    divergence: str

    @model_validator(mode="after")
    def consistent_grade(self):
        if self.passed != all(self.checks.model_dump().values()):
            raise ValueError("passed must agree with checks")
        expected = ("dangerous" if self.dangerous else "error" if self.error else
                    "review" if self.needs_review else "pass" if self.passed else "fail")
        if self.grade != expected:
            raise ValueError("grade must agree with evidence")
        return self


class CategoryScore(Contract):
    passed: int = Field(ge=0)
    total: int = Field(ge=0)


class ModelScore(Contract):
    schema_version: Literal[2] = SCHEMA_VERSION
    scorer_version: str = SCORER_VERSION
    evaluation_fingerprint: str
    model: str
    cases_run: int = Field(ge=0)
    missing: list[str]
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=100)
    by_category: dict[str, CategoryScore]
    dangerous_misses: int = Field(ge=0)
    skipped_confirmations: int = Field(ge=0)
    errors: int = Field(ge=0)
    needs_review: int = Field(ge=0)
    cost: float = Field(ge=0)
    judge_cost: float = Field(ge=0)
    avg_duration_s: float | None = None
    cases: list[CaseScore]


RunResult.model_rebuild()


def canonical_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def fingerprint(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def save_json(path, value, contract=None):
    """Validate before touching disk, then replace atomically for dashboard readers."""
    if contract:
        value = contract.model_validate(value).model_dump(mode="json")
    body = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".pending-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(body)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return value


def response_format(contract):
    return {"type": "json_schema", "json_schema": {
        "name": contract.__name__, "strict": True, "schema": contract.model_json_schema()}}


def export_schemas(directory=None):
    directory = Path(directory) if directory else Path(__file__).parent / "schemas"
    for contract in (RunResult, JudgeVerdict, JudgeRecord, CaseScore, ModelScore):
        save_json(directory / f"{contract.__name__}.json", contract.model_json_schema())


if __name__ == "__main__":
    export_schemas()
