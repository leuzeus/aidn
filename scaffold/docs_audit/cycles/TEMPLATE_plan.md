# Plan — CXXX-[type]

## Usage Matrix
Scope: `local | shared | high-risk`

| Usage Class | Scenario | Constraint Difference | Evidence |
|---|---|---|---|
| nominal | (main scenario) | primary path | TEST-XXX |
| alternate | (second caller/use case) | different caller or business path | TEST-XXX |
| context/edge/adversarial | (context or failure mode) | different execution/context constraint | TEST-XXX |

## Tasks
1.
2.
3.

## Dependencies
- 

## Native write scope
```json
{"version":1,"tasks":[]}
```

Before entering implementation, bind each applicable task's exact text to its
`intent` (`implementation` or `exploration`) and explicit project-relative
`paths`: each entry has `path` and `operations` (`add`, `update`, `delete`,
`move`, `move-destination`). No glob or directory grants. Both move paths need
permission. A native edit cannot alter a frozen plan to expand its own scope;
use the governed scope-change/transition process. This is scope admission,
not semantic review or an alternative to DoR.

### Scope entry example

For a first task `implement parser validation`, copy the exact task text into
`task` (not `text`) and declare each file operation in the scope block above:

```json
{"task":"implement parser validation","intent":"implementation","paths":[{"path":"src/parser.mjs","operations":["update"]}]}
```

This standalone example grants nothing. Replace `tasks: []` only after selecting
the actual task and files; keep it empty while the plan is unprepared.

## Done criteria (per task)
- Task 1:
- Task 2:

## Validation closure
- Declared `usage_matrix` executed or explicitly reduced with rationale.
- Shared/high-risk changes: do not close on single-usage evidence only.

## Checkpoints
- 
