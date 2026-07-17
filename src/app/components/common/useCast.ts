"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SDK_SRC = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

// The framework is a page-global singleton; guard load + init so multiple mounts
// (or React StrictMode's double-invoke) don't re-load the script or re-init.
let sdkLoadStarted = false;
let castOptionsSet = false;

export interface CastMediaOptions {
  url: string;
  contentType: string;
  title: string;
  poster: string | null;
  currentTime: number;
}

export interface UseCastResult {
  /** A Cast device is on the network (button should show). */
  available: boolean;
  /** A cast session is active — drive playback remotely. */
  connected: boolean;
  deviceName: string | null;
  remoteCurrentTime: number;
  remoteDuration: number;
  remotePaused: boolean;
  requestSession: () => Promise<void>;
  loadMedia: (opts: CastMediaOptions) => Promise<void>;
  playOrPause: () => void;
  seek: (seconds: number) => void;
  stopCasting: () => void;
}

/** Load the sender SDK once, calling `onReady` when the framework is available. */
function ensureSdk(onReady: () => void) {
  if (typeof window === "undefined") return;
  if (window.cast?.framework && window.chrome?.cast) {
    onReady();
    return;
  }
  const prev = window.__onGCastApiAvailable;
  window.__onGCastApiAvailable = (isAvailable: boolean) => {
    prev?.(isAvailable);
    if (isAvailable) onReady();
  };
  if (sdkLoadStarted) return;
  sdkLoadStarted = true;
  const script = document.createElement("script");
  script.src = SDK_SRC;
  script.async = true;
  document.head.appendChild(script);
}

/** The CastContext, initialized with the default media receiver on first use. */
function castContext(): CastContextInstance | null {
  const w = window;
  if (!w.cast?.framework || !w.chrome?.cast) return null;
  const context = w.cast.framework.CastContext.getInstance();
  if (!castOptionsSet) {
    context.setOptions({
      receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    castOptionsSet = true;
  }
  return context;
}

export function useCast(onEnded?: () => void): UseCastResult {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [remoteCurrentTime, setRemoteCurrentTime] = useState(0);
  const [remoteDuration, setRemoteDuration] = useState(0);
  const [remotePaused, setRemotePaused] = useState(false);

  const playerRef = useRef<CastRemotePlayer | null>(null);
  const controllerRef = useRef<CastRemotePlayerController | null>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    ensureSdk(() => {
      const w = window;
      const context = castContext();
      if (!context || !w.cast?.framework) return;
      const fw = w.cast.framework;

      const onCastState = () => {
        setAvailable(context.getCastState() !== fw.CastState.NO_DEVICES_AVAILABLE);
      };
      context.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, onCastState);
      onCastState();

      const player = new fw.RemotePlayer();
      const controller = new fw.RemotePlayerController(player);
      playerRef.current = player;
      controllerRef.current = controller;

      const onConnect = () => {
        setConnected(player.isConnected);
        setDeviceName(context.getCurrentSession()?.getCastDevice()?.friendlyName ?? null);
      };
      const onTime = () => setRemoteCurrentTime(player.currentTime);
      const onDuration = () => setRemoteDuration(player.duration);
      const onPaused = () => setRemotePaused(player.isPaused);
      const onMediaLoaded = () => {
        if (!player.isMediaLoaded && player.isConnected) onEndedRef.current?.();
      };

      const events = fw.RemotePlayerEventType;
      controller.addEventListener(events.IS_CONNECTED_CHANGED, onConnect);
      controller.addEventListener(events.CURRENT_TIME_CHANGED, onTime);
      controller.addEventListener(events.DURATION_CHANGED, onDuration);
      controller.addEventListener(events.IS_PAUSED_CHANGED, onPaused);
      controller.addEventListener(events.IS_MEDIA_LOADED_CHANGED, onMediaLoaded);
      onConnect();

      cleanup = () => {
        context.removeEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, onCastState);
        controller.removeEventListener(events.IS_CONNECTED_CHANGED, onConnect);
        controller.removeEventListener(events.CURRENT_TIME_CHANGED, onTime);
        controller.removeEventListener(events.DURATION_CHANGED, onDuration);
        controller.removeEventListener(events.IS_PAUSED_CHANGED, onPaused);
        controller.removeEventListener(events.IS_MEDIA_LOADED_CHANGED, onMediaLoaded);
      };
    });

    return () => cleanup?.();
  }, []);

  const requestSession = useCallback(async () => {
    await castContext()?.requestSession();
  }, []);

  const loadMedia = useCallback(async (opts: CastMediaOptions) => {
    const w = window;
    const session = castContext()?.getCurrentSession();
    if (!session || !w.chrome?.cast) return;
    const mediaInfo = new w.chrome.cast.media.MediaInfo(opts.url, opts.contentType);
    const metadata = new w.chrome.cast.media.GenericMediaMetadata();
    metadata.title = opts.title;
    if (opts.poster) metadata.images = [{ url: opts.poster }];
    mediaInfo.metadata = metadata;
    const request = new w.chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = opts.currentTime;
    request.autoplay = true;
    await session.loadMedia(request);
  }, []);

  const playOrPause = useCallback(() => controllerRef.current?.playOrPause(), []);

  const seek = useCallback((seconds: number) => {
    const player = playerRef.current;
    const controller = controllerRef.current;
    if (!player || !controller) return;
    const max = player.duration || seconds;
    player.currentTime = Math.max(0, Math.min(seconds, max));
    controller.seek();
  }, []);

  const stopCasting = useCallback(() => {
    castContext()?.getCurrentSession()?.endSession(true);
  }, []);

  return {
    available,
    connected,
    deviceName,
    remoteCurrentTime,
    remoteDuration,
    remotePaused,
    requestSession,
    loadMedia,
    playOrPause,
    seek,
    stopCasting,
  };
}
