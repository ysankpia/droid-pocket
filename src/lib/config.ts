import { Preferences } from "@capacitor/preferences";

export interface ConnectionConfig {
  url: string;
  apiKey: string;
  cwd: string;
}

const KEY = "droid-pocket.config";

export const DEFAULT_CONFIG: ConnectionConfig = {
  url: "",
  apiKey: "",
  cwd: "",
};

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
