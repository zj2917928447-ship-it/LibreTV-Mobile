import {
  ART_DEFAULT_CONTROL_HIDE_MS,
} from './control-hide';

/** The mutable static settings shared by every ArtPlayer instance in this app. */
export interface ArtPlayerGlobalSettings {
  CONTROL_HIDE_TIME: number;
  FULLSCREEN_WEB_IN_BODY: boolean;
}

/** ArtPlayer 5.4.0 library default; keep this in sync with the dependency. */
export const ART_DEFAULT_FULLSCREEN_WEB_IN_BODY = true;

/**
 * Keep web-fullscreen players inside their original container.
 *
 * ArtPlayer 5.4.0 changes from web fullscreen to native fullscreen incorrectly
 * when the player is moved under document.body. Upstream issue #1073 confirms
 * setting FULLSCREEN_WEB_IN_BODY=false avoids that transition bug.
 */
export const APP_FULLSCREEN_WEB_IN_BODY = false;

export function configureArtPlayerGlobals(
  artplayer: ArtPlayerGlobalSettings,
  controlHideTime: number
): void {
  if (!Number.isFinite(controlHideTime) || controlHideTime < 1) {
    throw new RangeError('ArtPlayer control hide time must be a positive finite number');
  }

  artplayer.CONTROL_HIDE_TIME = controlHideTime;
  artplayer.FULLSCREEN_WEB_IN_BODY = APP_FULLSCREEN_WEB_IN_BODY;
}

/** Restore upstream defaults when a player unmounts, preventing cross-route leakage. */
export function restoreArtPlayerGlobals(artplayer: ArtPlayerGlobalSettings): void {
  artplayer.CONTROL_HIDE_TIME = ART_DEFAULT_CONTROL_HIDE_MS;
  artplayer.FULLSCREEN_WEB_IN_BODY = ART_DEFAULT_FULLSCREEN_WEB_IN_BODY;
}
