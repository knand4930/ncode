// src/utils/os.ts

export const isMac = () => {
  if (typeof window === "undefined") return false;
  return navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
};

export const isWindows = () => {
  if (typeof window === "undefined") return false;
  return navigator.userAgent.toUpperCase().indexOf("WIN") >= 0;
};

export const isLinux = () => {
  if (typeof window === "undefined") return false;
  return navigator.userAgent.toUpperCase().indexOf("LINUX") >= 0;
};

/**
 * Formats a generic keyboard shortcut string into a platform-specific one.
 * E.g., "Ctrl+P" becomes "⌘P" on macOS and "Ctrl+P" on Windows/Linux.
 */
export const formatShortcut = (keys: string): string => {
  if (!isMac()) {
    // On Windows/Linux, most shortcuts stay as-is but we might want to normalize
    // specific keys if needed. For now, we return the string but maybe replace "Meta" with "Win" / "Super".
    return keys.replace(/Meta/g, isWindows() ? "Win" : "Super");
  }

  // macOS replacements
  let formatted = keys
    .replace(/Ctrl/g, "⌘")
    .replace(/Shift/g, "⇧")
    .replace(/Alt/g, "⌥")
    .replace(/Meta/g, "⌘") // Often Meta is used interchangeably with Command
    .replace(/\+/g, "");   // macOS typically doesn't use '+' between keys

  return formatted;
};
