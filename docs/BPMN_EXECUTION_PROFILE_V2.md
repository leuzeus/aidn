# BPMN execution profile v2

## Default agentic execution path and compatibility

`aidn-bpmn-structured.v2` adds XML mappings for the existing `event`, `loop`,
`multi_instance` and `call` IR nodes. It is the default compiler, targeting
the structured agentic process engine for normal BPMN workflows. Select
[`aidn-bpmn-structured.v1`](BPMN_EXECUTION_PROFILE.md) explicitly for compatibility.

```js
const compiled = compileBpmnProcess({
  xml, processRef: "ExtendedDelivery",
  modelId: "delivery", revision: 1, participantId: "delivery", roles, policies,
});
```

The API is still `src/application/workflow/bpmn-process-service.mjs`. When the
document contains multiple processes, `processRef` must select the entry by its
exact XML ID. In a single-process document it can be omitted. It is unavailable
in v1. Unknown profiles and invalid selectors refuse.

The closed `bpmn-process-compilation.v1` envelope accepts either profile; its
shape is unchanged. Both produce `agentic-process-model.v1` and use the same
reducer, simulation, policy pins and trusted execution authorities. V1's original
model hash and source map are pinned by a compatibility fixture. Existing
instances are not reinterpreted. Selecting the normal agentic engine does not
authorize writes or native calls; execution still requires pinned inputs and
explicit host authorization. Historical sequential workflow records retain
their versioned reader rather than being silently converted into agentic models.

## Mapping to the existing engine

| XML construct | IR construct | Supported semantics |
| --- | --- | --- |
| Exclusive eventBasedGateway → message catches → exclusive merge | `event` | One correlated message wins; alternatives are disabled |
| Post-test standardLoopCharacteristics | `loop` | Body first, explicit stop fact and failing iteration guard |
| multiInstanceLoopCharacteristics | `multi_instance` | Constant item identities, sequential or logical parallel ordering; all items complete |
| callActivity with local calledElement | `call` | Scoped procedure in the same participant, expanded into distinct IR subtrees |

`src/core/workflow/bpmn-process-compiler-v2.mjs` validates the original XML
declarations, lowers the new graph constructs to the v1 structure checker, then
replaces validated placeholders with these existing IR nodes.
`src/core/workflow/bpmn-activity-profile.mjs` owns the closed task/call/repetition
metadata mapping. The reducer itself is unchanged.

## Correlated message races

Declare message IDs in `definitions`. IDs used as event keys must satisfy the
existing AIDN identifier grammar: lowercase initial letter, then lowercase
letters, digits, underscores or hyphens, at most 64 characters.

```xml
<bpmn:message id="approved"/>
<bpmn:message id="reconsider"/>
<!-- inside the selected process -->
<bpmn:eventBasedGateway id="AwaitDecision"
  instantiate="false" eventGatewayType="Exclusive"/>
<bpmn:intermediateCatchEvent id="CatchApproved">
  <bpmn:messageEventDefinition messageRef="approved"/>
</bpmn:intermediateCatchEvent>
```

Every outgoing branch must reach a distinct message catch immediately. Each
catch has one incoming flow, one outgoing flow and one message definition.
Its `messageRef` must resolve to a declaration in the same document. Keys are
unique within each race. The paths after the catches must form a structured
block converging at an exclusive merge. Empty branch bodies refuse.

At runtime the gateway occurrence waits without allocating an executor. The
trusted host delivers the existing `message` event with exact occurrence,
`correlation_id` and `event_key`. One winner remains after replay; late losing
signals and foreign correlations refuse. Catches and the merge map to the event
IR node in `source_map`; catches create no extra activity occurrence.

This is not a message broker or executable collaboration between participants.
Standalone catches, signal broadcasts, timers, boundary events, instantiating
gateways and parallel event gateways remain unsupported. No timer scheduling
or subscription side effect follows from XML compilation.

## Bounded post-test loops

BPMN repeats while its condition is true; the existing IR stops when `until`
is true. V2 accepts only `not(stop_fact)` in the closed AIDN expression language
and compiles it directly to `until: stop_fact`, without generating or maintaining
an inverse fact. For example:

```xml
<bpmn:task id="Refine">
  <bpmn:extensionElements>
    <aidn:execution roleRef="implementation" policyRef="work"/>
    <aidn:iterationLimit maxIterations="2" onLimit="fail"/>
  </bpmn:extensionElements>
  <bpmn:standardLoopCharacteristics testBefore="false">
    <bpmn:loopCondition language="urn:aidn:bpmn:execution:v1">not(refinement_done)</bpmn:loopCondition>
  </bpmn:standardLoopCharacteristics>
</bpmn:task>
```

`testBefore` must be absent or `false`. The body always executes once, even if
the stop fact is already true. A missing fact waits after the body. False
repeats; true finishes. Each iteration has a distinct occurrence path.

The mandatory AIDN guard bounds execution to 1–32 iterations. `onLimit="fail"`
states the existing `PROCESS_LOOP_LIMIT` failure explicitly. Standard BPMN
`loopMaximum` is refused because reaching that cap normally exits the loop;
the current IR treats its guard as a failure. Pre-test loops, arbitrary Boolean
expressions and implicit limits are also refused. The extension adds an explicit
execution constraint without changing the meaning of `loopMaximum`.

## Fixed multi-instance collections

```xml
<bpmn:callActivity id="Batch" calledElement="Procedure">
  <bpmn:extensionElements><aidn:collection items="first second"/></bpmn:extensionElements>
  <bpmn:multiInstanceLoopCharacteristics isSequential="false">
    <bpmn:loopCardinality>2</bpmn:loopCardinality>
  </bpmn:multiInstanceLoopCharacteristics>
</bpmn:callActivity>
```

`loopCardinality` is a canonical integer literal from 0 to 32. The explicit
collection contains exactly that many unique AIDN item IDs. Empty `items=""`
with cardinality zero completes immediately. `isSequential` may be `true`,
`false` or absent; absence means logical parallel ordering. All created
occurrences must complete. Failure cancels the remaining control occurrences.

The collection fixes occurrence identity, not payload values, data mappings,
worker count or executor capacity. Sequential and parallel items may reuse an
eligible execution under the existing policy. Dynamic collections/cardinality,
completionCondition, input/output mappings and early completion are unsupported.

## Local procedure calls

`calledElement` must be an unqualified ID of another executable process declared
in the same `definitions`. V2 accepts no external URI, imported document,
GlobalTask or module path. All declared processes must be reachable from the
selected entry. Process IDs and all other authored IDs are globally unique.

Each call gets its own IR subtree, including when several calls reference the
same procedure. Nested calls and repetition on a call are supported. They share
the participant, declared roles/policies and explicit routing facts of the
current instance. There is no new agent identity, independent review guarantee,
variable scope, transactional scope or native process implied by a call.
Input/output and autonomous participant contracts remain outside this profile.

Both task and call activities can have one loop or one multi-instance
characteristic. Combining both on the same activity refuses. Call activities
inherit their child activities' execution policies and cannot declare an
`aidn:execution` binding of their own.

Recursive calls refuse. Call depth is bounded at 16; the fully expanded IR must
also fit the existing 128-node, depth, fan-out and 256-character occurrence-path
limits. Expansion stops before adding more than 128 nodes. Source limits cover
all declared processes together: 128 flow nodes and 384 flow nodes/sequence
flows combined, plus the existing XML byte/element/depth limits. At most 32
process definitions are accepted. The original source-map envelope remains
bounded at 256 entries. Reused definitions can map to several distinct IR nodes.

## Verification and remaining qualification

The tracked example `tests/fixtures/agentic-process/extended-delivery.bpmn`
combines the four constructs, nested/repeated procedures and independent review.
`npm run perf:verify-agentic-process` includes positive and negative compiler
fixtures, both event winners, stale/foreign events, loop continuation/wait/limit,
empty/sequential/parallel collections, call expansion and recursion guards.

Canonical service fixtures run the complete XML-derived workflow in `files`,
`dual` and `db-only` with trusted authority doubles and real temporary stores.
Their retained journal produces exactly the same final cursor and instance hash
through simulation. Native host/identity, live PostgreSQL, graphical editor
import and installed-package qualification remain separate and are NOT_RUN.
The semantic XML fixture contains no diagram coordinates.

See [ADR-0023](ADR/ADR-0023-bpmn-execution-profile-and-simulation.md).
The polarity, testBefore, loopMaximum, multi-instance and call distinctions are
grounded in the [OMG BPMN 2.0.2 specification](https://www.omg.org/spec/BPMN/2.0.2).
