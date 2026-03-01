# Mermaid Preset - Indigo

This preset is designed for good readability on GitHub and local Mermaid renderers.

## Color Tokens

- Primary indigo: `#2C2E83`
- Dark indigo: `#1E1F5C`
- Bright indigo: `#3B3FBF`
- Text on indigo: `#FFFFFF`
- Soft background: `#F6F7FF`

Note: Mermaid does not support true gradient fills for standard nodes on all renderers.
Use dark/bright indigo classes side by side for a visual gradient effect.

## Flowchart Preset (Copy/Paste)

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
flowchart LR
  A["Start"] --> B{"Gate"}
  B -->|yes| C["Action"]
  B -->|no| D["Stop"]

  classDef indigo fill:#2C2E83,stroke:#1E1F5C,color:#FFFFFF,stroke-width:2px;
  classDef indigoDark fill:#1E1F5C,stroke:#1E1F5C,color:#FFFFFF,stroke-width:2px;
  classDef indigoBright fill:#3B3FBF,stroke:#1E1F5C,color:#FFFFFF,stroke-width:2px;
  classDef panel fill:#F6F7FF,stroke:#2C2E83,color:#1E1F5C,stroke-width:1.5px;
  classDef warn fill:#FFF4F4,stroke:#B42318,color:#7A271A,stroke-width:2px;

  class A,C indigo;
  class B indigoBright;
  class D warn;

  linkStyle default stroke:#1E1F5C,stroke-width:2px;
```

## State Diagram Preset (Copy/Paste)

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
stateDiagram-v2
  [*] --> OPEN
  OPEN --> IMPLEMENTING
  IMPLEMENTING --> VERIFYING
  VERIFYING --> DONE
  DONE --> [*]
```

## Recommended Class Mapping

For workflow diagrams:
- Rule/policy nodes -> `indigoDark`
- Gates/decisions -> `indigoBright`
- State artifacts/files -> `panel`
- Blocking/risk nodes -> `warn`

For "fake gradient" look:
- Alternate nearby blocks between `indigoDark` and `indigoBright`.
