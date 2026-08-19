# Engineering Diagram Shape Catalog

**Package**: `packages/glideline` + `packages/glideboard`
**Purpose**: Research document — what shapes are needed for which engineering diagram types,
and in what priority order should they be built.

---

## Coverage Map by Diagram Type

| Diagram Type | Standard | Already in glideline | Gap |
| :--- | :--- | :--- | :--- |
| Flowchart / Process | ISO 5807 | box, ellipse, diamond | ~8 shapes missing |
| UML | UML 2.5 | box, ellipse | ~5 shapes missing |
| ER / Database | Chen / Crow's Foot | box, diamond, ellipse | ~4 shapes missing |
| Architecture / C4 | C4 Model, AWS | box, ellipse | ~3 shapes missing |
| Network / Infra | ANSI/IEEE | — | ~5 shapes missing (icon-based) |
| BPMN 2.0 | OMG | ellipse, diamond | ~4 shapes missing |
| Circuit | IEC/IEEE | — | complex — likely icon-based |

---

## P1 — Flowchart (most universal, covers ~70% of use cases)

These appear in nearly every engineering workflow. Industry standard: **ISO 5807**.

| Shape | Use | Geometry | Already? |
| :--- | :--- | :--- | :--- |
| **Rounded Rectangle** | Generic process step, BPMN task, UML state | `rect` with `rx` | ❌ |
| **Parallelogram** | Manual input / output | polygon (skew) | ❌ |
| **Document** | Paper output, report | path (wavy bottom) | ❌ |
| **Cylinder / Drum** | Database, data store | path (ellipse cap) | ❌ |
| **Chevron / Arrow** | Process direction, conveyor | polygon | ❌ |
| **Note / Folded Corner** | UML annotation — appears in every UML diagram | path (dog-ear) | ❌ |
| **Callout / Speech Bubble** | Annotation with pointer tail | path (rect + tail) | ❌ |
| **Off-page Connector** | Jump to another page | pentagon (pointed right) | ❌ |
| **Delay / D-shape** | Wait state, buffer | path (flat left, arc right) | ❌ |
| **Manual Operation** | Human step | trapezoid (inverted) | ❌ |
| **Pre-defined Process** | Subroutine call | rect + vertical side lines | ❌ |
| **Decision merge** | And-join in activity | diamond ✅ | ✅ |
| **Terminal (start/end)** | — | ellipse ✅ | ✅ |
| **Process** | — | box ✅ | ✅ |

> **Note**: Rounded rectangle alone covers BPMN task, UML action, and C4 container — the single highest ROI shape to add.

---

## P2 — UML (class, sequence, use case, component, state)

| Shape | Diagram | Geometry | Already? |
| :--- | :--- | :--- | :--- |
| **Actor (stick figure)** | Use Case | composite (circle + lines) | ❌ |
| **Package / Namespace** | Class, Component | rect + small tab top-left | ❌ |
| **Component** | Component diagram | rect + 2 small notches on left side | ❌ |
| **Interface (lollipop)** | Class, Component | circle on a line (connector variant) | ❌ |
| **Fragment** | Sequence | rect + small label box top-left | ❌ |
| **Delay** | Flowchart wait/buffer | path (flat left, arc right) | ❌ |
| **Manual Operation** | Flowchart human step | trapezoid (inverted) | ❌ |

> **Note**: Lifelines and sequence frames are better handled as a separate "Sequence Diagram" mode rather than individual shapes — they require fixed vertical layout logic.

---

## P3 — ER / Database Diagrams

| Shape | Use | Geometry | Already? |
| :--- | :--- | :--- | :--- |
| **Weak Entity** | Chen notation | rect with inner rect (double border) | ❌ |
| **Weak Attribute** | Chen notation | ellipse with inner ellipse (dashed) | ❌ |
| **Multi-valued Attribute** | Chen notation | ellipse with inner ellipse | ❌ |
| **Derived Attribute** | Chen notation | dashed ellipse | ❌ |
| **Identifying Relationship** | Chen notation | diamond with inner diamond | ❌ |
| **Table / Entity** | Crow's Foot | sectioned rect (header + rows) | complex |

> **Note**: Crow's Foot notation tables are a **composite / structured shape** — more like a frame/container than a simple geo shape. Needs a dedicated `TableUtil` similar to `FrameUtil`.

---

## P3 — Architecture / C4 / AWS

| Shape | Use | Geometry | Already? |
| :--- | :--- | :--- | :--- |
| **Cloud** | Cloud provider boundary | bezier path | ❌ |
| **Person / User** | C4 person | circle + body rectangle | ❌ |
| **Swim Lane** | Process boundary, BPMN pool | rect (header strip on left/top) | complex |
| **Dashed Box** | System boundary | rect with dashed stroke | ✅ via style |

> **Note**: "Dashed Box" doesn't need a new shape — it's a `box` with `strokeStyle: 'dashed'`, which already exists in the style system.

---

## What to defer / handle differently

| Item | Reason to defer |
| :--- | :--- |
| Circuit diagram symbols | Too domain-specific; better as an icon pack |
| Network icons (router, switch, firewall) | Should be icon library, not geometric shapes |
| Crow's Foot table | Needs `TableUtil` — composite/structured shape |
| Sequence lifelines | Need fixed vertical layout logic — separate mode |
| Swim lanes | Need container + label system — similar to `FrameUtil` extension |
| UML lollipop interface | Better modeled as a short arrow connector variant |

---

## Priority Stack Summary

```
P1 (do first — maximal coverage across diagram types)
├── rounded-rect       ← covers BPMN task, UML state, C4 container
├── parallelogram      ← flowchart I/O, data shape
├── document           ← report/doc outputs
├── cylinder           ← database (nearly universal)
├── note               ← UML comments (nearly universal)
├── callout            ← annotation (works everywhere)
└── chevron            ← process flow

P2 (high value for software engineering teams)
├── actor              ← UML use case (needs stick figure path)
├── component          ← UML component diagram
├── package            ← UML namespace
├── delay              ← flowchart wait/buffer
├── manual-operation   ← flowchart human step
├── predefined-process ← flowchart subroutine
└── off-page-connector ← multi-page flowcharts

P3 (specialized)
├── cloud              ← infra/architecture
├── weak-entity        ← ER/Chen diagrams
├── double-diamond     ← ER identifying relationship
├── pentagon           ← flowchart off-page (variant)
├── octagon            ← alternating decision/join
└── cross              ← decision merge point
```

---

## Shape Count Summary

| Tier | Count | Estimated effort |
| :--- | :--- | :--- |
| Already exists in glideline | 6 | — |
| P1 new shapes | 7 | ~2 days |
| P2 new shapes | 7 | ~3 days |
| P3 new shapes | 6 | ~2 days |
| Deferred / different approach | 6 | — |

**Total new shapes for full engineering diagram coverage: 20**
