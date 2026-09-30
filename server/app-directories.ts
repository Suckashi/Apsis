import { join, resolve } from "node:path";

export const DEFAULT_DATA_DIR = ".apsis-v4";

export interface DirectoryOptions {
  dataDir?: string;
  workspaceDir?: string;
}

/** One directory policy for the app, sharing and live model verification. */
export function appDirectories(
  options: DirectoryOptions = {},
  environment: { APSIS_DATA_DIR?: string } = process.env,
) {
  const dataDir = resolve(
    options.dataDir || environment.APSIS_DATA_DIR?.trim() || DEFAULT_DATA_DIR,
  );
  return {
    dataDir,
    workspaceDir: resolve(options.workspaceDir || join(dataDir, "workspace")),
  };
}
