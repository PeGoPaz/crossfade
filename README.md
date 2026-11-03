<h1 align="center">crossfade</h1>

<p align="center">
  <b>Move your Yandex Music library to YouTube Music: liked tracks, playlists and albums. Runs on your computer, moves track lists only, and skips what you already have.</b>
</p>

<p align="center">
  <a href="https://github.com/PeGoPaz/crossfade/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/PeGoPaz/crossfade/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-early%20development-orange">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
</p>

---

## Contents

- [Status](#status)
- [Why](#why)
- [What it moves](#what-it-moves)
- [How it works](#how-it-works)
- [Using it](#using-it)
- [Roadmap](#roadmap)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Tech](#tech)
- [Contributing](#contributing)
- [License](#license)

---

## Status

**Early development.** The command line runs every step, from the Yandex Music export to the import into YouTube Music, and each step is tested against recorded and made-up answers of both services. It has not moved a real library from start to finish yet; until it has, read the dry run (`crossfade import --dry-run`) before you import. Liked albums are not moved yet.

---

## Why

Yandex Music has no way to export your library and no public API, and the browser extensions that used to read it stopped working after the site was redesigned. The scripts on GitHub that fill the gap mostly move music to Spotify and ask you to copy a token out of the browser by hand.

YouTube Music has an official API, but its free quota allows 100 searches a day, and each like or playlist addition costs 50 of the 10,000 daily units. Moving a library of 1,000 tracks through it would take well over a week.

crossfade is meant to do it in one run, and carefully: find each track, ask you about the ones it is unsure of, and never add the same track twice.

---

## What it moves

| Yandex Music | YouTube Music |
|---|---|
| Liked tracks | Liked songs, in the order you liked them |
| Your playlists | Playlists with the same names and track order |
| Liked albums | Albums saved to your library |

Tracks that are **already in your YouTube Music library are skipped**, so you can run crossfade after moving part of your music by hand, or run it again later.

Not moved: liked artists, podcasts and audiobooks, and tracks you uploaded to Yandex Music yourself (crossfade moves track lists, not files).

---

## How it works

1. **Export.** crossfade reads your Yandex Music library and saves it as `library.json`, a plain file in a [documented format](docs/library-format.md). You keep it as a backup even if you never move.
2. **Match.** For every track it searches YouTube Music and scores the results on title, artists, duration and album. Clear matches are accepted, doubtful ones are set aside for you, and tracks YouTube Music does not have are listed.
3. **Review.** You confirm or reject the doubtful matches.
4. **Import.** crossfade likes the tracks and creates the playlists (saving liked albums is planned). It first shows what it is going to do and asks. A run that stops can simply be started again: it looks at what YouTube Music holds by then and skips what is done.
5. **Report.** At the end you get a list of what could not be moved and why.

Each step writes its result to a file, so you can look at it, correct it, or run the next step another day.

### Matching

This is the hard part: the same recording is often written differently on the two services.

| On Yandex Music | Can appear on YouTube Music as |
|---|---|
| Кино - Группа крови | Kino - Gruppa krovi |
| Queen - Bohemian Rhapsody (Remastered 2011) | Queen - Bohemian Rhapsody |
| Nirvana - Smells Like Teen Spirit | Nirvana - Smells Like Teen Spirit (Live at Reading 1992) |

So crossfade compares titles and artists in one form (no case, accents or punctuation, Cyrillic spelled in Latin letters), reads version notes such as *Live*, *Remix* or *Remastered* so that a live recording is not taken for the studio one, and uses the duration as a check.

---

## Using it

You need Node.js 22.6 or newer. crossfade is not published as a package yet, so it runs from a copy of this repository:

```bash
git clone https://github.com/PeGoPaz/crossfade.git
cd crossfade
npm install
```

Then, one step at a time:

```bash
npm run crossfade -- login yandex-music     # enter the code it shows at ya.ru/device
npm run crossfade -- export                 # saves library.json
npm run crossfade -- match                  # saves matches.json; about 20 minutes for 1,000 tracks
npm run crossfade -- review                 # decide on the matches crossfade is not sure of
npm run crossfade -- login youtube-music    # paste the headers (below), then Ctrl+D
npm run crossfade -- import --dry-run       # what would change, changing nothing
npm run crossfade -- import                 # changes it, after you say yes
npm run crossfade -- report                 # what could not be moved, and why
```

`npm run crossfade -- help <command>` lists a command's options. Every step can be stopped and run again: it goes on where it stopped.

**Signing in to YouTube Music.** In Firefox, open music.youtube.com where you are signed in and press F12. In the Network tab, click a `POST` request to `music.youtube.com/youtubei/v1/...`, then right-click it: *Copy Value > Copy Request Headers*. On a Mac, `pbpaste | npm run crossfade -- login youtube-music` reads them straight from the clipboard. The headers hold your Google session: paste them only into crossfade, never into a chat, an issue or a screenshot.

---

## Roadmap

### v0.1 - Core, no accounts needed

- [x] Normalise titles and artists for comparison
- [x] Library file format
- [x] Match scoring

### v0.2 - Export from Yandex Music

- [x] Sign in with a code shown on screen - no password typed into crossfade, no token copied by hand
- [x] Export liked tracks, playlists and liked albums to `library.json`

### v0.3 - Matching on YouTube Music

- [x] Search YouTube Music
- [x] Read what is already in your YouTube Music library
- [x] Review doubtful matches in the terminal

### v0.4 - Import

- [x] Like tracks, make playlists or add to the ones you have
- [x] Go on after an interruption: a new run skips what is done
- [ ] Save liked albums
- [x] Final report: what could not be moved, and why
- [x] Dry run: show what would be done, skipping what is in YouTube Music already

### v1.0 - Firefox extension

- [ ] The same steps in a browser extension that works with the accounts you are already signed in to, no command line needed

---

## Privacy

- **Runs on your computer.** No server, no crossfade account, no analytics.
- **Your credentials stay with you.** The Yandex Music token and the YouTube Music session are stored only on your computer and sent only to the service they belong to. See [SECURITY.md](SECURITY.md).
- **Track lists only.** crossfade never downloads, records or streams audio.
- **Your export is yours.** `library.json` shows what you listen to. It stays on your computer unless you share it.

---

## Limitations

- **Unofficial interfaces.** Yandex Music has no public API and lets only its own apps read a library, so crossfade signs in as the Yandex Music app for Android, with that app's public client id, as other tools for this do. It talks to YouTube Music the way its website does, because the official API's quota is too small (see [Why](#why)). Either service can change these at any time and break crossfade until it is updated. Use it on your own account, at your own risk.
- **Matching is not perfect.** That is why doubtful matches go to you instead of being added silently.
- **Catalogues differ.** Some tracks are not on YouTube Music at all, or not in your country.
- **It is not instant.** crossfade spaces out its requests so that it does not look like abuse to either service.

---

## Tech

| Area | Choice |
|---|---|
| Language | TypeScript |
| Command line | Node.js 22 or newer |
| Browser extension *(planned)* | Firefox, sharing the same core as the command line |
| Runtime dependencies | None - fewer packages that could see your credentials |
| Tests | `node:test`; code that talks to a service is tested against recorded responses, offline |

---

## Contributing

Reports of broken exports and wrong matches are the most useful help right now. See [CONTRIBUTING.md](CONTRIBUTING.md). Security problems: [SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE)

---

## Author

**Vladimir Rainov** - [vladr.tech](https://vladr.tech) · [@PeGoPaz](https://github.com/PeGoPaz)
