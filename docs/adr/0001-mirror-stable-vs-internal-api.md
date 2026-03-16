# ADR 0001: Mirror Stable vs Internal API Surface

- Status: Accepted
- Date: 2026-03-11
- Decision makers: Page Agent maintainers

## Context

The mirror package grew quickly from interface sketches into an operational
runtime. As it matured, a single flat export surface mixed:

- consumer-facing orchestration APIs (`createMirrorController`, `MirrorConfig`)
- transport-level internals (CDP/QUIC/Tauri and layer plumbing types)

This made it harder to reason about integration contracts and increased risk of
accidental coupling to implementation details.

## Decision

Split mirror exports into two explicit modules:

1. `stable.ts`
   - consumer integration APIs and core runtime contracts
2. `internal.ts`
   - advanced transport/layer payloads and implementation-centric types

And make `index.ts` expose:

- stable exports by default,
- backward-compatible full exports,
- explicit namespaces:
  - `stable`
  - `internal`

## Consequences

### Positive

- Clearer boundary for application integrators.
- Reduced accidental dependency on volatile internals.
- Better long-term evolution of mirror runtime without breaking top-level consumers.

### Trade-offs

- Additional documentation overhead to keep stable/internal boundaries clear.
- Existing advanced consumers must intentionally import internal symbols.

## Follow-up

- Keep stable surface semver-disciplined and minimal.
- Treat internal surface as advanced and less compatibility-guaranteed.
