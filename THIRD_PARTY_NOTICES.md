# Third-party notices

Apsis's own code and documentation are distributed under [Apache License 2.0](LICENSE). Third-party materials retain their original licenses; the project license does not replace them.

## Vendored Kimi Bash code

- Source: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code/tree/be7d5f5fea7800778e4660cd5f36780ba783bddd).
- Copyright: © 2026 Moonshot AI.
- License: [MIT](server/vendor/kimi-bash/LICENSE), retained in the vendored directory.
- Components: seven TypeScript Bash parser modules and the dangerous-command policy, including upstream reference text.
- Local adaptations: rewritten imports, expanded constructor parameter properties for Node's TypeScript loader, and a pure-function policy adapter. See the [vendoring notes](server/vendor/kimi-bash/README.md).

## Installed dependencies

The source distribution records npm dependencies in [package.json](package.json) and [package-lock.json](package-lock.json). Installed dependencies and the Chromium browser are separate third-party software with their own license files and notices. Redistributors of installed or bundled dependencies must retain the notices required by those components. This file documents vendored source; it is not an assertion that all dependencies are Apache-licensed.
