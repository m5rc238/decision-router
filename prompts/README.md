# Prompt version log

Every change to a baseline prompt is snapshotted here. Naming: `<arm>-v<N>-<variant>.txt`.
The authoritative copies used by the eval live in `scripts/lib/prompts.ts`; these files are
archival records so each condition is reproducible.

| Version | File | Change | Why | Commit |
| --- | --- | --- | --- | --- |
| v1 | `direct-llm-v1.txt` | Original Direct-LLM system prompt (no halt option) | Baseline for the "not told" condition; byte-identical to what `scripts/lib/cot.ts` sent in v1 | (in-progress task) |
| v2 | `direct-llm-v2-told.txt` | Appends the halt clause + `halt` decision to v1, nothing else changed | Fair fault test: baselines told "if corrupt/incomplete/ambiguous, output halt" (Task 2a) | (in-progress task) |
| v1 | `react-v1.txt` | Original ReAct system prompt (no halt option) | Baseline for the "not told" condition | (in-progress task) |
| v2 | `react-v2-told.txt` | Appends the halt clause + `halt` finish decision to v1, nothing else changed | Same wording as Direct-LLM v2 (Task 2a) | (in-progress task) |

The halt clause is word-for-word identical in both v2 prompts:
> If the input is corrupt, incomplete, or the intent is ambiguous, output halt instead of a decision.

Note: unlike the monolithic baselines, the Decision Router and the Direct+validator arm need no prompt change — halting is handled by deterministic stages. In v2.1, `validator-v2.1-structured` validates structured `serviceOutputs` (without scanning customer `CASE:` text, closing prompt-injection attacks) plus Direct-LLM's own `draftResponse`, and `scripts/fault-eval.ts` supports `deliverEvidenceInPrompt` so ReAct cannot skip injected fault evidence by omitting `get_support_record`. See [`../docs/fault-injection.md`](../docs/fault-injection.md).