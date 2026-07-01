type DesktopWindowAction = "minimize" | "toggleMaximize" | "hide" | "close";

type CloseRequest = {
  preventDefault: () => void;
};

type ElectronBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  openExternalUrl: (url: string) => Promise<void>;
  windowAction: (action: DesktopWindowAction) => Promise<void>;
  onCloseBehaviorRequested: (callback: () => void) => () => void;
};

function electronBridge() {
  return window.mcServerManager;
}

function requireElectronBridge() {
  const bridge = electronBridge();
  if (!bridge) {
    throw new Error("Electron desktop bridge is unavailable.");
  }
  return bridge;
}

export function isDesktopRuntimeAvailable() {
  return Boolean(electronBridge());
}

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>,
) {
  return requireElectronBridge().invoke<T>(command, args);
}

export async function runDesktopWindowAction(action: DesktopWindowAction) {
  await requireElectronBridge().windowAction(action);
}

export async function openExternalUrl(url: string) {
  await requireElectronBridge().openExternalUrl(url);
}

export async function onDesktopCloseRequested(
  callback: (request: CloseRequest) => void,
) {
  return requireElectronBridge().onCloseBehaviorRequested(() =>
    callback({ preventDefault: () => undefined }),
  );
}

export async function onDesktopCloseBehaviorRequested(callback: () => void) {
  return requireElectronBridge().onCloseBehaviorRequested(callback);
}

declare global {
  interface Window {
    mcServerManager?: ElectronBridge;
  }
}
