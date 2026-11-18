# Changelog

What changed in each version of crossfade, newest first. The version follows the [roadmap](README.md#roadmap): 0.4 is the milestone where the whole move, from export to import, is there. Until 1.0, a new minor version may change the commands or the file formats.

## 0.4.0 - 2026-11-18

The first numbered version: every step of the move, on the command line. It has been tested against recorded and made-up answers of both services, not yet on a whole real library from start to finish - read the dry run before you import.

### Moving a library

- `crossfade login yandex-music` signs in with a code you enter at ya.ru/device: no password typed into crossfade, no token copied by hand.
- `crossfade export` saves your liked tracks, playlists and liked albums to `library.json`, in a [documented format](docs/library-format.md). Podcasts, audiobooks and tracks Yandex Music no longer has are left out and counted.
- `crossfade match` searches YouTube Music for every track and liked album and scores the results on title, artists, version notes, duration and album. A run that stops goes on where it stopped; `--again` searches again for what was not found before.
- `crossfade review` goes through the matches crossfade is not sure of, one question each.
- `crossfade login youtube-music` takes the request headers copied from your browser, and checks that YouTube Music takes them as signed in.
- `crossfade import` likes the songs, creates the playlists or adds to the ones you have, and saves the liked albums, skipping what YouTube Music already holds. It checks the sign-in first, shows the plan, and changes nothing without a yes; `--dry-run` stops at the plan.
- `crossfade report` lists what could not be moved and why; `--csv` also saves it as a table with a search link for each track.
- `crossfade status` shows how far the move has got and the step to run next.

### Using it

- Installs as a `crossfade` command: `npm install`, then `npm install --global .` in a copy of the repository.
- No runtime dependencies, sign-ins kept in files only you can read, and every request paced, retried with backoff, and stopped when a service asks to wait too long.
- The matching rules, file formats, import plan and service clients run without Node, ready to be shared with the Firefox extension; a test keeps them that way.
