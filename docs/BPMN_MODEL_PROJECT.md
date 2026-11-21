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
A changed file digest refuses a stale save.

The editor serves the installed bpmn-js bundle, styles and font locally.
With the npm packages cached, `npm ci --offline` also works. For a project
exported from another IR v2 model, supply its authoritative JSON with
`--baseline model.json` on server startup. To run the browser scenarios,
use `npm test --prefix tools/author/bpmn-editor` with the matching Playwright
Chromium installed, or set `BPMN_BROWSER_PATH` to a local Chromium executable.
