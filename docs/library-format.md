# The library file

`crossfade export` saves your library as `library.json`. It is plain JSON, so you can read it, keep it as a backup, correct it by hand, or write a file like it from another service. crossfade checks the file each time it reads it and lists any problems with their place in the file, for example `tracks[12].title: should be a non-empty string`.

## Example

```json
{
  "format": "crossfade-library",
  "version": 1,
  "source": "yandex-music",
  "exportedAt": "2026-11-03T08:30:00Z",
  "tracks": [
    {
      "id": "1",
      "title": "Группа крови",
      "artists": ["Кино"],
      "album": "Группа крови",
      "year": 1988,
      "durationMs": 286000
    },
    {
      "id": "2",
      "title": "Bohemian Rhapsody",
      "version": "Remastered 2011",
      "artists": ["Queen"],
      "durationMs": 354000,
      "isrc": "GBUM71029604"
    }
  ],
  "liked": [
    { "track": "2", "likedAt": "2024-05-01T10:00:00+03:00" },
    { "track": "1" }
  ],
  "playlists": [
    { "id": "1003", "title": "Дорога", "description": "", "tracks": ["1", "2", "1"] }
  ],
  "albums": [
    { "id": "55", "title": "Группа крови", "artists": ["Кино"], "year": 1988, "trackCount": 11 }
  ]
}
```

Each track is listed once, in `tracks`. Likes and playlists refer to it by its `id`, so a track that is liked and sits in three playlists is looked up on YouTube Music once.

## Fields

### The file

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `"crossfade-library"`. |
| `version` | yes | The version of this format, now `1`. |
| `source` | yes | The service it was exported from, e.g. `"yandex-music"`. |
| `exportedAt` | yes | When it was exported, as an ISO 8601 date and time with a time zone. |
| `tracks` | yes | Every track the likes and playlists refer to. |
| `liked` | yes | Liked tracks. |
| `playlists` | yes | Your playlists. |
| `albums` | yes | Liked albums. |

Lists may be empty, but must be there.

### `tracks`

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | The track's id on the source service. Unique in the file. |
| `title` | yes | The title as the service shows it. |
| `version` | no | A note the service keeps apart from the title, like `"Live"` or `"Remastered 2011"`. |
| `artists` | yes | Artist names. May be empty when the service names none. |
| `album` | no | The album title. |
| `year` | no | The year of release. |
| `durationMs` | no | The length in milliseconds. |
| `isrc` | no | The International Standard Recording Code: 12 letters and digits, like `GBUM71029604`. |

### `liked`

| Field | Required | Meaning |
|---|---|---|
| `track` | yes | The `id` of a track in `tracks`. A track is liked once. |
| `likedAt` | no | When it was liked. crossfade uses it to like the tracks in the same order on YouTube Music. |

### `playlists`

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | The playlist's id on the source service. Unique in the file. |
| `title` | yes | The playlist's name. |
| `description` | no | Its description. |
| `tracks` | yes | Track ids in playlist order. A track may appear more than once. |

### `albums`

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | The album's id on the source service. Unique in the file. |
| `title` | yes | The album title. |
| `artists` | yes | Artist names. May be empty. |
| `year` | no | The year of release. |
| `trackCount` | no | How many tracks it has. Helps tell an album from its deluxe edition. |
| `likedAt` | no | When it was liked. |

Fields not listed here are ignored, so a newer crossfade can add fields that an older one still reads. A change an older crossfade could misread gets a new `version`, and an older crossfade refuses such a file rather than guess.
