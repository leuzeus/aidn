# BPMN model projects

A local authoring project contains `manifest.json` (`workflow-project.v1`) and one
`<model_id>.<revision>.bpmn` file per model. The first manifest row is the root.
Subsequent rows are the root's ordered call targets. Each row supplies its identity,
participants, roles, policies, operation definitions and optional data bindings and
call interface. A target row also requires the published model SHA-256. Call sites
carry their own digest and refer to the target process ID. Both must match the compiled
child. Parameter expressions and returns refer to stable IR node IDs within their model.

`compileBpmnProject({ manifest, diagrams })` in `src/application/workflow/bpmn-project-service.mjs`
accepts parsed metadata and a map of file names to XML strings. The result contains
the validated root IR, its hash, and separate source maps for each model and revision.

Each file contains a single executable process with ID `P_<model_id>_<revision>`.
A node `N_<id>` carries its participant and IR array position in the AIDN extension
attributes `participant` and `order`. Subprocesses preserve named structured blocks.
Their start/end events and sequence flows determine child order, including an empty
sequence. A branching subprocess contains a gateway split and join. The outgoing
flows carry branch identity and order. Conditions, defaults and message catches
determine routing. A local call or repetition encloses its child. A pinned call
uses a BPMN call activity. Task extensions bind activities and typed operations
using the structured v2 profile. Changing the layout alone preserves model identity.

## Business roles

A workflow-project.v1 model row can include a role_profile using role-profile.v1.
Then each row of roles supplies the IR role id, profile_role, capability_ref and
skills. For example, a business analyst can reference analyze@1 on the host's
auditor role. The diagram task names the business role id. Each affected activity
policy must require every permission of that business role. The compiled IR
retains the resolved native role, action and effective activity policy.

## Declarative JavaScript authoring

Import `buildWorkflowProject` from `src/application/workflow/workflow-builder.mjs`.
Pass the same property catalog that the local graphical editor uses. The result
contains `manifest` and `diagrams` and is compiled with `compileBpmnProject()`
before it is returned.

```js
const project = buildWorkflowProject({
  id: "delivery",
  steps: [{
    kind: "xor", id: "route", condition: "ready",
    then: [{ kind: "call", id: "review", target: "review_work", body: [] }],
    otherwise: []
  }]
}, catalog);
```

Steps run in array order. An operation takes an `operation_ref` with its revision
and accepts v4 input mappings in `fields`. An activity takes a `role_ref` and
`policy_ref`. An evaluation selects a catalog `evaluator_ref`. A call with a
`body` authors nodes in its local target. A later call to that target can omit
the body. Child edits and bindings go through the editor's validation and local
call pinning. Project creation and compilation operate in memory.

## Export

`exportBpmnProject(model, definitionsByDiagram)` in
`src/core/workflow/bpmn-project-export.mjs` returns the manifest and diagram
strings. Supply each diagram's pinned operation definitions keyed by its file
name. The exporter emits a BPMNDI plane for the process and each subprocess.
The published IR remains the comparison baseline for edited candidates.

Use the source authoring command to create a new directory.

```sh
node tools/author/export-bpmn-project.mjs --model model.json --bindings definitions.json --out my-project
```

## Portable transfer

Export the current saved editor project into a new directory.

```sh
node tools/author/transfer-workflow.mjs --project ./working --out ./delivery
```

Use `--standard --out ./delivery` for the installed STANDARD baseline. Copy
the entire directory to the target machine, then check it offline with the
corresponding AIDN compiler.

```sh
node tools/author/transfer-workflow.mjs --import ./delivery
node tools/author/transfer-workflow.mjs --import ./delivery --out ./copy
node tools/author/transfer-workflow.mjs --import ./delivery --duplicate-as delivery-next --out ./next
```

Import alone reads the directory and prints the model identity. A copy keeps
the manifest, diagrams including BPMNDI layout, and local call pins. Duplication
requests a new root identity through the graphical editor's duplication service.
Each destination must be new. Transfer snapshots are self-contained. After
editing a working project, export it again to record its new digests.

The root holds the project manifest and its BPMN files. The
`workflow-transfer.v1` index records their hashes, the compiled model identity,
the revision and digest of every operation binding per model, and the required
local schema and catalog files. Schema closure covers model and data-binding
contracts, operation input/output contracts and catalog activity output contracts.
An importing author can inspect all these data offline. Provider implementations
and runtime authority come from the destination host.

For a custom workflow, pass `--dependencies assets.json` at export. The object
contains `schemas` keyed by contract ID and `catalogs` rows of the form
`{id, revision, document}`. Each catalog document must declare its identity and
revision. A project carrying a published catalog pin requires that exact catalog.
Built-in schemas resolve from the exporting installation. Import resolves every
dependency from the snapshot and identifies the file or contract when verification
fails. The transfer index provides consistency checks; publication and trust stay
with the package owner.

## Published STANDARD

Run `node tools/author/export-bpmn-project.mjs --standard --out my-standard` to
export a working copy from the authoritative package catalog. The manifest pins
the catalog digest, which covers operation definitions, activity output contracts,
rules and skill-source hashes. The existing asset loader verifies the published
model, implementation bindings, specification and skills before export.
`compareStandardBpmnProject` recompiles the working copy and reports the changed
IR paths against the published revision. A matching model is checked with the
catalog verifier. Project XML accepts up to 1 MiB, 16,384 elements and 48 levels
per file, with an 8 MiB aggregate diagram limit.

## Property catalog

The editor derives field names, types, constants and required inputs from the
schemas associated with each installed operation. Its property catalog also
lists the available activity kinds, roles, policies, evaluators and routing
facts. Binding identity, effect class, executor and implementation digest are
read-only. An embedding host can supply its own catalog when starting the
editor. The catalog is a projection of installed definitions and package data.

## Operation reliability

An editable project can record a retry budget or a wait deadline on a
provider-supported operation. The editor displays **max retries** and **wait
timeout in milliseconds** only where the installed provider declares them.
`max_retries` counts successors after the initial attempt. A wait-only policy
allows one attempt. The compiler and host check the binding pin and provider
capabilities. Installed STANDARD provider revision 2 declares both settings for
`context_reload@1` and `session_entry_admit@1`. A timeout produces
`PROCESS_OPERATION_WAIT_EXPIRED` when new
work is attempted. Both the saved project and the compiled model retain the
policy. See [the runtime decision](ADR/ADR-0025-standard-workflow-runtime-binding.md).

Run `node tools/perf/verify-workflow-reliability.mjs` for the Windows fixture
covering an expired wait, process restart, concurrent duplicate dispatch and
reconciliation of a synthetic authenticated unknown result.

## Local graphical editor

From a source checkout, install the editor's pinned dependencies once and open
a working project. On Windows, use `npm.cmd` for the npm commands.

```sh
npm ci --prefix tools/author/bpmn-editor --ignore-scripts
node tools/author/export-bpmn-project.mjs --standard --out my-standard
node tools/author/bpmn-editor/server.mjs --project my-standard
```

Open the loopback URL printed by the server. Select a model and a subprocess
under **Bloc**. Move a shape to edit the layout. In a routing block, select a
conditional sequence flow, edit **Condition du flux**, then choose **Appliquer**.
**Comparer** recompiles the working copy against the published model.
**Enregistrer** writes the selected diagram after compilation. **Recharger**
reopens the files on disk and returns to the same block if it still exists in
the same model. If the block was removed, the editor opens the process root.
If the condition field differs from the applied condition, **Recharger** asks
for confirmation. Cancelling keeps the block, selected flow and typed text.
Confirming reloads the saved diagram. Restoring the original text before
reloading avoids the prompt when the diagram has no other unsaved edits.
A changed project digest refuses a stale save, including changes to a sibling diagram.

Open **CrÃ©er ou dupliquer un workflow** to reserve a new local workflow by ID.
Each created workflow opens at a separate bookmarkable URL and has its own local
reference model. Under **Ã‰diter les Ã©tapes**, choose a parent sequence and enter
a new step ID, or select an existing ID to edit its properties. Operation inputs
accept literals, workflow parameters and scoped outputs. Selecting an evaluator
requires a corresponding installed operation. A conditional split creates two
sequences for its branches. Calls target a local model and validate its parameter
mapping. **Appliquer Ã  lâ€™Ã©tape** previews the compiled result; **Enregistrer**
commits the working project.

The step form offers a retry count only for installed, idempotent operation
bindings and a wait deadline only when the provider supports one. Clearing
both fields removes the authored policy. These settings are checked against
the exact binding digest again on save and execution.

New workflows live under `.aidn-workflows/<id>` in the opened directory.
A coordinated save stages a complete manifest and diagrams under
`.aidn-generations/<generation>`, then atomically switches `.aidn-generation`.
The editor and portable project reader resolve that pointer before opening files.
Earlier generations remain available on disk. A layout-only save in a flat
project continues to update its diagram directly. All editor writers use the
same project lock and compare the whole-project digest before publication.

The editor serves the installed bpmn-js bundle, styles and font locally.
With the npm packages cached, `npm ci --offline` also works. For a project
exported from another IR v2 model, supply its authoritative JSON with
`--baseline model.json` on server startup. To run the browser scenarios,
use `npm test --prefix tools/author/bpmn-editor` with the matching Playwright
Chromium installed, or set `BPMN_BROWSER_PATH` to a local Chromium executable.

Projects with an authored role profile carry its schema and the versioned host capability and transition catalogs used to compile it. Import checks that these catalogs match their installed revisions.
