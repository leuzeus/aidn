import assert from "node:assert/strict";

// Shared with the code-author parity fixture. Every edit goes through the same
// form an analyst uses. Only the final assertion reads the saved project.
export async function authorReferenceWorkflow(page, origin, id = "editor-workflow") {
  await page.goto(origin);
  await page.waitForFunction(() => !document.querySelector("#compare").disabled && document.querySelector("#catalog-operation").options.length);
  await page.getByText("Créer ou dupliquer un workflow", { exact: true }).click();
  await page.locator("#workspace-id").fill(id);
  await Promise.all([page.waitForURL("**/?project=" + id), page.getByRole("button", { name: "Créer", exact: true }).click()]);
  await page.waitForFunction(() => !document.querySelector("#compare").disabled);
  await page.getByText("Éditer les étapes", { exact: true }).click();
  const url = origin + "/api/";
  async function step(kind, node, parent, configure) {
    await page.locator("#step-kind").selectOption(kind);
    await page.locator("#step-id").fill(node);
    await page.locator("#step-id").press("Tab");
    await page.locator("#step-parent").selectOption(parent);
    await configure();
    const pending = page.waitForResponse(res => res.url().startsWith(url + "edit?"));
    await page.getByRole("button", { name: "Appliquer à l’étape" }).click();
    const response = await pending, body = await response.json();
    await page.waitForFunction(() => !document.querySelector("#compare").disabled);
    return body;
  }
  const success = body => assert.ok(!body.error, JSON.stringify(body));
  success(await step("operation", "reload_context", "root", () => page.locator("#step-operation").selectOption("context_reload@1")));
  success(await step("evaluation", "quality", "root", async () => {
    await page.locator("#step-evaluator").selectOption("cycle_validation@1");
    await page.getByLabel("Source validation_operation_id", { exact: true }).selectOption("parameter");
    await page.getByLabel("Valeur validation_operation_id", { exact: true }).fill("validation_id");
  }));
  success(await step("xor", "route", "root", () => page.locator("#step-fact").fill("cycle_checks_passed")));
  success(await step("activity", "review", "route_yes", async () => {
    await page.locator("#step-role").selectOption("mode_analyst");
    await page.locator("#step-policy").selectOption("thinking_analysis_policy");
  }));
  success(await step("call", "rework", "route_no", () => page.locator("#step-target").fill("repair_flow")));
  const diagnostic = await step("xor", "bad_route", "root", () => page.locator("#step-fact").fill("not a fact"));
  assert.equal(diagnostic.error, "BPMN_CONDITION_INVALID");
  const pending = page.waitForResponse(res => res.url().startsWith(url + "save?"));
  await page.locator("#save").click();
  success(await (await pending).json());
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#compare").disabled && document.querySelector("#model").options.length === 2);
  const state = await (await fetch(url + "project?project=" + id)).json();
  return { project: { manifest: state.manifest, diagrams: state.diagrams }, diagnostic };
}
