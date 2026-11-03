/**
 * Signing in to Yandex Music with a code, the way a TV signs in: crossfade
 * asks Yandex for a short code, you enter it at ya.ru/device in a browser
 * where you are signed in, and Yandex gives crossfade a token. Your password
 * never passes through crossfade.
 *
 * Yandex lets only its own apps read music libraries, so crossfade signs in
 * as the Yandex Music app for Android, with that app's public client id and
 * secret - as every other tool for this does. Yandex can withdraw them at any
 * time; README.md lists this among the limitations.
 */

import { type Clock, Requests } from '../requests.ts';

const OAUTH = 'https://oauth.yandex.ru';
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
const CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300';

export interface DeviceCode {
  /** What you type at verificationUrl. */
  userCode: string;
  verificationUrl: string;
  /** Kept between crossfade and Yandex. */
  deviceCode: string;
  /** How often Yandex wants to be asked whether the code was entered. */
  intervalMs: number;
  expiresAt: number;
}

export interface YandexToken {
  token: string;
  /** When Yandex said the token stops working. */
  expiresAt: number;
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

/** How much longer to wait between checks when Yandex says to slow down. */
const SLOW_DOWN_MS = 5000;

export async function requestCode(requests: Requests, clock: Clock, random = randomId): Promise<DeviceCode> {
  const response = await requests.fetch(`${OAUTH}/device/code`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, device_id: random(), device_name: 'crossfade' }),
  });
  const answer = (await response.json()) as Record<string, unknown>;
  const { device_code, user_code, verification_url, interval, expires_in } = answer;
  if (
    typeof device_code !== 'string' ||
    typeof user_code !== 'string' ||
    typeof verification_url !== 'string' ||
    typeof interval !== 'number' ||
    typeof expires_in !== 'number'
  ) {
    throw new SignInError('Yandex answered the request for a code in an unexpected way; crossfade may need an update');
  }
  return {
    userCode: user_code,
    verificationUrl: verification_url,
    deviceCode: device_code,
    intervalMs: interval * 1000,
    expiresAt: clock.now() + expires_in * 1000,
  };
}

/** Asks Yandex, as often as it allows, whether the code was entered, until it was or it expired. */
export async function waitForToken(requests: Requests, clock: Clock, code: DeviceCode): Promise<YandexToken> {
  let interval = code.intervalMs;
  while (clock.now() < code.expiresAt) {
    await clock.sleep(interval);
    const response = await requests.fetch(
      `${OAUTH}/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'device_code',
          code: code.deviceCode,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      },
      { accept: [400] },
    );
    const answer = (await response.json()) as Record<string, unknown>;
    if (response.ok) {
      const { access_token, expires_in } = answer;
      if (typeof access_token !== 'string' || typeof expires_in !== 'number') {
        throw new SignInError('Yandex answered with a token crossfade does not understand; crossfade may need an update');
      }
      return { token: access_token, expiresAt: clock.now() + expires_in * 1000 };
    }
    switch (answer.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += SLOW_DOWN_MS;
        continue;
      case 'access_denied':
        throw new SignInError('The sign-in was declined on the Yandex page.');
      case 'invalid_grant':
      case 'expired_token':
        throw expired();
      default:
        throw new SignInError(`Yandex refused the sign-in: ${String(answer.error_description ?? answer.error)}`);
    }
  }
  throw expired();
}

function expired(): SignInError {
  return new SignInError('The code expired before it was entered. Run "crossfade login yandex-music" again.');
}

/** Ten letters and digits naming this device to Yandex; a new one each time, as the Android app does. */
function randomId(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => letters[byte % letters.length]).join('');
}
