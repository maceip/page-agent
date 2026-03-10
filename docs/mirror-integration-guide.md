# Mirror Module Integration Guide

After merging the `IPageController` interface changes on main, the mirror branch
(`claude/add-page-agent-mirror-7Y9Yu`) needs the following adjustments.

## 1. RemotePageController must implement IPageController

```diff
- import type { IHotLayer, RemoteInputEvent } from './layers/hot'
+ import type { ActionResult, BrowserState, IPageController } from '@page-agent/page-controller'
+ import type { IHotLayer, RemoteInputEvent } from './layers/hot'

- // local re-declarations of BrowserState and ActionResult
- interface BrowserState { ... }
- interface ActionResult { ... }

- export class RemotePageController extends EventTarget {
+ export class RemotePageController extends EventTarget implements IPageController {
```

Delete the locally-declared `BrowserState` and `ActionResult` interfaces from
`packages/mirror/src/RemotePageController.ts`. Import them from
`@page-agent/page-controller` instead. This eliminates the duplicate type
definitions that will inevitably drift.

## 2. Add missing IPageController methods

Mirror's `RemotePageController` is missing `getCurrentUrl()` (public) — it has it
as a private implementation detail reading from `this.snapshot?.url`. Make it public:

```ts
async getCurrentUrl(): Promise<string> {
    return this.snapshot?.url ?? ''
}
```

## 3. updateTree() return type

The interface requires `updateTree(): Promise<string>`. Mirror's version already
returns `Promise<string>` — no change needed.

## 4. Fix RemoteInputEvent construction — eliminate `as RemoteInputEvent` casts

Instead of:
```ts
await this.hotLayer.sendInputEvent({
    type: 'focus',
    elementId: index,
    timestamp: this.now(),
} as RemoteInputEvent)
```

Create properly narrowed objects that TypeScript can verify:
```ts
const focusEvent: RemoteFocusEvent = {
    type: 'focus',
    elementId: index,
    timestamp: this.now(),
}
await this.hotLayer.sendInputEvent(focusEvent)
```

Or add factory helpers in the hot layer types:
```ts
export function createInputEvent<T extends RemoteInputEvent['type']>(
    type: T,
    payload: Omit<Extract<RemoteInputEvent, { type: T }>, 'type'>
): Extract<RemoteInputEvent, { type: T }> {
    return { type, ...payload } as Extract<RemoteInputEvent, { type: T }>
}
```

## 5. MirrorSession integration — no more `as any`

Before:
```ts
const core = new PageAgentCore({
    pageController: session.controller as any,
    ...agentConfig,
})
```

After (once RemotePageController implements IPageController):
```ts
const core = new PageAgentCore({
    pageController: session.controller,
    ...agentConfig,
})
```

## 6. getPageInstructions is now async

The `getPageInstructions` callback signature changed from:
```ts
(url: string) => string | undefined | null
```
to:
```ts
(url: string) => string | Promise<string | undefined | null> | undefined | null
```

Any mirror-specific page instructions can now be async (e.g., fetching context
from the warm layer's credential state or the hot layer's remote browser state).

## 7. Architecture: Two browsers, one interface

The grand design is two browsers running in tandem — local and remote — each
with their own `IPageController`. The mirror layer synchronizes state between
them. When building mirror features:

- The **local** browser uses `PageController` (the concrete class, content script)
- The **remote** browser uses `RemotePageController` (mirror's adapter over IHotLayer)
- `PageAgentCore` talks to whichever one it's given via `IPageController`
- `IMirrorController` orchestrates the relationship between the two

This means the remote cloud browser should eventually have the same content-script
infrastructure as the local one — a real `PageController` running in its DOM,
with the hot layer streaming its spatial maps back. The mirror's
`RemotePageController` is the local-side proxy for that remote `PageController`.
