```mermaid
%% 1) Global System Architecture (v0.2.0 workflow)
flowchart LR
  subgraph RULE["Rule Layer (Normative)"]
    SPEC["SPEC.md (SPEC-R01..SPEC-R11)"]
    WF["WORKFLOW.md (local adapter extensions)"]
    AG["AGENTS.md (execution contract)"]
    SPEC --> WF --> AG
  end

  subgraph RUN["Execution Layer (Skills + Gates)"]
    START["context-reload + start-session (R01)"]
    MODE{"Mode selected (R02)"}
    BCA["branch-cycle-audit (R03)"]
    CONT{"Continuity gate (R06)\nR1 | R2 | R3"}
    DOR{"DoR gate (R04)"}
    EXEC["Cycle implementation"]
    DRIFT["drift-check (R05)"]
    SCLOSE{"Session close gate (R07)"}
    PRG{"PR review gate (R08)"}
    SYNC{"Post-merge local sync (R09)"}
    INC{"Incident triage (R10)\nL1/L2 auto-fix | L3/L4 stop+auth"}
  end

  subgraph STATE["State Layer (Declarative)"]
    SESS["sessions/SXXX.md"]
    CYCLE["cycles/*/status.md"]
    SNAP["snapshots/context-snapshot.md"]
    BASE["baseline/current.md + history.md"]
    PARK["parking-lot.md"]
    INCF["incidents/INC-TMP-*.md"]
  end

  START --> MODE
  MODE -->|COMMITTING| BCA --> CONT --> DOR --> EXEC --> DRIFT --> SCLOSE
  MODE -->|THINKING / EXPLORING| DRIFT
  SCLOSE --> PRG --> SYNC --> START

  START <--> SESS
  BCA <--> CYCLE
  CONT --> CYCLE
  EXEC --> CYCLE
  DRIFT --> PARK
  DRIFT --> SNAP
  SCLOSE --> SESS
  SCLOSE --> SNAP
  SYNC --> SNAP
  BASE --> START

  CONT --> INC
  DOR --> INC
  DRIFT --> INC
  SCLOSE --> INC
  PRG --> INC
  SYNC --> INC
  INC --> INCF
  INC --> START

  SPEC -. governs .-> START
  SPEC -. governs .-> SCLOSE
  SPEC -. governs .-> PRG
  SPEC -. governs .-> SYNC
```
