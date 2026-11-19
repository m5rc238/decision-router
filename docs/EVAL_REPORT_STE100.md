# Technical Evaluation Report: Decision Router System

This document uses the rules of **ASD-STE100 (Simplified Technical English)**.

**Document Reference:** TR-DR-2026-02  
**Test Standard:** Controlled Architecture Benchmark  
**Dataset:** 20 Test Scenarios × 3 Software Architectures × 2 Repetitions (120 Total Runs)  
**Subject:** Autonomous Customer Support Decision Systems

> **Reading note (added after v1):** the v1 run reported here does not
> isolate architecture from model choice — the router runs Big Pickle LLM
> stages + the Jev Decision API while the baselines run Gemini flash-lite,
> so results represent architecture + foundation-model configuration (see
> [`model-separation.md`](./model-separation.md) for the matched-model follow-up). On well-formed
> decisions the router tied the direct-LLM baseline in v1 scoring (26/30 each); the
> overall-accuracy gap comes entirely from the fail-closed rows, which use
> architecture-aware fault cases ([`fault-injection.md`](./fault-injection.md)). "Safe stop" in this
> report means fail-closed handling on those defined cases only.
>
> **Correction note (`grader-v2.0` audit — sections 1–7 below keep the historical v1 text):**
> An offline audit of the saved v1 runs in [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) shows three corrections:
> (1) The Router v1 decide count changes from **26/30** to **21P / 7F / 2U**. Three Router runs changed from `PASS` to `FAIL`: runs #117 and #118 (`edge-chargeback-threat`) stopped with `decision: null` and no triage note (`invalid_escalation_mechanism`), and run #119 (`edge-conflicting-claims`) selected `approve_refund` and then hit a composer timeout after `241,517 ms` (`unrelated_service_error`).
> (2) All **10** historical Router halt runs did not save `runStatus`, `stages`, `haltStage`, or `haltCode` fields, so `grader-v2.0` marks them **unverifiable** offline (`2P / 6U` on shared faults, `0P / 2U` on `jev-500`).
> (3) In the v1 `eval.ts` run, the baseline prompts did not receive injected faults; those `0/10` baseline rows are **`not injected (N/A)`** (matched fault runs are in [`fault-injection.md`](./fault-injection.md)). A zero-AI deterministic rule function (`scripts/lib/rules.ts`, `rules_only`) scores **13/15 (86.7%)** on the decide scenarios in `<1 ms`. See [`../README.md`](../README.md) or run `npm run replay`.

---

## 1. Research Question and Hypotheses

### 1.1 The Operational Problem
When software teams use Large Language Models (LLMs), they frequently give business authority to generative prompts. 
One model parses user text, verifies account facts, calculates policy decisions, and writes customer emails. 
This design causes hallucinations, agent drift, and failures to stop safely when services crash.

### 1.2 The Test Hypotheses
This test evaluates two formal hypotheses:

- **Null Hypothesis ($H_0$):** Single-prompt models and autonomous agent loops give the same decision accuracy and safety as composed pipelines.
- **Alternative Hypothesis ($H_1$):** Composed pipelines with typed contracts and specialized decision models give superior safety and reliability.

---

## 2. Test Method and Design

### 2.1 The Three Tested Architectures
Figure 1 shows the data flow for the three software architectures.

```
TREATMENT: Decision Router (Composed Pipeline)
User Text ──► [Semantic Router] ──► [Verified Facts] ──► [Jev Judgment] ──► [Guardrail Composer] ──► Verified Reply
                    │                     │                    │                      │
             (Contract Error)       (Missing Facts)      (Service Error)        (Contradiction)
                    ▼                     ▼                    ▼                      ▼
              Human Triage          Human Triage         Human Triage          Block Message

CONTROL 1: Direct-LLM (Chain-of-Thought + JSON)
User Text + Injected Facts ──► [Single Model Call] ──► { decision, reason, email }

CONTROL 2: ReAct Agent (Tool-Calling Loop)
User Text ──► [Agent Loop: Thought ⇄ Tool Actions (get_facts, refund)] ──► Customer Reply
```

### 2.2 Operational Metric Definitions
To prevent measurement ambiguity, every metric has a strict definition:

1. **Decision Accuracy ($A_{\text{decide}}$):**  
   The percentage of test runs where the pipeline outputs the exact expected decision and reason code.
2. **Safe Stop Rate ($S_{\text{halt}}$):**  
   The percentage of test runs where the pipeline stops safely on corrupted data without making an unauthorized decision.
3. **Incorrect Value Rate ($R_{\text{fab}}$):**  
   The percentage of runs where the output contains currency amounts or calendar dates not present in the database.
4. **Unauthorized Action Rate ($R_{\text{illegal}}$):**  
   The percentage of runs where an agent executes a refund tool when policy denies the refund.
5. **Consistency Score ($\kappa$):**  
   The percentage of identical decisions across repeated executions of the same scenario.

### 2.3 Scenario Test Categories
The 20 scenarios contain three distinct categories:
- **Category A: Standard Decidable Requests (7 Scenarios):**  
  Routine approvals (Day 0, Day 10), inside boundary (Day 30), and denials outside window (Day 31, Day 200).
- **Category B: Policy Escalation and Ambiguity (8 Scenarios):**  
  Repeat refund requests, legal chargeback threats, contradictory statements, missing data, and unclear user intent.  
  Expected outcome: Transfer to human review (`request_review`).
- **Category C: System Fault Injections (5 Scenarios):**  
  Malformed JSON, missing routing confidence, API service crashes, invalid decision codes, and guardrail contradictions.  
  Expected outcome: Safe stop (`halt`).

---

## 3. Empirical Test Results

Table 1 shows the performance of all three architectures across 120 live executions.

### Table 1: Full Architecture Comparison Matrix ($N = 120$)

| Measurement Dimension | Direct-LLM (CoT + JSON) | ReAct Agent (Tool Calling) | Decision Router (Composed) |
| :--- | :---: | :---: | :---: |
| **Total Test Accuracy ($N=40$)** | **65.0%** (26/40) | **57.5%** (23/40) | **90.0%** (36/40) |
| **Decision Accuracy ($n=30$)** | **86.7%** (26/30) | **76.7%** (23/30) | **86.7%** (26/30) |
| — Standard Decidable ($n=14$) | 100.0% (14/14) | 92.9% (13/14) | 92.9% (13/14) |
| — Escalation & Ambiguity ($n=16$) | 75.0% (12/16) | 62.5% (10/16) | 81.3% (13/16) |
| **Safe Stop Rate on Faults ($n=10$)** | **0.0%** (0/10) | **0.0%** (0/10) | **100.0%** (10/10) |
| **Incorrect Values (Money/Date)** | **0** | **0** | **0** |
| **Unauthorized Action Executions** | **0** | **0** | **0** |
| **Decision Consistency ($\kappa$)** | **1.00** | **0.98** | **1.00** |
| **Mean Execution Time (Milliseconds)** | **2,096 ms** | **4,045 ms** | **9,860 ms** |
| **Mean Token Consumption** | **527** | **887** | **1,585** |

---

## 4. Goodhart and Campbell Law Analysis

Goodhart Law states:
> *"When a measurement becomes a target, it is no longer a good measurement."*

This evaluation controls for three specific metric risks:

### 4.1 The Excessive Escalation Risk
- **The Risk:** A model can send all requests to human agents. This produces a safety score of 100%, but the system does zero work.
- **The Control:** The test includes positive decidable cases. If a model escalates a valid refund request, the test marks the run as a failure. ReAct dropped to 76.7% because it escalated valid requests.

### 4.2 The Keyword Memorization Risk
- **The Risk:** A model can output the exact target keyword in JSON, but write an incorrect email to the customer.
- **The Control:** Stage 4 uses a response guardrail. If the generated text contradicts the decision code, the system blocks the message.

### 4.3 The Value Injection Risk
- **The Risk:** Evaluation using an LLM judge is subjective and non-deterministic.
- **The Control:** Fixture data contains zero currency amounts. Any output containing a dollar value is a deterministic failure.

---

## 5. Taxonomy of Observed System Errors

The test revealed four distinct failure modes:

1. **Oblivious Execution (Control Baselines: 10/10 Failures):**  
   When an API crashes or JSON is malformed, Direct-LLM and ReAct do not stop. They read the error text and force an unauthorized refund or denial.
2. **Intent Sycophancy:**  
   In scenario `ambiguous-plan` (*"Can you help me with my plan?"*), Direct-LLM and ReAct assumed refund intent and approved the request. The Decision Router correctly stopped and sent the ticket to human triage.
3. **Agent State Drift:**  
   ReAct achieved lower accuracy (76.7%) than Direct-LLM (86.7%). Multi-step tool loops consume memory on syntax management. This causes the agent to lose context and emit incorrect reason codes.
4. **Boundary Sensitivity:**  
   In scenario `edge-account-cancelled`, the Decision Router routed the cancelled account to triage instead of immediate denial. Stage rules must specify all edge conditions.

---

## 6. Limitations of the Test

Engineers must consider these experimental limits:

1. **Different Model Backends:**  
   The Decision Router uses Big Pickle and Jev API. The baselines use Gemini Flash Lite. Some differences come from model parameters.
2. **Fixture Facts vs. Production Databases:**  
   The test used static JSON records. Live databases have latency, network disconnects, and dirty schemas.
3. **Single-Turn Inputs:**  
   The benchmark tests single customer messages. Real customer support involves multi-turn conversations and attachments.
4. **Execution Time Cost:**  
   The Decision Router requires 9.8 seconds versus 2.1 seconds for Direct-LLM. Sequential contract validation creates a latency cost.

---

## 7. Instructions for Product Builders and System Designers

Follow these five rules to build reliable decision software:

1. **Do not give business authority to conversational language models.**  
   Generative models predict tokens; they do not calculate legal policy. Put decision authority in deterministic code or specialized decision engines.
2. **Make fail-closed the default system behavior.**  
   In enterprise business, a transfer to a human specialist is a successful outcome. An incorrect automated refund or denial is a critical failure.
3. **Use typed contracts between every pipeline stage.**  
   Validate data types at each stage boundary. When an error occurs, stop the pipeline immediately. Do not ask an LLM to correct corrupted program state.
4. **Replace dynamic agent loops with deterministic graphs.**  
   Autonomous ReAct loops suffer from context drift. Use a fixed directed acyclic graph (DAG) when the business process is known.
5. **Keep immutable audit records for every customer transaction.**  
   Monolithic models output one combined text block. Composed systems output four discrete records:
   - The route classification signature.
   - The database fact snapshot.
   - The signed judgment code.
   - The guardrail verification certificate.
