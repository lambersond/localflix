/**
 * Minimal ambient types for the Google Cast Web Sender (CAF) SDK — only the
 * surface `useCast` touches. The SDK attaches `window.cast` / `window.chrome`
 * once `cast_sender.js?loadCastFramework=1` loads, so everything is optional on
 * `Window` and guarded at runtime. Avoids a dependency on
 * `@types/chromecast-caf-sender`.
 */

declare global {
  interface CastMediaInfo {
    contentId: string;
    contentType: string;
    metadata?: unknown;
    streamType?: string;
  }

  interface CastGenericMediaMetadata {
    title?: string;
    images?: { url: string }[];
  }

  interface CastLoadRequest {
    currentTime?: number;
    autoplay?: boolean;
  }

  interface CastRemotePlayer {
    isConnected: boolean;
    isMediaLoaded: boolean;
    isPaused: boolean;
    currentTime: number;
    duration: number;
    mediaInfo: CastMediaInfo | null;
  }

  interface CastRemotePlayerController {
    playOrPause(): void;
    seek(): void;
    addEventListener(type: string, handler: () => void): void;
    removeEventListener(type: string, handler: () => void): void;
  }

  interface CastSession {
    loadMedia(request: CastLoadRequest): Promise<void>;
    getCastDevice(): { friendlyName?: string } | null;
    endSession(stopCasting: boolean): void;
  }

  interface CastContextInstance {
    setOptions(options: { receiverApplicationId?: string; autoJoinPolicy?: string }): void;
    requestSession(): Promise<void>;
    getCastState(): string;
    getCurrentSession(): CastSession | null;
    addEventListener(
      type: string,
      handler: (event: { castState?: string; sessionState?: string }) => void,
    ): void;
    removeEventListener(type: string, handler: (event: unknown) => void): void;
  }

  interface CastStatic {
    framework: {
      CastContext: { getInstance(): CastContextInstance };
      RemotePlayer: new () => CastRemotePlayer;
      RemotePlayerController: new (player: CastRemotePlayer) => CastRemotePlayerController;
      CastState: {
        NO_DEVICES_AVAILABLE: string;
        NOT_CONNECTED: string;
        CONNECTING: string;
        CONNECTED: string;
      };
      CastContextEventType: {
        CAST_STATE_CHANGED: string;
        SESSION_STATE_CHANGED: string;
      };
      RemotePlayerEventType: {
        IS_CONNECTED_CHANGED: string;
        CURRENT_TIME_CHANGED: string;
        DURATION_CHANGED: string;
        IS_PAUSED_CHANGED: string;
        IS_MEDIA_LOADED_CHANGED: string;
      };
    };
  }

  interface ChromeCastStatic {
    cast: {
      AutoJoinPolicy: {
        ORIGIN_SCOPED: string;
        TAB_AND_ORIGIN_SCOPED: string;
        PAGE_SCOPED: string;
      };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
        GenericMediaMetadata: new () => CastGenericMediaMetadata;
        LoadRequest: new (mediaInfo: CastMediaInfo) => CastLoadRequest;
      };
    };
  }

  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: CastStatic;
    chrome?: ChromeCastStatic;
  }
}

export {};
