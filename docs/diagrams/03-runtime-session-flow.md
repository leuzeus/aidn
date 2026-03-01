```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Trebuchet MS, Verdana, sans-serif",
    "fontSize": "15px",
    "lineColor": "#1E1F5C",
    "primaryColor": "#2C2E83",
    "primaryTextColor": "#FFFFFF",
    "primaryBorderColor": "#1E1F5C",
    "secondaryColor": "#3B3FBF",
    "secondaryTextColor": "#FFFFFF",
    "secondaryBorderColor": "#1E1F5C",
    "tertiaryColor": "#F6F7FF",
    "tertiaryTextColor": "#1E1F5C",
    "tertiaryBorderColor": "#2C2E83"
  }
}}%%
%% 3) Runtime Session Flow (v0.2.0)
flowchart TD
  ST["Session start"] --> CR["context-reload"]
  CR --> SS["start-session"]
  SS --> MODE{"Mode? (R02)"}

  MODE -->|THINKING| THINK["Doc/reasoning work"]
  MODE -->|EXPLORING| EXP["Exploration work"]
  MODE -->|COMMITTING| BCA["branch-cycle-audit (R03)"]

  BCA --> MAP{"Mapping + DoR valid?"}
  MAP -->|No| FIX["Remediate mapping/DoR\nor downgrade mode"]
  FIX --> MODE
  MAP -->|Yes| NEED{"Need new cycle branch?"}

  NEED -->|Yes| CONT{"Continuity gate (R06)\nR1/R2/R3"}
  CONT --> CNEW["cycle-create + status continuity fields"]
  CNEW --> IMPL["Implementation on cycle/intermediate"]
  NEED -->|No| IMPL

  THINK --> DRIFT["drift-check when needed (R05)"]
  EXP --> DRIFT
  IMPL --> DRIFT
  DRIFT --> CLOSE{"Close session now?"}

  CLOSE -->|No| LOOP["Continue active work"]
  LOOP --> MODE

  CLOSE -->|Yes| RESOLVE["Resolve open cycles (R07):\nintegrate-to-session | report |\nclose-non-retained | cancel-close"]
  RESOLVE --> OK{"All open cycles resolved?"}
  OK -->|No (cancel-close)| LOOP
  OK -->|Yes| CS["close-session + snapshot update"]

  CS --> PRQ{"PR/merge step required?"}
  PRQ -->|No| END["Session ended"]
  PRQ -->|Yes| PRG["PR review gate (R08)\nCodex threads triaged"]
  PRG --> MRG["Merge"]
  MRG --> SYNC{"Post-merge local sync gate (R09)\nlocal vs remote aligned?"}
  SYNC -->|No| REC["Explicit local reconciliation"]
  REC --> SYNC
  SYNC -->|Yes| END

  MAP --> INC["Incident triage (R10)"]
  CONT --> INC
  RESOLVE --> INC
  PRG --> INC
  SYNC --> INC
  INC --> MODE

  classDef gate fill:#3B3FBF,stroke:#1E1F5C,color:#FFFFFF,stroke-width:2px;
  classDef action fill:#2C2E83,stroke:#1E1F5C,color:#FFFFFF,stroke-width:2px;
  classDef endnode fill:#F6F7FF,stroke:#2C2E83,color:#1E1F5C,stroke-width:1.5px;
  classDef incident fill:#FFF4F4,stroke:#B42318,color:#7A271A,stroke-width:2px;

  class MODE,MAP,NEED,CONT,CLOSE,OK,PRQ,SYNC gate;
  class ST,CR,SS,THINK,EXP,BCA,FIX,CNEW,IMPL,DRIFT,LOOP,RESOLVE,CS,PRG,MRG,REC action;
  class END endnode;
  class INC incident;

  linkStyle default stroke:#1E1F5C,stroke-width:2px;
```
