import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  normalizeWorkflowAdapterConfig,
} from "../../lib/config/workflow-adapter-config-lib.mjs";
import {
  VALID_INDEX_STORE_MODES,
  VALID_STATE_MODES,
} from "../../lib/config/aidn-config-lib.mjs";

function printConfig(config) {
  console.log("");
  console.log("Current workflow adapter config:");
  console.log(JSON.stringify(config, null, 2));
  console.log("");
}

async function questionWithDefault(rl, prompt, currentValue) {
  const suffix = currentValue ? ` [${currentValue}]` : "";
  const answer = await rl.question(`${prompt}${suffix}: `);
  const trimmed = String(answer ?? "").trim();
  return trimmed || String(currentValue ?? "").trim();
}

async function promptStateMode(rl, currentValue) {
  while (true) {
    const answer = await questionWithDefault(
      rl,
      `Preferred runtime state mode (${Array.from(VALID_STATE_MODES).join("|")})`,
      currentValue,
    );
    if (VALID_STATE_MODES.has(String(answer))) {
      return String(answer);
    }
    console.log("Invalid state mode.");
  }
}

async function promptIndexStore(rl, currentValue) {
  while (true) {
    const answer = await questionWithDefault(
      rl,
      `Default index store (${Array.from(VALID_INDEX_STORE_MODES).join("|")})`,
      currentValue,
    );
    if (VALID_INDEX_STORE_MODES.has(String(answer))) {
      return String(answer);
    }
    console.log("Invalid index store.");
  }
}

async function promptAdditionalConstraintIndex(rl, items, mode) {
  if (items.length === 0) {
    console.log("No additional constraints.");
    return -1;
  }
  for (let index = 0; index < items.length; index += 1) {
    console.log(`${index + 1}. ${items[index]}`);
  }
  while (true) {
    const answer = await rl.question(`${mode} item number [1-${items.length}] (blank to cancel): `);
    const trimmed = String(answer ?? "").trim();
    if (!trimmed) {
      return -1;
    }
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= items.length) {
      return numeric - 1;
    }
    console.log("Invalid selection.");
  }
}

export async function runWorkflowAdapterConfigWizard(options = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Workflow adapter config wizard requires an interactive terminal (TTY).");
  }

  const initialConfig = normalizeWorkflowAdapterConfig(options.initialConfig ?? {}, options.defaults ?? {});
  const rl = readline.createInterface({ input, output });
  let working = JSON.parse(JSON.stringify(initialConfig));
  try {
    while (true) {
      console.log("");
      console.log("Workflow adapter config wizard");
      console.log("1. List current config");
      console.log("2. Edit project name");
      console.log("3. Edit runtime constraint");
      console.log("4. Edit architecture constraint");
      console.log("5. Edit delivery constraint");
      console.log("6. Add additional constraint");
      console.log("7. Edit additional constraint");
      console.log("8. Remove additional constraint");
      console.log("9. Edit preferred runtime state mode");
      console.log("10. Edit default index store");
      console.log("11. Save");
      console.log("12. Cancel");
      const action = String(await rl.question("Select action [1-12]: ")).trim();

      if (action === "1") {
        printConfig(working);
      } else if (action === "2") {
        working.projectName = await questionWithDefault(rl, "Project name", working.projectName);
      } else if (action === "3") {
        working.constraints.runtime = await questionWithDefault(
          rl,
          "Runtime constraint",
          working.constraints.runtime,
        );
      } else if (action === "4") {
        working.constraints.architecture = await questionWithDefault(
          rl,
          "Architecture constraint",
          working.constraints.architecture,
        );
      } else if (action === "5") {
        working.constraints.delivery = await questionWithDefault(
          rl,
          "Delivery constraint",
          working.constraints.delivery,
        );
      } else if (action === "6") {
        const value = String(await rl.question("Additional constraint: ")).trim();
        if (value) {
          working.constraints.additional.push(value);
        }
      } else if (action === "7") {
        const index = await promptAdditionalConstraintIndex(rl, working.constraints.additional, "Edit");
        if (index >= 0) {
          working.constraints.additional[index] = await questionWithDefault(
            rl,
            "Constraint value",
            working.constraints.additional[index],
          );
        }
      } else if (action === "8") {
        const index = await promptAdditionalConstraintIndex(rl, working.constraints.additional, "Remove");
        if (index >= 0) {
          working.constraints.additional.splice(index, 1);
        }
      } else if (action === "9") {
        working.runtimePolicy.preferredStateMode = await promptStateMode(
          rl,
          working.runtimePolicy.preferredStateMode,
        );
      } else if (action === "10") {
        working.runtimePolicy.defaultIndexStore = await promptIndexStore(
          rl,
          working.runtimePolicy.defaultIndexStore,
        );
      } else if (action === "11") {
        return {
          saved: true,
          data: normalizeWorkflowAdapterConfig(working, options.defaults ?? {}),
        };
      } else if (action === "12") {
        return {
          saved: false,
          data: normalizeWorkflowAdapterConfig(initialConfig, options.defaults ?? {}),
        };
      } else {
        console.log("Invalid action.");
      }
    }
  } finally {
    rl.close();
  }
}
