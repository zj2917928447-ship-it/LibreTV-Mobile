import { afterEach, describe, expect, it } from 'vitest';
import Artplayer from 'artplayer';
import {
  APP_FULLSCREEN_WEB_IN_BODY,
  ART_DEFAULT_FULLSCREEN_WEB_IN_BODY,
  configureArtPlayerGlobals,
  restoreArtPlayerGlobals,
} from './artplayer-globals';
import {
  ART_DEFAULT_CONTROL_HIDE_MS,
  DESKTOP_CONTROL_HIDE_MS,
  TOUCH_CONTROL_HIDE_MS,
} from './control-hide';

afterEach(() => {
  restoreArtPlayerGlobals(Artplayer);
});

describe('ArtPlayer shared global settings', () => {
  it('matches the installed library fullscreen default', () => {
    expect(ART_DEFAULT_FULLSCREEN_WEB_IN_BODY).toBe(Artplayer.FULLSCREEN_WEB_IN_BODY);
    expect(ART_DEFAULT_CONTROL_HIDE_MS).toBe(Artplayer.CONTROL_HIDE_TIME);
  });

  it('keeps web-fullscreen inside the player container and applies the selected hide timeout', () => {
    configureArtPlayerGlobals(Artplayer, DESKTOP_CONTROL_HIDE_MS);
    expect(Artplayer.FULLSCREEN_WEB_IN_BODY).toBe(APP_FULLSCREEN_WEB_IN_BODY);
    expect(Artplayer.FULLSCREEN_WEB_IN_BODY).toBe(false);
    expect(Artplayer.CONTROL_HIDE_TIME).toBe(DESKTOP_CONTROL_HIDE_MS);
  });

  it('supports the existing touch-controls-always-visible policy', () => {
    configureArtPlayerGlobals(Artplayer, TOUCH_CONTROL_HIDE_MS);
    expect(Artplayer.CONTROL_HIDE_TIME).toBe(TOUCH_CONTROL_HIDE_MS);
    expect(Artplayer.FULLSCREEN_WEB_IN_BODY).toBe(false);
  });

  it('restores both global settings after a player unmounts', () => {
    configureArtPlayerGlobals(Artplayer, TOUCH_CONTROL_HIDE_MS);
    restoreArtPlayerGlobals(Artplayer);
    expect(Artplayer.CONTROL_HIDE_TIME).toBe(ART_DEFAULT_CONTROL_HIDE_MS);
    expect(Artplayer.FULLSCREEN_WEB_IN_BODY).toBe(ART_DEFAULT_FULLSCREEN_WEB_IN_BODY);
  });

  it('rejects invalid hide timeouts instead of poisoning global player state', () => {
    expect(() => configureArtPlayerGlobals(Artplayer, 0)).toThrow('positive finite number');
    expect(() => configureArtPlayerGlobals(Artplayer, Number.NaN)).toThrow('positive finite number');
  });
});
