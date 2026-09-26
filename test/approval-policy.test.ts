import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePolicy, commandMatches } from "../server/policy.ts";
import { isSensitiveFile, filePolicyContext } from "../server/policy-paths.ts";
import { analyzeDangerousCommand } from "../server/vendor/kimi-bash/dangerous.ts";
import { parse } from "../server/vendor/kimi-bash/parse.ts";
import {
  validateSettings,
  validatePermissionRules,
} from "../server/settings.ts";
import type { PermissionRule } from "../shared/settings.ts";

// Cases adapted from Kimi be7d5f5 permissionPolicyService.test.ts (MIT).
const dangerous = [
  ["sudo reboot", "reboot"],
  ["sudo -u root reboot", "reboot"],
  ["/sbin/poweroff", "poweroff"],
  ["echo ok && shutdown now", "shutdown"],
  ["if halt; then echo x; fi", "halt"],
  ["echo $(reboot)", "reboot"],
  ["init 0", "init"],
  ["telinit 6", "telinit"],
  ["mkfs.ext4 /dev/sda1", "mkfs.ext4"],
  ["wipefs -a /dev/sda", "wipefs"],
  ["dd if=/dev/zero of=/dev/sda bs=1M", "dd"],
  ["Restart-Computer -Force", "restart-computer"],
  ["Stop-Computer", "stop-computer"],
  ["bcdedit /set x y", "bcdedit"],
  ["diskpart /s script.txt", "diskpart"],
  ["format C:", "format"],
  ["SHUTDOWN /s /t 0", "shutdown"],
  ["shut\\down -h now", "shutdown"],
  ["systemctl poweroff", "systemctl poweroff"],
  ["systemctl --user reboot", "systemctl reboot"],
  ['bash -c "shutdown now"', "shutdown"],
  ["rm -rf /tmp/build /root", "rm -rf"],
  ["rm -fr dir", "rm -rf"],
  ["rm -r -f dir", "rm -rf"],
  ["rm -R --force dir", "rm -rf"],
  ["rm -rfv dir", "rm -rf"],
  ["sudo -u root rm --recursive --force dir", "rm -rf"],
  ["echo ok && rm -rf dir", "rm -rf"],
  ["env rm -rf dir", "rm -rf"],
  ["env FOO=bar rm -rf dir", "rm -rf"],
  ["env -i FOO=bar shutdown now", "shutdown"],
  ["nohup rm -rf dir", "rm -rf"],
  ["exec reboot", "reboot"],
  ["command reboot", "reboot"],
  ["builtin shutdown now", "shutdown"],
  ["nice -n 5 poweroff", "poweroff"],
  ["nice --adjustment=5 shutdown now", "shutdown"],
  ["busybox poweroff", "poweroff"],
  ["busybox rm -rf dir", "rm -rf"],
  ['eval "shutdown now"', "shutdown"],
  ["eval rm -rf dir", "rm -rf"],
  ['bash -lc "shutdown now"', "shutdown"],
  ['bash -c "env rm -rf dir"', "rm -rf"],
  ["bash -c 'eval \"shutdown now\"'", "shutdown"],
] as const;
for (const [command, matched] of dangerous)
  test(`Kimi dangerous: ${command}`, () => {
    assert.deepEqual(analyzeDangerousCommand(command), {
      kind: "dangerous",
      command: matched,
    });
    for (const approvalMode of ["manual", "yolo"] as const) {
      const result = evaluatePolicy(
        [],
        { tool: "shell", command },
        { approvalMode, remembered: true },
      );
      assert.equal(result.reason, "dangerous-command");
      assert.equal(result.effect, "ask");
    }
    assert.equal(
      evaluatePolicy([], { tool: "shell", command }, { approvalMode: "auto" })
        .effect,
      "allow",
    );
  });

test("upstream exceptions and unknown-command behavior are preserved", () => {
  for (const command of [
    "rm -rf /tmp/build",
    "rm -rf /temp/cache",
    "echo shutdown",
    "rm -r dir",
    "rm -f file",
    "command -v rm",
    "dd if=/dev/zero of=/dev/null",
    "npm install",
    "npm test",
    "curl https://example.com",
  ]) {
    assert.equal(analyzeDangerousCommand(command), undefined, command);
    assert.equal(
      evaluatePolicy([], { tool: "shell", command }).effect,
      "allow",
    );
  }
  for (const command of [
    "$CMD --force",
    'bash -c "echo $HOME"',
    'echo "unterminated',
  ]) {
    assert.equal(
      evaluatePolicy([], { tool: "shell", command }, { approvalMode: "manual" })
        .reason,
      "unanalyzable-command",
    );
    assert.equal(
      evaluatePolicy([], { tool: "shell", command }, { approvalMode: "yolo" })
        .effect,
      "allow",
    );
  }
  assert.equal(parse("echo hello", { maxNodes: 1 }).ok, false);
  assert.equal(parse("echo hello", { timeoutMs: 0 }).ok, false);
});

const rule = (effect: PermissionRule["effect"]): PermissionRule => ({
  id: effect,
  scope: "global",
  tool: "*",
  effect,
});
test("Kimi strategy ordering, guard toggle, and Apsis hard limits", () => {
  const request = { tool: "shell", command: "echo hello" };
  assert.equal(
    evaluatePolicy([rule("deny")], request, {
      approvalMode: "auto",
      remembered: true,
    }).effect,
    "deny",
  );
  assert.equal(
    evaluatePolicy([rule("ask")], request, { approvalMode: "auto" }).effect,
    "allow",
  );
  assert.equal(
    evaluatePolicy([rule("ask")], request, { remembered: true }).reason,
    "session-approval",
  );
  assert.equal(
    evaluatePolicy([rule("allow")], { ...request, command: "shutdown now" })
      .effect,
    "ask",
  );
  assert.equal(
    evaluatePolicy(
      [],
      { ...request, command: "shutdown now" },
      { dangerousCommandGuard: false },
    ).effect,
    "allow",
  );
  for (const approvalMode of ["manual", "yolo", "auto"] as const)
    assert.equal(
      evaluatePolicy(
        [rule("allow")],
        { ...request, readonly: true },
        { approvalMode },
      ).effect,
      "deny",
    );
  for (const tool of ["mcp_call", "browser", "write_file", "unknown_tool"]) {
    assert.equal(
      evaluatePolicy([], { tool }, { approvalMode: "manual" }).effect,
      "ask",
    );
    assert.equal(
      evaluatePolicy([], { tool }, { approvalMode: "yolo" }).effect,
      "allow",
    );
  }
  assert.equal(
    evaluatePolicy(
      [],
      { tool: "browser", action: "navigate" },
      { approvalMode: "manual" },
    ).effect,
    "allow",
  );
  assert.equal(
    evaluatePolicy(
      [],
      { tool: "write_file", path: "file.txt" },
      { approvalMode: "manual", gitWorkspace: true },
    ).reason,
    "git-workspace",
  );
});

test("sensitive names and Git path guards preserve upstream exceptions", async (t) => {
  for (const path of [
    ".env",
    ".env.local",
    "id_rsa",
    "id_ed25519.old",
    "credentials-prod",
    "x/.aws/credentials/token",
    ".git/config",
  ])
    assert.equal(
      evaluatePolicy([], { tool: "read_file", path }).effect,
      "ask",
      path,
    );
  for (const path of [
    ".env.example",
    ".env.sample",
    ".env.template",
    "id_rsa.pub",
    "credentials.txt",
  ])
    assert.equal(isSensitiveFile(path), false, path);
  assert.equal(
    evaluatePolicy([rule("allow")], { tool: "read_file", path: ".env" }).effect,
    "allow",
  );
  assert.equal(
    evaluatePolicy(
      [],
      { tool: "read_file", path: ".env" },
      { approvalMode: "auto" },
    ).effect,
    "allow",
  );
  const dir = await mkdtemp(join(tmpdir(), "apsis-policy-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "repo"));
  await mkdir(join(dir, "control"));
  await writeFile(join(dir, "repo", ".git"), "gitdir: ../control\n");
  assert.equal(
    filePolicyContext(join(dir, "repo"), "file.txt").gitWorkspace,
    true,
  );
  assert.equal(filePolicyContext(dir, "repo/.git").gitControl, true);
  assert.equal(
    filePolicyContext(join(dir, "repo"), "../control/config").gitControl,
    true,
  );
});

test("settings and whole-command glob validation", () => {
  assert.equal(validateSettings({}).approvalMode, "yolo");
  assert.equal(validateSettings({}).dangerousCommandGuard, true);
  assert.throws(() => validateSettings({ approvalMode: "smart" }));
  assert.throws(() => validateSettings({ dangerousCommandGuard: "yes" }));
  assert.throws(() =>
    validatePermissionRules([
      { ...rule("allow"), tool: "read_file", commandPattern: "*" },
    ]),
  );
  const rules = validatePermissionRules([
    { ...rule("ask"), tool: "shell", commandPattern: "npm run *" },
  ]);
  assert.equal(
    evaluatePolicy(rules, { tool: "shell", command: "npm run build" }).effect,
    "ask",
  );
  assert.equal(
    evaluatePolicy(rules, { tool: "shell", command: "echo npm run build" })
      .effect,
    "allow",
  );
  assert.equal(commandMatches("echo \\*", "echo *"), true);
  assert.equal(commandMatches("git ?tatus", "git status"), true);
  assert.equal(commandMatches("echo *", "echo /tmp/foo\necho bar"), true);
});
