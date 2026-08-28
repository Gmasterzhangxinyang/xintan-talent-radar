import assert from "node:assert/strict";
import test from "node:test";
import { parseStringArray, unique } from "../../lib/json";

test("parses JSON and human-entered keyword lists consistently", () => {
  assert.deepEqual(parseStringArray('["UVM", " VCS "]'), ["UVM", "VCS"]);
  assert.deepEqual(parseStringArray("UVM、VCS，Verdi\nSTA"), ["UVM", "VCS", "Verdi", "STA"]);
});

test("removes exact duplicate and empty values", () => {
  assert.deepEqual(unique(["UVM", "", " UVM ", "VCS"]), ["UVM", "VCS"]);
});
