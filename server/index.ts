import { asError } from "../shared/errors.ts";
import { createApp } from "./app.ts";
const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必須是 1–65535 的整數。");
const { server } = await createApp(
  process.env.APSIS_LEGACY === "1"
    ? {}
    : {
        productMode: true,
        dataDir: ".apsis",
        workspaceDir: ".apsis/workspace",
      },
);
server.listen(port, "127.0.0.1", () =>
  console.log(
    "\n  Apsis  /  http://localhost:" +
      port +
      "\n  Node.js agent workspace · Ctrl+C to stop\n",
  ),
);
server.on("error", (error) => {
  console.error(
    asError(error).code === "EADDRINUSE"
      ? "Port " + port + " 已被使用；請修改 .env 的 PORT。"
      : error.message,
  );
  process.exitCode = 1;
});
