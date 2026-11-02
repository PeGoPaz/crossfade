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

## Development

The project has no code yet. Setup and test commands will be described here with the first module.
