import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.droidpocket.mobile",
  appName: "Droid Pocket",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
