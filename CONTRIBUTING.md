# Contributing to crossfade

Thanks for helping. crossfade is at an early stage, and the most useful contributions right now are reports:

- **Something broke after a service changed.** Yandex Music and YouTube Music can change their interfaces without notice. Open a [bug report](https://github.com/PeGoPaz/crossfade/issues/new?template=bug_report.yml) with the step that failed and the error.
- **A wrong match.** If crossfade picked the wrong YouTube Music track, or found nothing for a track that is there, open a [wrong match](https://github.com/PeGoPaz/crossfade/issues/new?template=wrong_match.yml) report with both tracks. Each one becomes a test.

## Ground rules

1. **Track lists only.** crossfade does not download, record or stream audio, and pull requests that do will not be accepted. Neither will anything that gets around a paywall or a region lock.
2. **No personal data in the repository.** Never commit or paste tokens, cookies, request headers or your real library export - not in code, tests, issues or screenshots. Test fixtures are recorded responses cut down to what the test needs, with user ids, playlist names and other personal details replaced. Public track and artist names are fine.
3. **No runtime dependencies** without agreeing on it in an issue first. crossfade handles people's sessions, and every package it loads could read them.
4. **Tests come with the change.** Rules such as normalisation and matching are tested directly. Code that talks to a service is tested against recorded responses, never the live service, so the tests pass offline.
5. **Go easy on the services.** No bursts of parallel requests: keep the pacing, and back off when a service says to slow down.

## Pull requests

- One logical change per pull request.
- Commit messages in the imperative mood, capitalised, without a prefix or a trailing period, about 50 characters at most: `Skip tracks already liked on YouTube Music`.
- Say in the description what changed and how you checked it.
- A change people using crossfade will notice gets a line in [CHANGELOG.md](CHANGELOG.md), under a heading for the next version.

## Development

You need Node.js 22.6 or newer. Development needs no build step: Node runs the TypeScript files directly by dropping the types, which is why the code sticks to TypeScript syntax that can simply be erased (no `enum`, no `namespace`, no parameter properties) and imports files with their `.ts` extension.

```bash
npm install         # TypeScript and Node's type definitions, then npm run build
npm test            # the tests, with node:test
npm run typecheck   # tsc, without writing any files
npm run crossfade -- help   # the crossfade command, run from the source
npm run build       # compiles src/ to plain JavaScript in dist/
```

The installed `crossfade` command runs `dist/`, so it needs neither TypeScript nor a recent Node.js flag. `npm install` builds it. To try your copy as the installed command, run `npm install --global .` in it: that links the command to your copy, so run `npm run build` again after a change.

CI runs the type check and the tests on Node.js 22 and on the newest LTS for every push and pull request, then packs crossfade, installs it the way a user would and runs the command.

Code lives in `src/`, tests in `test/`, one test file per module: `src/text.ts` is tested by `test/text.test.ts`.

### Code shared with the browser extension

The Firefox extension planned for v1.0 is to use the same matching rules, file formats, import plan and service clients as the command line. Those modules - listed in `test/core.test.ts` - must therefore run in a browser: they use `fetch`, `crypto.subtle` and `TextEncoder`, never Node's modules (`node:fs`, `node:readline`, ...) or its globals (`process`, `Buffer`). Files, the terminal and the credential store live in the modules around them. `test/core.test.ts` follows every runtime import of the shared modules and fails with the chain of files that leads to Node, so a stray import is caught in review rather than when the extension is built.
