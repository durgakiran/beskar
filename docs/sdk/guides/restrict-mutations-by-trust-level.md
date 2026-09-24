# Guide: Restrict who can make which mutations

**Use case:** you're combining writes from more than one trust level against the same editor — a local user, a remote collaboration peer, an AI agent, a server-driven import — and some of those sources shouldn't be able to do everything the local user can (e.g. a remote peer shouldn't be able to wipe the whole document; an AI agent shouldn't delete shapes without confirmation).

**Reference:** [glideline: Mutation policy](../glideline/content-ingress-mutation-and-ai.md#mutation-policy).

By default (`allowAllMutations`), every write is allowed regardless of source — correct for a single-user, single-trust-level app, and you can stop reading here if that's your situation.

## The model

A `MutationPolicy` is one function: given a `MutationRequest { origin, command, affectedIds }`, return `'allow'` or `'deny'`. `origin` is one of `'local-user' | 'local-api' | 'remote' | 'load' | 'system'` — a caller *claims* an origin, but claiming isn't enough to act with elevated trust: acting as anything other than the default requires holding a `MutationCapability`, an opaque, unforgeable token from `createMutationCapability()` (branded with a private symbol — you cannot construct one by matching its shape, only by calling this function).

```ts
const remoteCapability = createMutationCapability();

const editor = createEditor({
  plugins: [...],
  mutationPolicy: {
    authorize: (req) => {
      if (req.origin === 'remote' && req.command === 'store.replaceDocument') return 'deny';
      return 'allow';
    },
  },
  trustedMutationCapabilities: [
    { capability: remoteCapability, origins: ['remote'] },
  ],
});
```

Whoever holds `remoteCapability` (e.g. your collaboration binding code) can now make writes tagged `origin: 'remote'`; nothing else in your codebase can forge that origin without the same capability object. A denied request throws `MutationPermissionError` (`code: 'MUTATION_PERMISSION_DENIED'`) at the call site.

## Worked example: AI agent can create/update but not delete

```ts
const aiCapability = createMutationCapability();

const policy: MutationPolicy = {
  authorize: (req) => {
    if (req.origin !== 'local-api') return 'allow';   // only constrain the AI-origin path
    if (req.command === 'editor.deleteShapes') return 'deny';
    return 'allow';
  },
};

const editor = createEditor({
  plugins: [...],
  mutationPolicy: policy,
  trustedMutationCapabilities: [{ capability: aiCapability, origins: ['local-api'] }],
});
```

Combine with [the AI/MCP guide](./ai-agent-canvas-editing.md) — a denied `delete_shapes` tool call surfaces to the model as a structured `{ error, code: 'MUTATION_PERMISSION_DENIED' }` result it can react to (e.g. ask the user to confirm instead), not a thrown exception that ends the interaction.

## How `glideboard`'s collaboration uses this

`glideboard`'s collaboration binding is itself built on exactly this mechanism: it holds a capability scoped to `origins: ['remote']` and uses it for every write it replays from the shared `Y.Doc` into the local `GlideStore`. This is what stops a compromised or buggy remote payload from ever producing a `'local-user'`-origin write in your store, even though the *data* it's writing came over the network — the origin tag (and therefore what a policy can gate on) is determined by who's making the call, not by what the payload claims about itself. If you're building your own collaboration transport rather than using `glideboard`'s, replicate this pattern: mint one capability per trust boundary, hand it only to the code that legitimately writes on behalf of that boundary, and write your policy in terms of `origin` + `command`, never in terms of payload content (payload content can't be trusted to self-report its own trust level).

## Choosing what to gate on

`command` is a string identifier for the specific mutation (`store.put`, `editor.deleteShapes`, etc. — see the `commandId`s used internally, e.g. `'store.put'`/`'store.remove'`/`'store.batch'` from `GlideStore`, or whatever `commandId` your own `editor.batch(label, fn, { commandId })` calls specify). `affectedIds` lets a policy be record-scoped rather than command-scoped (e.g. "remote peers can edit shapes but not pages"). Keep the policy function itself cheap and synchronous — it runs on every transaction.
