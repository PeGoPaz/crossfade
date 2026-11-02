# Security

crossfade handles credentials for two of your accounts, so security reports are welcome and taken seriously.

## What is sensitive

- **Your Yandex Music token** - it gives access to your Yandex account's music data.
- **Your YouTube Music session** - the cookies crossfade uses to act as you on YouTube Music belong to your Google account session.
- **Your library export** - it shows what you listen to.

## How crossfade treats them

*Planned, and a rule for every change:*

- Stored only on your computer, outside the project folder, in a file only your user can read.
- Sent only to the service they belong to.
- Never written to logs, error messages, reports or test fixtures.

## Reporting a vulnerability

Please do not open a public issue. Use **Report a vulnerability** on the [Security tab](https://github.com/PeGoPaz/crossfade/security/advisories/new) of this repository, which keeps the report private until it is fixed. Expect a first reply within a week.

## Supported versions

Until the first release, only the latest commit on `main`.
