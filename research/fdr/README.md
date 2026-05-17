# FDR — Forward Deployed Research

Scope: feasibility study for the trajectory-predictive matching system described in
`trajectory_predictive_matching_paper.docx` against the data and infrastructure
that actually exist in BCHowdy today.

## Why this directory exists

The branch `FDR` was opened to "make the model" from the paper. Per
[`ML_AGENTS.md`](../../ML_AGENTS.md) §4, no model code is written before the
framing in this directory is complete and acknowledged by the project owner.

## Files

| File | What it answers | ML_AGENTS.md ref |
|---|---|---|
| `PROBLEM.md` | What are we predicting, from what, when, why, and with what success criteria | §3, §4, §8.5, §10.1 |
| `DATA.md` | What data exists today, what the paper requires, the gap, and the data-acquisition plan | §5 (whole section) |
| `FALSIFICATION.md` | Conditions under which the entire FDR program is killed, not patched | §1.10, §12 (paper), §12.5 (paper) |
| `DECISIONS.md` | Every non-trivial choice in this session, dated and justified | §1.9, §23.3 |

## Status (2026-05-11)

- Branch created.
- Framing docs in progress (this commit).
- No model code written. None should be until `PROBLEM.md` items 1–12 are
  resolved and `DATA.md` confirms data adequacy (or documents the acquisition
  step that resolves inadequacy).
</content>
