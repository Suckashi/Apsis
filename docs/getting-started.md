# Getting started

[繁體中文](getting-started.zh-TW.md) · [Documentation index](README.md)

## 1. Install a known version

Install Node.js 22.19+ with npm and Git. Windows and Ubuntu with Node.js 22.19 are tested in CI; macOS is not yet verified. Git for Windows provides Bash for Shell tools. Linux uses system Bash.

```sh
git clone --branch v0.2.0-alpha.2 https://github.com/Suckashi/Apsis.git
cd Apsis
npm ci
npx playwright install chromium
npm start
```

On Linux, install missing browser libraries with `npx playwright install --with-deps chromium`. This may require administrator privileges. Basic chat does not require a browser or Bash. Source ZIP downloads from the release page can be extracted and started with the same npm commands. Keep development dependencies installed: the source-based start command builds the UI and checks TypeScript.

Wait for the terminal to print the local URL, then open <http://localhost:3100>. Stop with Ctrl+C and wait for the process to exit before copying application data.

## 2. Connect a model

Open **Settings & Tools → Model connections**, add a provider and choose a model ID available to that provider. Configure the API key and API URL required by your service. Use the connection test to check both streaming and tool calls, then select the connection/model as the default. A valid HTTP connection alone does not establish tool support.

For Ollama, start its service separately, install a tool-capable model, use `http://127.0.0.1:11434`, and enter its exact installed model ID. For an OpenAI-compatible service, use the base URL documented by that service. Model limits and behavior vary; set its context window to the provider's actual supported capacity rather than assuming the application's default fits it.

API services may charge for model calls. Credentials remain server-side, but the configured provider receives the task context required to answer. See [security](../SECURITY.md) and [configuration files](config-files-design.md).

## 3. Finish your first task

Select the initial Bot, or create one with a name, role and model. Send:

> Create `hello.md` in the current working folder with a short introduction to Apsis. Publish it as a downloadable result and tell me what you checked.

If a tool asks for approval, inspect the operation and decide whether to allow it. Expand work details to see recorded operations. For the first task, use the automatically assigned working folder rather than linking an important repository.

Check all four outcomes:

1. A final reply explains the result without claiming unverified work.
2. The **Files** panel contains `hello.md` and can read it.
3. A published artifact can be downloaded and its contents match the file.
4. Reloading the page preserves the conversation and result.

![Completed conversation and published result](assets/conversation.png)

_This screenshot uses isolated demonstration data and a fixed model fixture. Real models may need a correction to write and publish the file successfully._

While work is running, another message adds instructions; its receipt says whether they were applied. Stopping does not undo completed operations. **Start a new topic** changes the working context while preserving history.

## 4. Try representative work

- **Repository:** start a new topic, link a disposable clone through chat options, request one focused change, inspect the diff and ask for verification.
- **Document:** attach non-sensitive source material, ask for a report with its sources, then preview and download it.
- **Schedule:** create a simple routine with a timezone, test it, inspect the result and pause it when finished. The app must stay running; resuming can run one catch-up execution.

Use [Alpha acceptance](alpha-acceptance.md) to record real provider and multi-day usage separately from automated fixture tests.

## Data location and configuration

Defaults are `.apsis-v4/` for application data and `.apsis-v4/workspace/` for default work files. You can copy `.env.example` to `.env` using your editor and set:

```dotenv
PORT=3100
# Use an absolute directory to keep data separate from a source checkout.
# APSIS_DATA_DIR=/absolute/path/to/apsis-data
```

On Windows, a value such as `D:/ApsisData` is an absolute path. On Linux, use a path such as `/home/you/apsis-data`. Moving the application directory does not move linked projects, external work folders, shared skills or environment-variable secrets. See [backup and restore](releases.md#backup-and-restore).

## Troubleshooting

| Symptom                                    | Next check                                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm or TypeScript startup fails            | Run `node --version`, confirm Node.js 22.19+, run `npm ci` without omitting development dependencies, and retain sanitized terminal errors.                                                           |
| Port 3100 is occupied                      | Stop the other Apsis instance or set another `PORT` in `.env`, restart, and open the printed URL.                                                                                                     |
| Model cannot connect                       | Check the service is running, exact model ID, credentials, endpoint and provider type; rerun the streaming/tool test. Do not paste secrets into an issue.                                             |
| Browser tool cannot launch                 | Run `npx playwright install chromium`; Linux may need `--with-deps`. `APSIS_BROWSER_PATH` can specify an installed browser executable.                                                                |
| Shell is unavailable                       | Install Git for Windows or system Bash; `APSIS_SHELL_PATH` can specify an absolute Bash executable.                                                                                                   |
| Startup rejects or cannot find stored data | Keep the directory intact. Check `APSIS_DATA_DIR`, format/version and missing files; restore a complete stopped backup rather than deleting database files. Schema 3 is not imported by this release. |
| Work is interrupted after restart          | Inspect the transcript and operation journal before sending a new request. External side effects are not automatically replayed or rolled back.                                                       |

For unresolved problems, use the [bug report form](https://github.com/Suckashi/Apsis/issues/new/choose) with release/commit, OS, Node version, provider type and a minimal sanitized reproduction.
