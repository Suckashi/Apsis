# Versions, releases and backups

## Version policy

Alpha releases use `0.x.y-alpha.N` and Git tags such as `v0.2.0-alpha.1`. They are published as GitHub prereleases. `main` is the development branch; install a tagged release for a reproducible version. The current distribution is source with a lockfile, not an npm package or desktop binary.

During Alpha, public APIs, checkpoint formats and storage may change. A release must state the accepted data schema, any incompatible changes, and whether migration is provided. The current release accepts schema 4 and checkpoint version 1 tagged `deepagents@1.14.0`; older stores are rejected without rewriting them. There is no automatic import of `.apsis/`.

A schema number alone does not guarantee that two releases can interchange checkpoints or all configuration. Follow the specific release notes. Never open newer data with older code as a rollback strategy; restore the stopped backup made with that older release instead. External changes made by tools need their own recovery procedure.

Security fixes target the latest prerelease. Stable release support and stronger compatibility guarantees will be defined before 1.0; they are not promised by Alpha.

## Upgrade

1. Read the target release's changes, data compatibility and known limitations.
2. Stop Apsis and wait for the process to exit. Back up the complete data directory, `.env`, environment-variable secret configuration and external workspaces separately.
3. Install the target tag in a new source directory with `npm ci`. Install Chromium if using browser tools.
4. Set `APSIS_DATA_DIR` in that checkout's `.env` to your existing **absolute** data-directory path. Do not run both checkouts against the same data directory.
5. Run `npm start`; check the selected data location, Bot roster, history, settings and published results before starting work.

If the release requires a new store and offers no migration, preserve the old data and use a different empty absolute directory. Do not rename old databases to make startup accept them.

## Backup and restore

The default is `<source-checkout>/.apsis-v4`; `APSIS_DATA_DIR` selects a custom location. Back up the **entire directory**, including hidden files, both SQLite databases, settings, MCP configuration, journals, checkpoints, artifacts, browser state and the default workspace. Do not copy an actively running store or select only individual database files.

Linked projects, work folders outside the data directory, `~/.agents/skills`, `.env` and environment-variable secret values are not covered by that directory backup. Back them up separately. Project and work-location references can contain absolute paths; moving a data directory does not rewrite them. Protect backups like the original private data.

After Apsis has stopped, these examples copy a complete directory to a **new destination**. They deliberately do not delete or overwrite the source. Replace the example paths with your resolved absolute paths, and retain a note of the associated release tag.

PowerShell:

```powershell
$apsisSource = (Resolve-Path -LiteralPath 'D:\ApsisData').Path
$apsisBackup = 'D:\ApsisBackups\v0.2.0-alpha.1-2026-10-02'
if (Test-Path -LiteralPath $apsisBackup) { throw 'Choose a new backup destination.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $apsisBackup) -Force | Out-Null
Copy-Item -LiteralPath $apsisSource -Destination $apsisBackup -Recurse
```

Bash:

```sh
apsis_source="/home/you/apsis-data"
apsis_backup="/home/you/apsis-backups/v0.2.0-alpha.1-2026-10-02"
test -d "$apsis_source" || exit 1
test ! -e "$apsis_backup" || exit 1
mkdir -p "$(dirname "$apsis_backup")"
cp -a "$apsis_source" "$apsis_backup"
```

To restore, stop Apsis, retain the failed/current directory, and copy the backup into another **new** directory using the same procedure with backup as source. Use the source release associated with that backup, point `APSIS_DATA_DIR` to the restored copy, and confirm external work folders remain at their recorded paths. When checking a restored store, keep it isolated from outbound services until you have reviewed its enabled schedules and credentials: enabled routines can execute after startup, including one catch-up run.

Verify the Bot roster, a known conversation, settings, a downloaded artifact and its recorded work folder. Reconnect referenced environment variables. A backup is useful only when you can reopen it and read the expected data. Run `node --test test/backup-restore.test.ts` for the project's isolated integration check; it uses stopped copies and a disabled schedule, not your real data or an external model.

## Maintainer release procedure

1. Update `package.json` and lockfile versions together, the current installation tag in both READMEs and getting-started guides, `CHANGELOG.md`, and `docs/releases/<version>.md`.
2. Record data/checkpoint compatibility, breaking changes, known limitations and validation in those notes. Historical changes before the first public tag are summarized as a baseline, not invented older releases.
3. Run `npm run check:docs`, `npm run build`, `npm test`, and the chat/Bot/settings browser checks. Review the working tree and license notices. Use synthetic screenshots.
4. Commit and push the reviewed change; confirm both CI platforms pass for that commit.
5. Create an annotated version tag on that exact commit and push it. The [release workflow](../.github/workflows/release.yml) repeats the reusable verification workflow, runs `npm run test:release` to install/build/start the committed source archive in a temporary directory, validates tag/package/lockfile/notes, then publishes a release using the checked-in notes. A prerelease suffix makes it a prerelease.
6. Verify the release URL, tag commit and source archive contents. Do not move a published tag to repair a release; fix forward with a new version. If a tag check fails before publication, inspect the failure before retrying.

GitHub permissions protect the ability to push tags. The workflow uses read-only verification permissions and grants release-write access only to the publication job. This process does not publish npm packages or execute model-backed tasks.
