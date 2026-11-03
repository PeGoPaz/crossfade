/**
 * Acting as you on YouTube Music from the command line, the way ytmusicapi
 * does: you copy the request headers of one request the site makes while
 * you are signed in, and crossfade keeps the cookie from them. Each request
 * then carries the cookie and an Authorization header the site would send:
 * SAPISIDHASH, a SHA-1 of the time, the SAPISID cookie and the site's
 * origin.
 *
 * The cookie is your Google session. It is kept like the Yandex token, in a
 * file only you can read (see SECURITY.md), and nothing else from the
 * copied headers is kept. The browser extension will not need any of this:
 * there the browser sends the cookie itself.
 */

import type { Requests } from '../requests.ts';
import { context } from './search.ts';

export const ORIGIN = 'https://music.youtube.com';

export interface YouTubeSession {
  cookie: string;
  /** Which of the Google accounts signed in to the browser: 0 for the first. */
  authUser: string;
  /** The browser's, so that requests with its cookie look like its own. */
  userAgent?: string;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * Reads headers as Firefox and Chrome copy them: "Name: value" lines, or a
 * "Copy as cURL" command with -H options. Only the cookie, the account
 * number and the user agent are taken; everything else is let go.
 */
export function parseHeaders(text: string): YouTubeSession {
  const headers = new Map<string, string>();
  const pairs = text.trimStart().startsWith('curl ')
    ? [...text.matchAll(/-H\s+(?:'([^']*)'|"([^"]*)")/g)].map(([, single, double]) => single ?? double ?? '')
    : text.split(/\r?\n/);
  for (const pair of pairs) {
    const at = pair.indexOf(': ');
    if (at > 0) {
      headers.set(pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 2).trim());
    }
  }
  const cookie = headers.get('cookie');
  if (!cookie || !sapisid(cookie)) {
    throw new SessionError(
      'These headers have no YouTube sign-in cookie. Copy them from a request to music.youtube.com made while you are signed in.',
    );
  }
  const userAgent = headers.get('user-agent');
  return { cookie, authUser: headers.get('x-goog-authuser') ?? '0', ...(userAgent ? { userAgent } : {}) };
}

/** The cookie the Authorization header is made from: __Secure-3PAPISID, or SAPISID in older sessions. */
export function sapisid(cookie: string): string | undefined {
  const values = new Map(
    cookie.split(';').map(part => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  return values.get('__Secure-3PAPISID') || values.get('SAPISID') || undefined;
}

/** "SAPISIDHASH <seconds>_<sha1 of 'seconds SAPISID origin'>", the header the site sends with each request. */
export async function authorization(session: YouTubeSession, now: number): Promise<string> {
  const seconds = Math.floor(now / 1000);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${seconds} ${sapisid(session.cookie)} ${ORIGIN}`));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${seconds}_${hex}`;
}

/** The headers for a request made as you. */
export async function sessionHeaders(session: YouTubeSession, now: number): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    Cookie: session.cookie,
    Authorization: await authorization(session, now),
    'X-Goog-AuthUser': session.authUser,
    'X-Origin': ORIGIN,
    Origin: ORIGIN,
    ...(session.userAgent ? { 'User-Agent': session.userAgent } : {}),
  };
}

/** The name of the account the session belongs to; throws if YouTube Music does not take the session as signed in. */
export async function accountName(requests: Requests, session: YouTubeSession, now: () => number): Promise<string> {
  const response = await requests.fetch(`${ORIGIN}/youtubei/v1/account/account_menu?prettyPrint=false`, {
    method: 'POST',
    headers: await sessionHeaders(session, now()),
    body: JSON.stringify({ context: context(now()) }),
  });
  const answer = (await response.json()) as AccountMenu;
  const name = answer.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer?.accountName?.runs?.[0]?.text;
  if (!name) {
    throw new SessionError('YouTube Music does not take these headers as signed in. Copy them again from a fresh request.');
  }
  return name;
}

interface AccountMenu {
  actions?: {
    openPopupAction?: {
      popup?: {
        multiPageMenuRenderer?: {
          header?: { activeAccountHeaderRenderer?: { accountName?: { runs?: { text?: string }[] } } };
        };
      };
    };
  }[];
}
