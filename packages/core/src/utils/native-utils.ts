export function isNative(): boolean {
  return typeof window !== "undefined" && "electronAPI" in window;
}

/**
 * Returns true if the Electron app is running in debug mode.
 * Always false when not running in Electron.
 */
export async function isDebugMode(): Promise<boolean> {
  if (!isNative()) return false;
  return (window as any)["electronAPI"]["isDebugMode"]() === true;
}
