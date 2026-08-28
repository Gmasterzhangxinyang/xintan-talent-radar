import assert from "node:assert/strict";
import test from "node:test";
import { COMPUTER_SOURCES, hashSecret, validateAgentEndpoint } from "../../lib/connector-settings";

test("truthfully exposes only the currently implemented browser source", () => {
  assert.deepEqual(COMPUTER_SOURCES, ["知乎"]);
});

test("accepts public HTTPS agent endpoints and blocks local/cloud-unsafe endpoints", () => {
  assert.equal(validateAgentEndpoint("https://agent.example.com/"), "https://agent.example.com");
  assert.throws(() => validateAgentEndpoint("http://agent.example.com"), /HTTPS/);
  assert.throws(() => validateAgentEndpoint("https://127.0.0.1:8765"), /无法直连本机/);
  assert.throws(() => validateAgentEndpoint("https://192.168.1.9"), /无法直连本机/);
});

test("hashes callback secrets without retaining the input", async () => {
  const hash = await hashSecret("test-callback-secret");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, "test-callback-secret");
});
