# Expected-Battle-Math Task-Force Optimization for a Card-Driven Wargame AI: A Doctrine-Constrained Study on Empire of the Sun

**Working paper draft** — research/paper/paper-draft.md (v0.1, 2026-09-09)
目标期刊定位：CCF-A（如 JAIR/AAAI/AAMAS 赛道）或 IEEE Transactions on Games（按最终实验强度定）。
状态：方法/实验设计定稿；结果栏位待正式实验回填。

---

## 1 Introduction

Card-driven hex-and-counter wargames sit at the high end of game-AI complexity: large maps, long
horizons, partial observability (hidden hands), stochastic combat, and — crucially — a very high
proportion of hard rule constraints (supply, HQ activation, amphibious transport, ZOI).
Reinforcement-learning results in this genre (Palma et al. 2025) still collapse when maps scale
beyond tiny boards. A complementary, underexplored lever is **strengthening the scripted expert
layer with principled decision theory** while keeping doctrine fidelity: most existing
doctrine-based agents (Erasmus for EOTS; battle-scheme agents of Sun et al. 2024) select actions
by lexicographic heuristics with hardcoded magic numbers, wasting force on hopeless attacks and
never committing ground troops when doctrine charts are ambiguous.

We study the question: **how much of the gap between a doctrine-scripted agent and competent play
can be closed by replacing its heuristic task-force composition and target selection with an
expected-battle-math decision layer, without touching game semantics or doctrine structure?**

Contributions:
1. A exact-table expected-outcome model of EOTS ground and air-naval combat (aligned with the
   engine's hit tables, damage attribution, amphibious modifiers), used inside a live agent.
2. A doctrine-constrained optimization layer (marginal-utility task-force composition,
   value × reachability target scoring, expected-loss amphibious gating, ground-capable HQ
   selection) behind a parameter registry that defaults to bit-identical baseline behaviour —
   enabling clean ablations.
3. A reproducible self-play evaluation harness (deterministic seeding, per-side bot assignment,
   control-diff metric extraction) and a statistically validated study on two official scenarios
   (1942–1945, 1943–1945), 32+ seeds per configuration.
4. Empirical results: [待回填 — 正式实验数字与显著性].

## 2 Related Work

- **Wargame RL**: Kömürcü et al. 2022 (core-skill subgames), Palma et al. 2025 (AlphaZero-style on
  5×5 hex-and-counter; degrades at 12×12), PK-DQN (Sun et al. 2020), battle-scheme agent (Sun et
  al. 2024), entropy-weight + PPO (Xue et al. 2024). All learn policies; none studies improving
  the scripted expert itself as a baseline-quality problem.
- **Scripted + learned hybrids**: Black & Darken 2025 (RL manager + scripted workers). Our work is
  the dual: keep the doctrine manager, replace worker-level heuristics with expected-value math.
- **Expert systems in commercial wargames**: Erasmus (Empire of the Sun 4th/5th printing PvE expert)
  — to our knowledge undocumented in the literature; we formalize its decision layer.
- Difference table (per Research Plan §46) to be completed with原文核实.

## 3 Environment: Empire of the Sun on Rally-the-Troops

- Full rules implementation (`rules.js` engine, frozen at commit 4062aba for all experiments).
- Two scenarios: 1942–1945 (Shortened Campaign, 12 turns) and 1943–1945 (Even Shorter).
- Victory: Japan wins by treaty when US Political Will (PW) ≤ 0 at end of any turn; Allies win by
  atomic-bomb route (strategic-bombing campaign at level 9 continuously from T9 + Soviet entry +
  Japan resources ≤ 5/3), blockade (3 consecutive turns without resource trace), or VP scoring at
  T12 (Allied decisive ≤2, tactical ≤5; Japanese tactical ≤9, else decisive).
- Combat: ground battles — each side rolls d10 + modifiers on a step table; hits =
  ⌈CF × table⌉; **the side damaging more units wins the hex**; amphibious assaults give defender
  +3 and require naval escort (else assault fails). Air-naval battles are decided by committed
  power comparison plus air-cover, then dice for damage.
- RNG: single engine LCG seeded per game; AI decisions are RNG-neutral (Erasmus uses its own hash;
  rules_query snapshots restore G.seed).

## 4 Method: Doctrine-Constrained Expected-Battle-Math Layer

### 4.1 Parameter registry (default-off)

All optimizations sit behind `erasmus_config.js` flags (target_scoring, taskforce_math,
allies_cv_preserve, allies_pow_quota, allies_resource_raid, japan_resource_defense) and numeric
parameters (emWWin, emWLoss, emWCost, emMinPWin, decay factors). The shipped agent
(`erasmus-v2`) runs with all flags off and is **bit-identical** to the audited baseline
(verified: identical per-game action counts, winners, and metric vectors over shared seeds).

### 4.2 Expected combat model (`erasmus_math.js`)

Ground: P(win) over the 10×10 roll space with exact table values and modifiers (terrain −1/−2/−3,
air/naval support +2 each, amphibious defender +3, armor brigade +1, island doctrine +1);
damaged-unit counts estimated by loss-factor fill (aligned with `fill_hit_able_units`).
Air-naval: deterministic power + air-cover rule. Amphibious assessment: escort requirement,
naval-win gate, and joint P(win) = P(naval) × P(ground | naval) against a minimum threshold
`emMinPWin` — gating off hopeless assaults that historically produced failed landings
(US_CASUALTIES → PW −1) or empty offensives.

### 4.3 Marginal-utility task force

Baseline composes by class-rank lexicographic greed. The opt layer scores each candidate unit by
ΔP(win) × targetValue × emWWin − exposure × lossValue(u) × emWLoss − emWCost, where exposure is
the model's expected own-hit share and lossValue upweights non-replaceable and carrier units.
This converts the limited activation budget (ops + HQ.cm) into purchases with the highest
expected contribution — e.g., the first naval escort for a landing (flips +2 roll modifier and
escort legality) outranks a redundant fifth air unit.

### 4.4 Target scoring within doctrine

The doctrine chain remains the candidate set (fidelity constraint); pending capture-type targets
are re-ordered by doctrine-decay × tactical value (named/city/resource/PoW-quota weights) ×
distance decay. Doctrinal order still dominates ties — the agent may not leave the doctrine, only
sequence it intelligently.

### 4.5 Ground-capable HQ selection and the amphibious-legality gap

For any focus that is an uncontrolled port/island (config-gated), HQ choice prefers HQs that can
command amphibious-capable ground. Fixing this alone, however, was **not sufficient**: we
discovered a structural defect in the agent's legality-filter stage. The filter delegated to
unit-granularity legality queries (`queryCombatParticipation` → per-unit ground/naval BFS), but
the engine implements amphibious transport *only as a composite move of a co-located
naval–ground group* (AMPH_MOVE paths do not exist for individual units). Unit-level BFS therefore
returns *illegal* for every ground candidate on an overseas objective and for every naval
candidate on an enemy-held port — silently reducing the Allied task-force pool to 1–2 air units
(measured: 47 activation windows per game contained ground candidates; all were discarded; the
baseline Allies activated **zero** ground units per game). The fix, under the taskforce flag,
exempts amphibious-capable ground and escort naval units from unit-level BFS when the target is
an enemy-controlled port/island and a co-located group can be formed — restoring composite-move
semantics at the planner level while leaving engine semantics untouched.

This is, to our knowledge, a clean instance of a general phenomenon for rule-constrained agents:
**legality oracles that are correct at the rule-primitive granularity can be structurally
incomplete at the action-composite granularity that doctrine actually requires**, and the failure
is invisible unless one audits activation-level candidate sets.

### 4.6 Side-specific value weights and the atomic-bomb path

Allies: PoW-quota named hexes, resource raids (atomic/blocked-VP conditions; Japanese resource
hexes are appended to the doctrine chain as conquest targets when the raid flag is on), CV
preservation, and protection of the Soviet-invasion card (a necessary atomic-bomb condition) from
being spent as an operations card. Japan: resource-hex defense weighting. All behind flags for
ablation.

## 5 Experimental Design

- Harness `tests/match-run.js`: per-side bot assignment, deterministic seeds, metrics by
  control-diff (hex captures via supply-cache control bits; eliminations/reductions via
  location/reduced-set diffing; battles via engine battle-marker log parsing).
- Matchups: (i) baseline vs baseline, (ii) Japan-opt vs baseline, (iii) baseline vs Allies-opt,
  (iv) opt vs opt — 32 seeds each, both scenarios.
- Statistics: bootstrap 95% CI for mean differences, two-sided Mann-Whitney U, Cliff's delta;
  Holm correction across the primary metric family.
- Ablations: each flag removed from the full profile in turn (8 seeds quick pass, flags with
  significant contribution re-run at 32).
- Metrics: hex captures per side, ground attacks won, naval battles won, eliminations and cf-weighted
  losses, PW trajectory, surrender-chain completion, Japan resources (atomic threshold),
  final winner distribution.

## 6 Results

All runs: 32 games per configuration, seeds 20260903–20260934, deterministic replay, zero errors
in the final build. "final" profile = taskforce_math + cv_preserve + pow_quota + resource_raid +
resource_defense (target_scoring excluded by ablation, §6.3). Full per-run tables in
`tests/results/exp-summary.{md,csv}`; raw JSON per game.

### 6.1 Main matrix (per-game means, 32 games)

**1942–1945**

| 配置 | 胜负(J-A) | AP 夺格 | JP 夺格 | 地面胜 J / A | 海空胜 J / A | 歼灭 J / A | PW |
|---|---|---|---|---|---|---|---|
| base | 32-0 | 0.09 | 4.38 | 1.81 / 0 | 0 / 0 | 13.1 / 12.7 | 1.09 |
| J-opt | 32-0 | 0.16 | **10.34** | 6.75 / 0.06 | — | 16.3 / 17.5 | 0.81 |
| A-opt | 32-0 | 7.16 | 4.44 | 1.97 / 2.59 | — | 14.0 / 18.3 | 0.56 |
| both(all) | **31-1** | 6.31 | 7.41 | 3.94 / 2.47 | — | 20.2 / 19.9 | 0.84 |
| both-final | 32-0 | 6.59 | **8.47** | 5.06 / 2.66 | 5.41 / 5.34 | 17.5 / 20.0 | **0.31** |

**1943–1945**: AP captures 1.09→7.00 (final vs base), Allied ground wins 0.28→1.66,
Japanese air-naval wins 0.03→3.28; surrender chains complete in 32/32 (vs 30–32 base).

Highlights against the stated goals:
- **成功夺格数**: Allies ×70 (0.09→6.59, 1942), ×6.4 (1943); Japan ×1.94 (4.38→8.47, 1942).
- **成功作战数**: Allies ground wins 0→2.66/game (1942); Japan 1.81→5.06/game.
- **给对方造成损失数**: Japan inflicts 12.7→20.0 eliminations/game on Allies (+58%); Allies
  13.1→17.5 (+34%). CF-weighted losses scale similarly (+64%/+80%).
- **消减美国政治意志 (Japan)**: final PW at game end 0.31 vs 1.09 (faster, earlier treaty:
  mean end turn 10.06 vs 11.16, both significant).
- **盟军胜利次数**: 1/32 in both(all) 1942 — the first Allied win observed in this codebase's
  self-play (atomic-bomb route, see §6.4).

### 6.2 Statistical significance (bootstrap 95% CI + two-sided Mann–Whitney U + Cliff's δ)

Final vs base, 1942 (n=32 vs 32): every primary metric significant at α=0.05 —
AP captures Δ+6.50 [5.31, 7.56], p=7.1e-12, δ=0.99; JP captures Δ+4.09 [3.09, 4.94], p=7.2e-9;
Allied ground wins Δ+2.66, p=7.6e-11; Japanese ground wins Δ+3.25, p=2.5e-10; PW Δ−0.78, p=0.005.
1943: AP captures p=1.0e-8, Allied ground wins p=2.6e-7, Japanese naval wins p=4.2e-11.

### 6.3 Ablation (both-opt 1942, one flag removed at a time, 32 games)

| removed flag | AP 夺格 | JP 夺格 | 地面胜 J/A | PW |
|---|---|---|---|---|
| none (all) | 202 | 237 | 126/79 | 0.84 |
| **taskforce_math** | **10** | **141** | **60/0** | 0.97 |
| target_scoring | 211 | **271** | 162/85 | 0.31 |
| allies_resource_raid | 223 | 265 | 159/78 | 0.47 |
| allies_cv_preserve | 197 | 246 | 133/79 | 0.50 |
| allies_pow_quota | 189 | 237 | 129/73 | 0.56 |
| japan_resource_defense | 195 | 247 | 134/79 | 0.78 |

Removing taskforce_math collapses the system (Allied captures −95%, ground wins 79→0; all four
primary metrics p∈[6e-7, 2e-11], δ=0.71–0.94). The expected-battle-math execution layer is the
dominant factor; strategic target-weight flags contribute smaller, mostly additive effects.
Notably, **naive target reordering (target_scoring) interferes**: removing it *improves* Japanese
captures (237→271) and PW drain (0.84→0.31). Doctrinal sequential focus plus execution-level
math outperforms value-based target reshuffling — evidence that in doctrine-constrained agents
the execution layer, not the strategy layer, was the binding constraint.

### 6.4 Why Allied wins remain rare: the atomic-bomb bottleneck

In both long scenarios the only Allied victory function is the atomic-bomb route
(`victory_1945`): strategic-bombing campaign at level 9 from T9, Soviet-invasion card in hand at
TOJO-resignation activation, and Japan resources ≤5 (≤3 after Soviet entry). The optimization
layer made all agent-controllable preconditions reachable (raid-driven resource pressure reached
the ≤5 threshold in several games; Soviet card protected; TOJO lottery event played from T8), but
TOJO activation is a ~25% card event outside either agent's control in 8 sampled seeds and never
co-occurred with Soviet-card tenure in 48 games. Allied wins are therefore **card-luck-gated by
design of the scenario, not by agent capability**; execution metrics (captures, battles, losses)
are the meaningful comparison axis, and VP-based Allied victories exist only in the 1-year/2-year
scenarios (future work). A promising agent-side lever — carrier raids on the Japanese home area
to force the Japanese discard that activates TOJO — is identified but not implemented here.

### 6.5 Complexity characterization (E1)

Measured effective complexity (8 games/scenario): median branching 4 expanded actions per
decision, p95 40, max 284; 903–1673 AI decisions per game; 53–79 units on board; full campaign =
12 turns with multi-hour human play per side.

## 7 Discussion

**Execution, not strategy, was the binding constraint.** The largest gains came from repairing
*how* doctrine is executed (compositing amphibious groups, marginal-utility force purchases,
composite-move legality) rather than *what* targets are chased. A doctrine chain that took the
1942 Allies from 0.09 captures/game to 7.00/game needed no new strategic ideas — only correct
mechanics and expected-value force allocation.

**Interference between optimization layers.** Value-based target reordering actively hurt a
strong execution layer (§6.3). We hypothesize doctrine sequencing already encodes most of the
value signal; re-ranking it with a noisy static value model injects variance into force
staging (units disperse toward reordered targets), degrading the composite task-force buildups.
This echoes curriculum-ordering results in RL (R15) at the scripted-agent level.

**Composite-move legality.** The unit-granularity legality-oracle incompleteness (§4.5) is a
pitfall for any agent built on rule-engine query APIs: query granularity must match the action
composition the agent is allowed to plan.

**Card-luck gating of victory.** When scenario victory conditions include a random event chain
(TOJO × Soviet card × resource thresholds), even a dominant execution layer cannot convert into
wins reliably; evaluation of wargame agents on such systems should therefore report the full
execution-metric family rather than win rate alone (cf. plan §35 behavior metrics).

## 8 Limitations & Threats to Validity

- Approximate (though exact-table) combat model inside a stochastic engine; the engine itself is
  the ground truth and the model is only used for ranking.
- Two scenarios, one game system; external validity beyond EOTS untested.
- Doctrine fidelity constrains target choice — the layer optimizes execution, not grand strategy
  (though sequencing within the chain is learned-free optimization).

## 9 Reproducibility

All code in-repo; every experiment JSON in `tests/results/` records bot versions, seeds, scenario,
flags (via bot version suffix), and elapsed time. Baseline bit-identity check is part of the test
flow (`node tests/erasmus.test.js` + shared-seed comparison).
