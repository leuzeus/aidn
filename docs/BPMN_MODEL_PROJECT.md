# BPMN model projects

A local authoring project contains `manifest.json` (`bpmn-model-project.v1`) and one
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
