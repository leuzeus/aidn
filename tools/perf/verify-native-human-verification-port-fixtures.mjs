import { verifyNativeHumanVerificationPort } from "./native-human-verification-fixture-lib.mjs";
console.log(JSON.stringify({ status: "PASS", ...await verifyNativeHumanVerificationPort() }));
