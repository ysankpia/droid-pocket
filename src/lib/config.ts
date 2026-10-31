import { Preferences } from "@capacitor/preferences";

/**
 * A connection to the bridge running on the user's computer.
 *
 * There is deliberately no API key here: every turn is executed by the `droid`
 * CLI on the computer, using that machine's own login and BYOK models.
 */
export interface ConnectionConfig {
  url: string;
  token: string;
  cwd: string;
  name?: string;
}

export interface PairingPayload {
  v: number;
  u: string;
  t: string;
  n?: string;
}

const KEY = "droid-pocket.connection";

export const DEFAULT_CONFIG: ConnectionConfig = {
  url: "",
  token: "",
  cwd: "",
};

export function normalizeUrl(value: string): string {
  let url = value.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (url.startsWith("ws://")) url = `http://${url.slice(5)}`;
  if (url.startsWith("wss://")) url = `https://${url.slice(6)}`;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

/** Decode the `dp1.<base64url>` code printed by the bridge. */
export function parsePairingCode(code: string): PairingPayload | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("dp1.")) return null;
  try {
    const raw = trimmed.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as PairingPayload;
    if (
      !parsed ||
      typeof parsed.u !== "string" ||
      typeof parsed.t !== "string"
    ) {
      return null;
    }
    return { ...parsed, u: normalizeUrl(parsed.u) };
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<ConnectionConfig> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return DEFAULT_CONFIG;
    const parsed = JSON.parse(value) as Partial<ConnectionConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: ConnectionConfig): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(config) });
}

export async function clearConfig(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
