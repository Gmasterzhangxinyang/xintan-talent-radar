import { existsSync } from "node:fs";
import { homedir, platform as currentPlatform } from "node:os";
import { join } from "node:path";

export function browserExecutableCandidates({ platform = currentPlatform(), env = process.env, home = homedir() } = {}) {
  if (env.XINTAN_BROWSER_EXECUTABLE) return [env.XINTAN_BROWSER_EXECUTABLE];
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ];
  if (platform === "win32") return [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    env.PROGRAMFILES && join(env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    env["PROGRAMFILES(X86)"] && join(env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
    env.PROGRAMFILES && join(env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
  ].filter(Boolean);
  return [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
  ];
}

export function detectBrowserExecutable({ exists = existsSync, ...options } = {}) {
  return browserExecutableCandidates(options).find((candidate) => exists(candidate)) ?? "";
}

export function platformLabel(platform = currentPlatform()) {
  return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform;
}
