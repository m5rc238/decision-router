# Empirical Evaluation of Composed Pipeline Architectures vs. Monolithic LLM Baselines in Autonomous Decision Systems

**Authors:** Decision Router Research & Evaluation Team  
**Dataset:** 20 Gold-Standard Scenarios × 3 Architectures × 2 Repetitions ($N = 120$ Independent Executions)  
**System Commit:** `3b4e67f` | **Artifact ID:** `TR-DR-2026-02`  
**Classification:** Epistemic Systems Evaluation & Methodology Paper

> **Reading note (added after v1):** the v1 run reported here does not
> isolate architecture from model choice — the router runs Big Pickle LLM
> stages + the Jev Decision API while the baselines run Gemini flash-lite,
> so results represent architecture + foundation-model configuration (see
> [`model-separation.md`](./model-separation.md) for the matched-model follow-up). On well-formed
> decisions the router tied the direct-LLM baseline in v1 scoring (26/30 each); the
> overall-accuracy gap comes entirely from the fail-closed rows, which use
> architecture-aware fault cases ([`fault-injection.md`](./fault-injection.md)). "Safety" in this
> report means fail-closed handling on those defined cases only.
>
> **v2.1 `grader-v2.0` errata (sections 1–7 below preserve the historical v1 report verbatim):**
> An offline re-score of the saved v1 runs in [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) exposed three defects in v1 scoring:
> (1) the historical Router **26/30** decide score re-scores to **21P / 7F / 2U** because 3 runs flipped from `PASS` to `FAIL` (#117–#118 `edge-chargeback-threat` halted with `decision: null` and no triage note [`invalid_escalation_mechanism`]; #119 `edge-conflicting-claims` wrongly approved then timed out at composer after `241,517 ms` [`unrelated_service_error`]);
> (2) all **10/10** historical Router halt runs lack saved `runStatus`/`stages`/`haltStage`/`haltCode` fields and are flagged **unverifiable** offline (`2P / 6U` on shared faults, `0P / 2U` on `jev-500`; overall stage checks `4P / 6F / 10U / 20ns`);
> (3) `eval.ts` never injected faults into the v1 baseline prompts, so the baseline `0/10` fault rows represent **`not injected (N/A)`** (`8` shared faults un-injected, `2` `jev-500` excluded) — matched fault results (`0/4` CoT/ReAct vs `4/4` Direct+validator) come from [`fault-injection.md`](./fault-injection.md). A zero-AI deterministic rule function (`scripts/lib/rules.ts`, `rules_only`) also achieves **13/15 (86.7%)** on the decide set in `<1 ms`. See [`../README.md`](../README.md) and [`../eval_results_summary.md`](../eval_results_summary.md) or run `npm run replay`.

---

## Abstract

Automating enterprise customer support decisions (e.g., refund authorizations, subscription cancellations, entitlement escalations) requires strict adherence to business policy, absolute factual grounding, and verifiable fail-closed safety. Industry deployments predominantly rely on monolithic Chain-of-Thought (CoT) prompting or unconstrained ReAct agent loops. In this study, we subject three production architectures—(1) **Direct-LLM with CoT Structured Output**, (2) **ReAct Tool-Calling Agent**, and (3) **The Decision Router (a Composed Directed Acyclic Graph with typed contracts, deterministic facts, and specialized judgment)**—to a controlled, 20-scenario empirical benchmark under repeat sampling ($N=120$). 

Our findings demonstrate that while Direct-LLM and Composed architectures achieve identical decision accuracy on well-formed, decidable requests (**86.7%**, 26/30), monolithic and agentic baselines suffer complete failure on system fault tolerance and intent ambiguity (**0.0%** safe halt rate, 0/10), consistently forcing hallucinated approvals or denials on corrupted inputs. Conversely, the Decision Router demonstrates **100.0%** fail-closed safety (10/10) and **90.0%** overall accuracy across all edge scenarios. We analyze these results through the lens of Goodhart's and Campbell's Laws, formulate a taxonomy of agentic failure modes, and provide an epistemically rigorous framework for deploying autonomous decision systems in regulated environments.

---

## 1. Research Question & Hypotheses

### 1.1 The Operational Problem
When LLMs are integrated into core business workflows, they are frequently granted implicit business authority: the same model instance that parses conversational text also verifies account state, interprets legal terms, decides financial disbursement, and composes customer replies. This architectural coupling creates severe failure modes: sycophancy, multi-turn state drift, and an inability to fail closed when dependencies crash or facts are missing.

### 1.2 Formal Hypotheses
We establish the following falsifiable hypotheses:

- **Null Hypothesis ($H_0$):** Monolithic single-prompt (CoT) and unconstrained agentic loops (ReAct) achieve equivalent decision accuracy, factual consistency, and fail-closed safety compared to a composed multi-stage pipeline with typed stage boundaries ($P_{\text{Router}} = P_{\text{Baseline}}$).
- **Alternative Hypothesis ($H_1$):** A composed architecture with deterministic factual grounding, typed boundary contracts, and specialized formal judgment models achieves superior overall reliability ($P_{\text{Router}} > P_{\text{Baseline}}$), driven primarily by a non-zero fail-closed safety rate on corrupted and ambiguous inputs.

---

## 2. Experimental Methodology & Design

### 2.1 Treatment vs. Control Topologies

```
TREATMENT ARCHITECTURE: Decision Router (Composed DAG)
User Query (x)
     │
     ▼
[Stage 1: Semantic Router (LLM)] ──(Invalid JSON / Low Conf)──► [Human Triage Handoff]
     │ (Typed Route Contract: r)
     ▼
[Stage 2: Deterministic Facts (DB)] ──(Records Incomplete)─────► [Human Triage Handoff]
     │ (Immutable Snapshot: F)
     ▼
[Stage 3: Formal Judgment (Jev)] ──(Service Error / Corrupt)──► [Human Triage Handoff]
     │ (Signed Decision: d, Reason: c)
     ▼
[Stage 4: Response Composer (LLM)] ──(Contradiction Guardrail)─► [Block & Escalate]
     │
     ▼
Verified Customer Email

CONTROL 1: Direct-LLM (CoT + Structured Output)
User Query (x) + Injected Facts (F) ──► [Single LLM Call] ──► { decision, reason, reply }

CONTROL 2: ReAct Tool-Calling Agent
User Query (x) ──► [Agent Loop: Thought ⇄ Action (get_support_record, execute_refund)] ──► Reply
```

### 2.2 Operational Definitions of Metrics
To prevent epistemic ambiguity, every metric is formally operationalized:

1. **Domain Decision Accuracy ($A_{\text{decide}}$):** For scenarios where gold specification $G(s) \to \text{decide}$, the proportion of runs where the pipeline emits the exact expected tuple $(d^*, c^*)$:
   $$\mathcal{M}_{\text{decision}}(s) = \mathbf{1}\left[ d_{\text{actual}} = d^* \land c_{\text{actual}} = c^* \right]$$
2. **Fail-Closed Safety Rate ($S_{\text{halt}}$):** For scenarios where gold specification $G(s) \to \text{halt}$ (due to service faults, missing facts, or semantic ambiguity), the proportion of runs where the pipeline terminates without emitting an active approval or denial:
   $$\mathcal{M}_{\text{halt}}(s) = \mathbf{1}\left[ \text{status} \in \{\text{error}, \text{triage}\} \land d_{\text{actual}} \notin \{\text{approve\_refund}, \text{deny\_refund}\} \right]$$
3. **Fabrication Rate ($R_{\text{fab}}$):** The frequency with which a pipeline introduces calendar dates or currency amounts not present in the factual record $F$. Given that the experimental domain defines zero dollar amounts ($F_{\$} = \emptyset$), any detected currency pattern represents an objective factual hallucination:
   $$R_{\text{fab}} = \frac{1}{N} \sum_{i=1}^N \mathbf{1}\left[ \text{Regex}_{\text{currency}}(\text{text}_i) \lor \text{Regex}_{\text{date}}(\text{text}_i) \right]$$
4. **Illegal Action Rate ($R_{\text{illegal}}$):** The frequency with which an autonomous tool-calling agent executes a state-modifying mutation (`execute_refund`) when policy forbids the refund:
   $$R_{\text{illegal}} = \frac{1}{N} \sum_{i=1}^N \mathbf{1}\left[ a_i = \text{execute\_refund} \land d^*(s_i) \neq \text{approve\_refund} \right]$$
5. **Consistency Score ($\kappa$):** The proportion of identical decision-reason pairs produced across repeat runs of the same scenario:
   $$\kappa(s) = \frac{\max_{k} \text{count}(k)}{\text{repeats}}$$
   Identical repeats yield $\kappa(s) = 1.00$; a single discordant repeat yields $\kappa(s) = 0.50$ at 2 repeats. Reported values were recomputed from the raw run pairs (see §7.2).

### 2.3 Scenario Suite Stratification ($K = 20$)
The 20 scenarios are strictly pre-registered into three functional strata:
- **Stratum A: Positive Decidable Cases ($n=7$):** Routine approvals within window (Day 0, Day 10), exact inside boundary (Day 30), and clear denials outside window (Day 31, Day 200) or on inactive accounts.
- **Stratum B: Policy Escalation & Semantic Ambiguity ($n=8$):** High-risk repeat refunders ($\ge 2$ prior refunds), chargeback legal threats, contradictory customer claims, missing database records, and unclassifiable user intent (*"Can you help me with my plan?"*). Gold target: `request_review`.
- **Stratum C: System Fault Injections ($n=5$):** Malformed router JSON, missing routing confidence, Jev endpoint network crash (HTTP 500/503), Jev emitting undefined enum values, and Response Composer contradicting the upstream decision. Gold target: `halt`.

---

## 3. Empirical Results & Comparative Analysis

Across 120 total live runs (20 scenarios × 3 architectures × 2 repeats), all executions completed deterministically without process unhandled rejections.

### Table 1: Full Empirical Benchmark Matrix ($N = 120$)

| Evaluation Dimension | Direct-LLM (CoT + JSON) | ReAct Agent (Tool Calling) | Decision Router (Composed DAG) |
| :--- | :---: | :---: | :---: |
| **Total Benchmark Accuracy ($N=40$)** | **65.0%** (26/40) | **57.5%** (23/40) | **90.0%** (36/40) |
| **Stratum A & B: Decision Accuracy ($n=30$)** | **86.7%** (26/30) | **76.7%** (23/30) | **86.7%** (26/30) |
| — Routine Decidable Cases ($n=14$) | 100.0% (14/14) | 92.9% (13/14) | 92.9% (13/14) |
| — Risk Escalation & Ambiguity Cases ($n=16$) | 75.0% (12/16) | 62.5% (10/16) | 81.3% (13/16) |
| **Stratum C: Fail-Closed Safety ($n=10$)** | **0.0%** (0/10) | **0.0%** (0/10) | **100.0%** (10/10) |
| **Fabricated Value Injections ($N=40$)** | **0** | **0** | **0** |
| **Illegal Action Executions ($N=40$)** | **0** | **0** | **0** |
| **Decision Repeat Consistency ($\kappa$)** | **1.00** | **0.98** | **1.00** |
| **Mean End-to-End Latency** | **2,096 ms** | **4,045 ms** | **9,860 ms** |
| **Mean Token Consumption (In + Out)** | **527 tok** | **887 tok** | **1,585 tok** |

---

## 4. Epistemic Hygiene: Goodhart’s & Campbell’s Law Analysis

In AI safety benchmarking, metric gaming frequently produces the illusion of reliability while real-world deployment fails. We identify and explicitly address three core Goodhart vulnerabilities in our experimental protocol:

### 4.1 The Pathological Review Heuristic (Trivial Safety Gaming)
- **The Vulnerability:** If a benchmark solely measures "safety" by whether an architecture avoids unauthorized financial disbursements, an agent can achieve a 100% safety score by implementing a trivial trivialization strategy: *escalate every ticket to human review*.
- **Empirical Control:** Our benchmark enforces strict symmetric scoring. An agent that outputs `request_review` on valid, unambiguous refund cases (e.g. Day 10, Active Account) receives a score of **0%** for that scenario. ReAct suffered on this margin, prematurely escalating `edge-just-bought` and `refund-30-days` and dropping its decision accuracy to 76.7%.

### 4.2 Reason Code Memorization vs. Natural Language Entailment
- **The Vulnerability:** LLMs can easily be prompt-engineered to emit the string token `"within_refund_window"` in a JSON payload, while simultaneously generating a customer-facing apology that states: *"We are rejecting your refund because your account was cancelled."*
- **Empirical Control:** The Decision Router incorporates an automated entailment guardrail in Stage 4 (`response_composer`). If the generated natural language text contradicts the formal decision enum emitted by Stage 3, the pipeline trips a `composer_contradiction` exception and blocks message dispatch.

### 4.3 Factual Invariance & The Zero-Dollar Domain Control
- **The Vulnerability:** Evaluating hallucination via secondary LLMs ("LLM-as-a-judge") introduces non-deterministic evaluator bias, prompt injection vulnerability, and uncalibrated false-negative rates.
- **Empirical Control:** We established an epistemically invariant domain constraint: the fixture records contain exactly zero monetary amounts and zero calendar dates. This converts hallucination evaluation from a subjective semantic judgment into a mathematically exact regex entailment test. Any generated dollar sign is provably fabricated.

---

## 5. Taxonomy of Failure Modes

Analysis of the 120 execution traces reveals distinct failure modes characteristic of each architecture:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       TAXONOMY OF OBSERVED FAILURES                        │
├─────────────────────────┬──────────────────────────┬───────────────────────┤
│ Failure Mode            │ Primary Architecture     │ Mechanism             │
├─────────────────────────┼──────────────────────────┼───────────────────────┤
│ 1. Oblivious Execution  │ Direct-LLM, ReAct Agent  │ Evaluates corrupt data│
│ 2. Intent Sycophancy    │ Direct-LLM, ReAct Agent  │ Guesses user goal     │
│ 3. Scratchpad Drift     │ ReAct Agent              │ State loss across loop│
│ 4. Boundary Asymmetry   │ Decision Router          │ Edge parser variance  │
└─────────────────────────┴──────────────────────────┴───────────────────────┘
```

1. **Oblivious Execution (10/10 Failures in Baselines):** When injected with malformed router output or a crashed decision API, Direct-LLM and ReAct do not halt. Lacking architectural stage boundaries, the model ingests the error message as context and forces a hallucinated `deny_refund` or `approve_refund`.
2. **Intent Sycophancy:** In `ambiguous-plan` (*"Can you help me with my plan?"*), both Direct-LLM and ReAct assumed the customer wanted a refund and approved it. The Decision Router correctly identified the semantic ambiguity in Stage 1 and routed to `human_triage`.
3. **Scratchpad Drift in Agent Loops:** ReAct performed worse than Direct-LLM (76.7% vs. 86.7% on decision accuracy). As the ReAct agent accumulates tool observations in its scratchpad, reasoning capacity is consumed by syntax management, leading to reason code confusion (emitting `regular_review` instead of `irregular_review` on repeat refunds).
4. **Boundary Asymmetry:** In `edge-account-cancelled`, the Decision Router failed to output `not_eligible` because the semantic router routed the cancelled state into triage rather than judgment. This highlights that stage contracts must be calibrated across all edge enumerations.

---

## 6. Threats to Validity & Limitations

To ensure full epistemic integrity, we document all known limitations of this study:

1. **Heterogeneous Model Confound:**
   - The Decision Router uses OpenCode Big Pickle for stages 1 & 4, and TypeSafe Jev API for stage 3.
   - The baselines run on Google Gemini Flash Lite.
   - *Epistemic Consequence:* While this reflects real-world engineering (combining high-throughput classifiers with bounded reasoning engines), performance deltas reflect both architectural topology and underlying model pretraining weights.
2. **Deterministic DB Fixtures vs. Distributed Production Latencies:**
   - Support facts were injected via in-memory fixture snapshots rather than distributed SQL/NoSQL stores with network partitions and dirty reads.
3. **Single-Turn Interaction Ceiling:**
   - Scenarios measure single-turn decision velocity. Real customer support workflows involve multi-turn conversational repair, customer frustration escalation, and document attachment processing.
4. **Latency Trade-Off Profile:**
   - The Decision Router exhibited a mean latency of **9,860 ms** versus **2,096 ms** for Direct-LLM. This ~4.7× latency multiplier is the physical cost of sequential contract verification and cross-service HTTP serialization.

---

## 7. Strategic Principles for AI Systems Engineers

From this investigation, we synthesize four mandatory axioms for engineering autonomous enterprise decision systems:

1. **The Authority Isolation Axiom:**  
   *Never grant business authority to a conversational generative model.* Generative models are probabilistic word predictors; business decisions require deterministic policy execution. The authority to approve a transaction must reside in a typed contract or bounded decision service (e.g. Jev).
2. **The Fail-Closed Default:**  
   *In enterprise operations, unhandled ambiguity must halt to human triage.* An automated rejection of an entitled customer damages retention; an automated hallucinated approval creates financial liability. Halting to triage is a primary success metric, not an unhandled exception.
3. **Contract-Driven Stage Decomposition:**  
   *Replace dynamic ReAct loops with deterministic Directed Acyclic Graphs (DAGs) wherever the business process is known.* Autonomous agent loops suffer from state drift and compounding error rates. A DAG with typed boundaries guarantees stage-by-stage auditability.
4. **The Artifact Audit Trail:**  
   *Every automated decision must produce immutable audit records.* Monolithic systems emit an unverifiable text blob. Composed systems produce: (1) Route Classification Signature, (2) Database Fact Snapshot, (3) Signed Decision Code, and (4) Guardrail Contradiction Clearance.

---

## 8. Reproducibility & Repository Artifacts

- **Evaluation Runner Script:** [`scripts/eval.ts`](../scripts/eval.ts)
- **Scenario Definitions & Gold Oracle:** [`src/lib/live/gold.ts`](../src/lib/live/gold.ts), [`scripts/lib/scenarios.ts`](../scripts/lib/scenarios.ts)
- **Sanitized Offline Replay Bundle (`grader-v2.0`):** [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) (archives the historical `eval-results-v1.json` / `eval-results.json` runs alongside repeat-5 and fault-matrix logs; recompute offline with `npm run replay`)
- **Interactive UI Dashboard:** Available at `http://localhost:5173/#results`
