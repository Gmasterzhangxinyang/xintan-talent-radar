import assert from "node:assert/strict";
import test from "node:test";
import { browserExecutableCandidates, detectBrowserExecutable, platformLabel } from "../../local-assistant/platform.mjs";

test("builds deterministic browser candidates for macOS and Windows", () => {
  const mac = browserExecutableCandidates({ platform: "darwin", env: {}, home: "/Users/test" });
  assert.ok(mac.some((path: string) => path.includes("Google Chrome.app")));

  const windows = browserExecutableCandidates({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local", PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
    home: "C:\\Users\\test",
  });
  assert.ok(windows.some((path: string) => path.endsWith("Google/Chrome/Application/chrome.exe")));
  assert.ok(windows.some((path: string) => path.endsWith("Microsoft/Edge/Application/msedge.exe")));
});

test("honors an explicit executable and returns the first installed candidate", () => {
  const explicit = "/opt/xintan/chrome";
  assert.deepEqual(browserExecutableCandidates({ platform: "linux", env: { XINTAN_BROWSER_EXECUTABLE: explicit }, home: "/tmp" }), [explicit]);
  assert.equal(detectBrowserExecutable({ platform: "linux", env: {}, home: "/tmp", exists: (path: string) => path === "/usr/bin/chromium" }), "/usr/bin/chromium");
});

test("exposes stable operating-system labels", () => {
  assert.equal(platformLabel("darwin"), "macOS");
  assert.equal(platformLabel("win32"), "Windows");
  assert.equal(platformLabel("linux"), "Linux");
});
