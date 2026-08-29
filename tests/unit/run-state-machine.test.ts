import assert from "node:assert/strict";
import test from "node:test";
import { assertRunTransition, canTransitionRun, isTerminalRunStatus } from "../../lib/runs/state-machine";

test("allows the explicit run happy path", () => {
  const path = ["queued", "dispatching", "searching", "collecting", "normalizing", "deduplicating", "prefiltering", "matching", "analyzing", "persisting", "completed"] as const;
  for (let index = 1; index < path.length; index += 1) assert.equal(canTransitionRun(path[index - 1], path[index]), true);
});

test("terminal run states cannot return to work", () => {
  for (const status of ["completed", "partial", "failed", "cancelled"] as const) {
    assert.equal(isTerminalRunStatus(status), true);
    assert.throws(() => assertRunTransition(status, "searching"), /invalid_run_transition/);
  }
});

test("waiting for login can resume or be cancelled", () => {
  assert.equal(canTransitionRun("waiting_login", "searching"), true);
  assert.equal(canTransitionRun("waiting_login", "cancelled"), true);
});
