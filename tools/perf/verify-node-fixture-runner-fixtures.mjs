import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import manifest from "../../package/catalogs/agentic-process-fixtures.v1.json" with { type: "json" };
import { runNodeFixtureCases } from "../verify/node-fixture-runner-lib.mjs";
import { verifyWindowsVerificationTree } from "./verification-windows-tree-fixture-lib.mjs";

// Preserve the accepted febbb020/81b1783e prefix and six supplemental cases,
// modulo the explicit 2026-11-11 age-regression selectors. The current
// exact argv is pinned separately, so removing a new selector still fails.
const originalCases = manifest.cases.slice(0, 194).map(args => args.filter(arg => !["--aged-plan", "--aged-hook"].includes(arg)));
assert.equal(createHash("sha256").update(JSON.stringify(originalCases.slice(0, 188))).digest("hex"),
  "c14ad5423a7644ee7a7098b58f1400443d059191329a22b5a3d0066658aad555");
assert.deepEqual(originalCases.slice(188), [["tools/perf/verify-node-fixture-runner-fixtures.mjs"],
  ["tools/perf/verify-standard-host-source-fixtures.mjs"], ["tools/perf/verify-workflow-execution-authority-fixtures.mjs"],
  ...["files", "dual", "db-only"].map(mode => ["tools/perf/verify-standard-ordinary-entry-fixtures.mjs", "--mode=" + mode])]);
assert.deepEqual(manifest.cases.slice(194, 197), [
  ["tools/perf/verify-standard-drift-rollback-fixtures.mjs", "--aged-plan"],
  ["tools/perf/verify-drift-recovery-fixtures.mjs", "--cycle-port-mode=files", "--aged-plan"],
  ["tools/perf/verify-standard-pr-redelivery-fixtures.mjs", "--mode=files", "--aged-plan"],
]);
console.log("PASS accepted194 cases retain their original argv and order modulo explicit age selectors with three exact additions");
assert.equal(manifest.cases.length, 384);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 383))).digest("hex"), "106c7f74c8f85d474927bae6e96bfeb049ca61432979d5c251951d2888dc0a6e");
assert.deepEqual(manifest.cases[383], ["tools/perf/verify-github-process-tree-transport-fixtures.mjs"]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 382))).digest("hex"), "dfb83e1921c5d3273fd5d38e848c4baee920c24a116ad72566163364048d3e3f");
assert.deepEqual(manifest.cases[382], ["tools/perf/verify-handoff-process-discovery-fixtures.mjs"]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 381))).digest("hex"), "e5447233ec2a5f7bee2e3a36d9219d02334d7aaa46aae73258c9ab7b1f357677");
assert.deepEqual(manifest.cases[381], ["tools/perf/verify-standard-handoff-preparation-fixtures.mjs"]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 378))).digest("hex"),
  "b0a873ef60a93dd13c3760ed84a0c88cfce47e33cb352a3d839f42a09be55bec");
assert.deepEqual(manifest.cases.slice(378, 381), [
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--standard-mode-work-resume-mode=files",
    "--standard-mode-work-session=EXPLORING",
    "--retain-always"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--standard-mode-work-resume-mode=dual",
    "--standard-mode-work-session=EXPLORING",
    "--retain-always"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--standard-mode-work-resume-mode=db-only",
    "--standard-mode-work-session=EXPLORING",
    "--retain-always"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 197))).digest("hex"),
  "47b229353b3929aa0b52623f688b46296517e513a331a68060c4c5a0190c62f4");
console.log("PASS accepted197 exact argv and order are preserved before twelve R05 objective components");
assert.deepEqual(manifest.cases.slice(197, 209), [
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=nominal",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=revoked",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=expired",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=wrong-authority",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=wrong-subject",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=revoked-after-observe",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=expired-after-observe",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=head-last-human-await",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--drift-worker-mode=context-last-human-await",
    "--drift-worker-process"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--cycle-close-finalize-mode=files",
    "--cycle-close-objective-completion"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--cycle-close-finalize-mode=dual",
    "--cycle-close-objective-completion"
  ],
  [
    "tools/perf/verify-agentic-process-execution-fixtures.mjs",
    "--cycle-close-finalize-mode=db-only",
    "--cycle-close-objective-completion"
  ]
]);
console.log("PASS twelve appended cases cover independent worker current permission and original old R05 closure in all three storage modes");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 209))).digest("hex"),
  "d99daf15720f381660bf82e22ac3ad7b0cb0388430d7c0f6cfed14e4b33fbc84");
assert.deepEqual(manifest.cases.slice(209, 210), [["tools/perf/verify-agentic-process-execution-fixtures.mjs","--drift-cycle-mode=files","--drift-cycle-published-selection"]]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 210))).digest("hex"),
  "51d10bbc1a450d058536baa9f9545385fe70c7fe2b7eec8fd586812bde04d52d");
const historicalNominal = ["tools/perf/verify-agentic-process-execution-fixtures.mjs","--standard-composed-mode=files","--standard-composed-stop=nominal_post_merge_complete"];
assert.deepEqual(manifest.cases[303], historicalNominal);
const historical211 = [...manifest.cases.slice(0, 210), manifest.cases[303]];
assert.equal(createHash("sha256").update(JSON.stringify(historical211)).digest("hex"),
  "a69efae4383b1f0c86a1337a1fbd16585c1c1f07bf6b14362e40dfd73b222761");
console.log("PASS original211 exact argv and relative order remain intact, including their published nominal journey");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 304))).digest("hex"),
  "97e80234f3ea25afbf61fd53ea07c3244440d431c169b831e8c02ef5a49a46f6");
assert.deepEqual(manifest.cases.slice(304, 313), [
  ...["files", "dual", "db-only"].map(mode => ["tools/perf/verify-standard-incident-closure-fixtures.mjs", "--mode=" + mode]),
  ...["files", "dual", "db-only"].map(mode => ["tools/perf/verify-standard-pr-incident-tracking-fixtures.mjs", "--mode=" + mode]),
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-premerge", "--incident-evidence"],
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-premerge", "--incident-tracking"],
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-pretriage-session", "--incident-tracking"],
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 313))).digest("hex"),
  "cb85d5694d860f94405db17f9e6621d34333c595beeef805cf76d2b852ff71e7");
assert.equal(manifest.cases.filter(args => args.includes("--aged-plan") || args.includes("--aged-hook")).length, 56);
console.log("PASS accepted313 preserves the complete304 prefix and nine exact private R10 fixture additions without deadline or selector changes");
assert.deepEqual(manifest.cases.slice(313, 315), [
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-premerge", "--incident-cleanup"],
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-pretriage-session", "--incident-cleanup"],
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 315))).digest("hex"),
  "a7da9de5d1555040ad7e1f6f7524061d721a49a5b91bd3a945560d506f8311c4");
console.log("PASS accepted315 preserves the complete313 prefix and two exact actual-host R10 cleanup cases");
assert.deepEqual(manifest.cases.slice(315, 316), [["tools/perf/verify-standard-pr-review-reply-fixtures.mjs","--case=external-premerge","--incident-low-severity"]]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 316))).digest("hex"),
  "14b2088e4e726544139edabf82a3fb7bfc89c024e580579e5939dbe5b016cd0b");
console.log("PASS frozen316 preserves all315 commands and the published L1 no-incident regression");
assert.deepEqual(manifest.cases.slice(316, 318), [
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-premerge", "--incident-receipt-loss"],
  ["tools/perf/verify-standard-pr-review-reply-fixtures.mjs", "--case=external-pretriage-session", "--incident-receipt-loss"],
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 318))).digest("hex"),
  "0a973f71172b6cf10d9f7844c5c60304e2c85f3efa65e84a40ebd74e44d54c80");
console.log("PASS frozen318 preserves the complete316 prefix and appends both published cold receipt-loss recoveries");
assert.deepEqual(manifest.cases.slice(318, 322), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-receipt-loss",
    "--incident-state-mode=db-only"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-receipt-loss",
    "--incident-state-mode=db-only"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-receipt-loss",
    "--incident-state-mode=dual"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-receipt-loss",
    "--incident-state-mode=dual"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 322))).digest("hex"),
  "b1078c49aa9e8257e30834b8833a4127d6e41d9c2fe5d498a911586b5197f01f");
console.log("PASS first322 retains all frozen318 commands and four exact published SQLite receipt-loss cases");
assert.deepEqual(manifest.cases.slice(322, 326), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-state-mode=dual"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-state-mode=db-only"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 326))).digest("hex"),
  "46b40c6932c7d854208a01ca0a043588da308f95f5128b70db73f4cb340bbef3");
console.log("PASS frozen326 preserves both FILES partial-receipt targets and the DUAL/db-only partial-receipt cases");
assert.deepEqual(manifest.cases.slice(326, 332), [
  [
    "tools/perf/verify-standard-pr-incident-continuation-contract-fixtures.mjs"
  ],
  [
    "tools/perf/verify-standard-artifact-disposition-owner-fixtures.mjs"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-entry"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 332))).digest("hex"),
  "8898cc06ac401296c9bcd4321c52d12b9d2862b5dd6c350d955d566901d587d0");
console.log("PASS current332 appends closed continuation contracts, borrowed ownership and four exact common-host/ordinary-entry scenarios");
assert.deepEqual(manifest.cases.slice(332, 335), [
  [
    "tools/perf/verify-standard-disposition-acceptance-control-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-standard-disposition-acceptance-control-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-standard-disposition-acceptance-control-fixtures.mjs",
    "db-only"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 335))).digest("hex"), "4300790572b00aae9a0eec42f911105f7023487dbefb9d171915aeb236b01ed2");
console.log("PASS current335 preserves exact332 and requires three accepted-control backend commands");
assert.deepEqual(manifest.cases.slice(335, 338), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-cut=disposition_recorded"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual",
    "--incident-continuation-cut=disposition_recorded"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only",
    "--incident-continuation-cut=disposition_recorded"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 338))).digest("hex"), "031bd9c885d94d0ba29715057365a72d2bfbeef29cc09ae7d807fc46bf712261");
console.log("PASS current338 preserves exact335 and requires three captured-result cold adoption commands");
assert.deepEqual(manifest.cases.slice(338, 347), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-race=reserved"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-race=active-owner"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual",
    "--incident-continuation-race=reserved"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual",
    "--incident-continuation-race=active-owner"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only",
    "--incident-continuation-race=reserved"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only",
    "--incident-continuation-race=active-owner"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-race=active-owner",
    "--incident-continuation-history=rewrite"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-race=active-owner",
    "--incident-continuation-history=reorder"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-premerge",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-continuation-race=active-owner",
    "--incident-continuation-history=truncate"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 347))).digest("hex"), "3c0d23996b92b2c9c4e802da66df7d8ca104493be75ed7c775ea35bfd760f96d");
console.log("PASS current347 preserves exact338 and adds two actual-controller schedules on three backends plus three signed-history refusals");
assert.deepEqual(manifest.cases.slice(347, 353), [
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "db-only"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "files",
    "--reconciled"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "dual",
    "--reconciled"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "db-only",
    "--reconciled"
  ]
]);
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 353))).digest("hex"), "48fd2653c0d665b4482559dbe7e65bf03552ec66eb4934893ce8ff8df1ed00a9");
console.log("PASS current353 preserves exact347 and requires ordinary and authenticated reconciled Native closure reads on all three backends");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 353))).digest("hex"), "48fd2653c0d665b4482559dbe7e65bf03552ec66eb4934893ce8ff8df1ed00a9");
assert.deepEqual(manifest.cases.slice(353, 357), [
  [
    "tools/perf/verify-standard-handoff-resource-fixtures.mjs"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "files",
    "--reconciled",
    "--handoff-resources"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "dual",
    "--reconciled",
    "--handoff-resources"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "db-only",
    "--reconciled",
    "--handoff-resources"
  ]
]);
console.log("PASS current357 preserves exact353 and requires current-resource contracts and real mixed reads on all three backends");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 357))).digest("hex"), "50a1f439985709718e9a424bb5cb31f024adbb797a7658eed178962dba88de9a");
assert.deepEqual(manifest.cases.slice(357, 360), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=files",
    "--incident-continuation-cut=disposition_acceptance_committed"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual",
    "--incident-continuation-cut=disposition_acceptance_committed"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only",
    "--incident-continuation-cut=disposition_acceptance_committed"
  ]
]);
console.log("PASS current360 preserves exact357 and requires accepted v2 control retirement through ordinary entry on all three backends");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 360))).digest("hex"), "1c2cbe990e38402e9b0fe2c81b9b84e38f773e49f14d2b5d1ba39a4bd4504ef8");
assert.deepEqual(manifest.cases.slice(360, 366), [
  [
    "tools/perf/verify-standard-handoff-context-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-standard-handoff-context-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-standard-handoff-context-fixtures.mjs",
    "db-only"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "files",
    "--reconciled",
    "--handoff-resources",
    "--handoff-context"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "dual",
    "--reconciled",
    "--handoff-resources",
    "--handoff-context"
  ],
  [
    "tools/perf/verify-native-allocation-closure-evidence-fixtures.mjs",
    "db-only",
    "--reconciled",
    "--handoff-resources",
    "--handoff-context"
  ]
]);
console.log("PASS current366 preserves exact360 and requires canonical context components and actual mixed reads on all three backends");

assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 366))).digest("hex"), "cce61653f37577bbc5abc0a27b5e23fa6342a62cff180b7789772c53297ac24f");
assert.deepEqual(manifest.cases.slice(366, 369), [
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=files",
    "--incident-continuation-cut=disposition_receipted"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=dual",
    "--incident-continuation-cut=disposition_receipted"
  ],
  [
    "tools/perf/verify-standard-pr-review-reply-fixtures.mjs",
    "--case=external-pretriage-session",
    "--incident-partial-write",
    "--incident-partial-continuation",
    "--incident-state-mode=db-only",
    "--incident-continuation-cut=disposition_receipted"
  ]
]);
console.log("PASS current369 preserves exact366 and requires the receipted continuation cut on all three backends");
assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 369))).digest("hex"), "f48f7108087de121485f292663811f45ee15c9a44b00b2100467ea832e84ed7d");
assert.deepEqual(manifest.cases.slice(369, 372), [
  [
    "tools/perf/verify-standard-handoff-publication-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-standard-handoff-publication-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-standard-handoff-publication-fixtures.mjs",
    "db-only"
  ]
]);
console.log("PASS current372 preserves exact369 and requires canonical packet publication on all three backends");

assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 372))).digest("hex"), "7faf4c8f40faf71a692a0e91a363bebf7209fbeae7579935b48c840bab7bd4be");
assert.deepEqual(manifest.cases.slice(372, 375), [
  [
    "tools/perf/verify-standard-handoff-operation-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-standard-handoff-operation-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-standard-handoff-operation-fixtures.mjs",
    "db-only"
  ]
]);
console.log("PASS current375 preserves exact372 and requires common signed handoff receipts on all three backends");

assert.equal(createHash("sha256").update(JSON.stringify(manifest.cases.slice(0, 375))).digest("hex"), "a2a740fb854b8f47bcdb5edcc320f9c50a5c00112311e83f682ed6fa661a0dcc");
assert.deepEqual(manifest.cases.slice(375, 378), [
  [
    "tools/perf/verify-standard-handoff-returned-receipt-fixtures.mjs",
    "files"
  ],
  [
    "tools/perf/verify-standard-handoff-returned-receipt-fixtures.mjs",
    "dual"
  ],
  [
    "tools/perf/verify-standard-handoff-returned-receipt-fixtures.mjs",
    "db-only"
  ]
]);
console.log("PASS current382 preserves exact381 and requires physical handoff preparation on all three backends");

if (process.argv.includes("--manifest-only")) {
  console.log(JSON.stringify({ status: "PASS", checks: 28, scope: "frozen326/332/335/338/347/353/357/360/366/369/372/375 prefixes plus receipted continuation, canonical publication, common handoff receipts and captured publication recovery",
    manifest_cases: 384, child_execution_protocol: "NOT_RUN", native: "NOT_RUN" }));
  process.exit(0);
}

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn fixture runner "));
const log = path.join(base, "events.jsonl"), script = path.join(base, "child with spaces.mjs");
fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(process.argv[2],JSON.stringify(process.argv.slice(3))+'\\n'); process.exitCode=Number(process.argv[3]);\n`);
const first = [script, log, "0", "one two", "literal & no shell", "$(literal)"];
const failing = [script, log, "23"], forbidden = [script, log, "0", "must never start"];
const evidenceRoot = fs.mkdtempSync(path.join(path.dirname(base), "aidn-dispatcher-deadline-"));
const env = { ...process.env }; delete env.AIDN_VERIFICATION_DEADLINE_AT;
let result = await runNodeFixtureCases([first, failing, forbidden], { cwd: base, env, evidenceRoot, stdio: "pipe" });
assert.deepEqual(result, { exit_code: 23, signal: null, completed: 1 });
assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse), [first.slice(2), failing.slice(2)]);
console.log("PASS argv/paths with spaces and shell literals survive; failing second child prevents third and preserves exit 23");
const firstEvidence = path.join(evidenceRoot, fs.readdirSync(evidenceRoot).find(name => name.startsWith("aidn-verification-")));
assert.equal(JSON.parse(fs.readFileSync(path.join(firstEvidence, "cases.json"))).deadline_at, null);
if (process.platform === "win32") for (const name of ["001", "002"]) {
  const observed = JSON.parse(fs.readFileSync(path.join(firstEvidence, name, "result.json")));
  assert.equal(observed.deadline_at, null); assert.equal(observed.deadline_exceeded, false); assert.equal(observed.cleanup.proof.active_processes, 0);
}
console.log("PASS default dispatcher invents no aggregate or case deadline and preserves each observed closure");
fs.writeFileSync(log, "");
const deadlineAt = Date.now() + 60000, prior = new Set(fs.readdirSync(evidenceRoot));
result = await runNodeFixtureCases([first, forbidden], { cwd: base, env, evidenceRoot, deadlineAt, stdio: "pipe" });
assert.deepEqual(result, { exit_code: 0, signal: null, completed: 2 });
assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse), [first.slice(2), forbidden.slice(2)]);
console.log("PASS successful children execute in their declared order");
const secondEvidence = path.join(evidenceRoot, fs.readdirSync(evidenceRoot).find(name => !prior.has(name)));
assert.equal(JSON.parse(fs.readFileSync(path.join(secondEvidence, "cases.json"))).deadline_at, new Date(deadlineAt).toISOString());
if (process.platform === "win32") for (const name of ["001", "002"]) {
  const observed = JSON.parse(fs.readFileSync(path.join(secondEvidence, name, "result.json")));
  assert.equal(observed.deadline_at, new Date(deadlineAt).toISOString()); assert.equal(observed.cleanup.proof.active_processes, 0);
}
console.log("PASS an explicit caller deadline is identical across both cases without renewal");
const ready = path.join(base, "ready"), waiting = path.join(base, "waiting.mjs"), parent = path.join(base, "parent.mjs");
fs.writeFileSync(waiting, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);\n`);
const library = new URL("../verify/node-fixture-runner-lib.mjs", import.meta.url).href;
fs.writeFileSync(parent, `import {runNodeFixtureCases} from ${JSON.stringify(library)}; const result=await runNodeFixtureCases(${JSON.stringify([[waiting, ready], forbidden])},{cwd:${JSON.stringify(base)}}); if(result.signal)process.kill(process.pid,result.signal);else process.exitCode=result.exit_code;\n`);
// AbortSignal exercises the portable forwarding path on Windows, whose OS
// terminate signal cannot invoke a JavaScript SIGTERM listener in a child.
if (process.platform === "win32") {
  const stop = new AbortController();
  const before = fs.readFileSync(log, "utf8");
  const run = runNodeFixtureCases([[waiting, ready], forbidden], { cwd: base, stdio: "pipe", signal: stop.signal });
  setTimeout(() => stop.abort(), 500);
  result = await run;
  assert.equal(result.signal, "SIGTERM"); assert.equal(result.completed, 0); assert.equal(fs.readFileSync(log, "utf8"), before);
} else {
  const child = spawn(process.execPath, [parent], { cwd: base, stdio: "pipe", shell: false, windowsHide: true });
  const terminal = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(ready)); child.kill("SIGTERM");
  assert.equal((await terminal).signal, "SIGTERM");
}
console.log("PASS stop prevents subsequent launch and propagates the active-child signal");
await verifyWindowsVerificationTree(base);
console.log(JSON.stringify({ status: "PASS", platform: process.platform, native: "NOT_RUN", base }));
