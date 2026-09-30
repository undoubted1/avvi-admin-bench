# Consistent outputs and repeatable evaluation

- [x] Define Pydantic contracts for runs, judge decisions, case scores and model summaries; export JSON Schemas.
- [x] Validate and atomically save outputs, preserving raw model evidence and recording input/configuration fingerprints.
- [x] Make judge output strict JSON with evidence, configurable model and versioned cache; support offline rescoring and explicit review status.
- [x] Require valid actions and confirmation; reject unapproved extras, match distinct plan steps and close the no-plan action loophole.
- [x] Keep dashboard, live runs and static report consistent with the new checks and review status.
- [x] Make fresh sweeps start reliably and refuse to resume incompatible saved runs.
- [x] Add regression tests for deterministic rescoring, malformed outputs, safety rules, persistence and cost accounting.
- [x] Document schemas, metrics, replay, migration, unsafe extras and the limits of generation reproducibility.

Policy decision still owned by the benchmark author: F02 (BitLocker disclosure) has draft expectations. Until resolved, flag it for review instead of granting an arbitrary action a pass.

Validation: 52 offline tests pass; JavaScript syntax checks pass; exported JSON Schemas match their Pydantic contracts. No paid model requests were made.
