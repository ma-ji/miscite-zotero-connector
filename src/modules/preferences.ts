/**
 * Preferences pane logic — handles test connection button and UI events.
 */
import { MisciteApiClient } from "./miscite-api";
import { log } from "./utils";

export async function onTestConnection(): Promise<void> {
  try {
    const api = new MisciteApiClient();
    const result = await api.testConnection();
    log(`Connection successful: ${result.email}`);

    const ps = Services.prompt;
    ps.alert(
      null,
      "miscite Connection",
      `Connected successfully!\n\nUser: ${result.email}`,
    );
  } catch (err) {
    log(`Connection test failed: ${err}`);

    const ps = Services.prompt;
    ps.alert(
      null,
      "miscite Connection Failed",
      `Could not connect to miscite server.\n\n${String(err)}`,
    );
  }
}
