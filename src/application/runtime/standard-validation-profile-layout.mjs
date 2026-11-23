import { readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { assertStandardValidationProfile } from "../../core/workflow/standard-cycle-validation.mjs";
import { assertStandardValidationNativeLayout } from "../../core/workflow/standard-validation-native-layout.mjs";

// Read the two pinned declarations before constructing an authority or host.
// Qualification, physical path admission and current process evidence remain
// the responsibility of the existing validation execution boundary.
export function assertStandardValidationProfileLayout({ execution, profileRef }) {
  if (!profileRef) return;
  const profile = assertStandardValidationProfile(readAgentRunFile(profileRef.path, { sha256: profileRef.sha256 }).value);
  const boundary = readAgentRunFile(profile.boundary_configuration.path, { sha256: profile.boundary_configuration.sha256 }).value;
  assertStandardValidationNativeLayout({ execution, profile, boundary });
}
