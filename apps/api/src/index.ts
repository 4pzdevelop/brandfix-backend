import { app } from "./app";
import { env } from "./config/env";
import { ensureDefaultAdminUser } from "./services/bootstrap.service";

async function start() {
  await ensureDefaultAdminUser();

  app.listen(env.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`BrandFix API listening on http://0.0.0.0:${env.PORT}`);
  });
}

start().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start BrandFix API", error);
  process.exit(1);
});
