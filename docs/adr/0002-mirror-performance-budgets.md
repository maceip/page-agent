# ADR 0002: Mirror Performance Budgets as Tests

- Status: Accepted
- Date: 2026-03-11
- Decision makers: Page Agent maintainers

## Context

Mirror architecture depends on low-latency interaction quality. Prior to this
ADR, performance goals were implicit and not enforced by tests. Regressions in
diff materialization or input dispatch could slip into mainline changes.

## Decision

Adopt explicit mirror performance budgets and enforce them in automated tests.

Budgets:

- p95 micro-DOM diff materialization latency < 8ms
- p95 input dispatch latency < 6ms

Enforcement:

- `tests/perf/mirror-latency.test.ts`
- `npm run test:perf:mirror`

## Consequences

### Positive

- Performance regressions become visible in CI/local checks.
- Teams can iterate on mirror internals with measurable guardrails.
- Supports product requirement that mirror must stay fast under load.

### Trade-offs

- Benchmarks are environment-sensitive; thresholds should remain pragmatic.
- Additional maintenance cost for perf harness as runtime evolves.

## Follow-up

- Expand budgets over time (e.g., frame pipeline and navigation interception).
- Keep perf tests deterministic and avoid external-network dependencies.
