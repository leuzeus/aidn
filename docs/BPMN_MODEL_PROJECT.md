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
