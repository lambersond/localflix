"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCast } from "./useCast";

interface VideoPlayerProps {
  src: string;
  title: string;
  backHref: string;
  playableId: string;
  resumeSeconds: number;
  /** MIME type sent to the Cast device (the device needs it to pick a decoder). */
  castContentType: string;
  /** Poster shown on the Cast device; relative `/tmdb-img/...` or null. */
  posterUrl: string | null;
}

const SAVE_INTERVAL_SECONDS = 10;

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export default function VideoPlayer({
  src,
  title,
  backHref,
  playableId,
  resumeSeconds,
  castContentType,
  posterUrl,
}: Readonly<VideoPlayerProps>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef(0);

  const [castError, setCastError] = useState<string | null>(null);
  // Casting can't reach a stream served from localhost — flag it to hint the user.
  const [isLocalhost] = useState(
    () =>
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname),
  );

  // Called by the Cast hook when remote media ends/unloads.
  const endedRef = useRef<() => void>(() => {});
  const onRemoteEnded = useCallback(() => endedRef.current(), []);
  const {
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
  } = useCast(onRemoteEnded);

  // Keep the active playback position/duration in a ref so the various save
  // paths (which close over stale state) always read the live source: the Cast
  // device when connected, otherwise the local <video>.
  const castStateRef = useRef({ connected: false, time: 0, duration: 0 });
  useEffect(() => {
    castStateRef.current = { connected, time: remoteCurrentTime, duration: remoteDuration };
  }, [connected, remoteCurrentTime, remoteDuration]);

  const saveProgress = useCallback(() => {
    const cast = castStateRef.current;
    const v = videoRef.current;
    let position: number;
    let duration: number | null;
    if (cast.connected) {
      position = cast.time;
      duration = cast.duration > 0 ? cast.duration : null;
    } else if (v && Number.isFinite(v.currentTime)) {
      position = v.currentTime;
      duration = Number.isFinite(v.duration) ? v.duration : null;
    } else {
      return;
    }
    if (!Number.isFinite(position)) return;
    const payload = JSON.stringify({ playableId, position, duration });
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/progress", blob);
    } else {
      void fetch("/api/progress", { method: "POST", body: payload, keepalive: true });
    }
    lastSavedRef.current = position;
  }, [playableId]);

  useEffect(() => {
    endedRef.current = saveProgress;
  }, [saveProgress]);

  // Local playback: resume + progress reporting (only drives while not casting).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onLoadedMetadata() {
      const v = videoRef.current;
      if (!v) return;
      if (resumeSeconds > 1 && resumeSeconds < v.duration - 1) {
        v.currentTime = resumeSeconds;
      }
    }

    function onTimeUpdate() {
      if (castStateRef.current.connected) return; // Cast is the source of truth
      const v = videoRef.current;
      if (!v) return;
      if (Math.abs(v.currentTime - lastSavedRef.current) >= SAVE_INTERVAL_SECONDS) {
        saveProgress();
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") saveProgress();
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", saveProgress);
    video.addEventListener("ended", saveProgress);
    globalThis.addEventListener("pagehide", saveProgress);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      saveProgress();
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", saveProgress);
      video.removeEventListener("ended", saveProgress);
      globalThis.removeEventListener("pagehide", saveProgress);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resumeSeconds, saveProgress]);

  // Periodic save while casting (remote time updates ~1/s via state).
  useEffect(() => {
    if (!connected) return;
    if (Math.abs(remoteCurrentTime - lastSavedRef.current) >= SAVE_INTERVAL_SECONDS) {
      saveProgress();
    }
  }, [connected, remoteCurrentTime, saveProgress]);

  // Start casting on connect: pause local, fling the file to the device with a
  // resume position. One retry if the first load fails, so a transient hiccup
  // doesn't end the session.
  const castStartedRef = useRef(false);
  useEffect(() => {
    if (!connected) {
      castStartedRef.current = false;
      return;
    }
    if (castStartedRef.current) return;
    castStartedRef.current = true;

    const v = videoRef.current;
    const startAt = v && Number.isFinite(v.currentTime) && v.currentTime > 1 ? v.currentTime : resumeSeconds;
    v?.pause();

    const url = new URL(src, window.location.href).href;
    const poster = posterUrl ? new URL(posterUrl, window.location.href).href : null;

    let cancelled = false;
    const attempt = (canRetry: boolean) => {
      loadMedia({ url, contentType: castContentType, title, poster, currentTime: startAt })
        .then(() => {
          if (!cancelled) setCastError(null);
        })
        .catch(() => {
          if (cancelled) return;
          if (canRetry) {
            setCastError("Reconnecting to your cast device…");
            setTimeout(() => attempt(false), 1500);
          } else {
            setCastError("Couldn't play this video on the cast device.");
          }
        });
    };
    attempt(true);

    return () => {
      cancelled = true;
    };
  }, [connected, loadMedia, src, posterUrl, castContentType, title, resumeSeconds]);

  // On disconnect, resume the local element near the last remote position.
  const lastRemoteTimeRef = useRef(0);
  useEffect(() => {
    if (connected && remoteCurrentTime > 0) lastRemoteTimeRef.current = remoteCurrentTime;
  }, [connected, remoteCurrentTime]);
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (connected) {
      wasConnectedRef.current = true;
      return;
    }
    if (!wasConnectedRef.current) return;
    wasConnectedRef.current = false;
    setCastError(null);
    const v = videoRef.current;
    if (v && lastRemoteTimeRef.current > 0) {
      v.currentTime = lastRemoteTimeRef.current;
      void v.play().catch(() => {});
    }
    saveProgress();
  }, [connected, saveProgress]);

  // Keyboard controls target whichever player is active.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const cast = castStateRef.current;
      if (cast.connected) {
        switch (event.key) {
          case " ":
            event.preventDefault();
            playOrPause();
            break;
          case "ArrowRight":
            seek(cast.time + 10);
            break;
          case "ArrowLeft":
            seek(cast.time - 10);
            break;
        }
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      switch (event.key) {
        case " ":
          event.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.currentTime + 10, video.duration || Infinity);
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(video.currentTime - 10, 0);
          break;
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [playOrPause, seek]);

  const pillClass =
    "flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-black/80";

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Link href={backHref} className={`absolute left-4 top-4 z-10 ${pillClass}`}>
        <span aria-hidden>←</span> Back
      </Link>

      {available && !connected && (
        <button
          type="button"
          onClick={() => void requestSession().catch(() => {})}
          className={`absolute right-4 top-4 z-10 cursor-pointer ${pillClass}`}
          aria-label="Cast to a device"
        >
          <span aria-hidden>📺</span> Cast
        </button>
      )}

      {available && !connected && isLocalhost && (
        <p className="absolute right-4 top-16 z-10 max-w-xs rounded bg-black/70 px-3 py-2 text-right text-xs text-yellow-300 backdrop-blur">
          Open this app by its LAN address (not localhost) so the cast device can reach the video.
        </p>
      )}

      {/* No caption tracks: this is a personal library without subtitle files. */}
      <video
        ref={videoRef}
        src={src}
        title={title}
        controls={!connected}
        autoPlay
        playsInline
        preload="metadata"
        disableRemotePlayback
        className="h-full w-full bg-black"
      />

      {connected && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-black/85 px-6 text-center text-white">
          <span aria-hidden className="text-5xl">
            📺
          </span>
          <p className="text-lg font-medium">Casting to {deviceName ?? "your device"}</p>
          <p className="max-w-md truncate text-sm text-white/70">{title}</p>
          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={() => seek(remoteCurrentTime - 10)}
              className="cursor-pointer text-sm text-white/90 hover:text-white"
              aria-label="Back 10 seconds"
            >
              « 10s
            </button>
            <button
              type="button"
              onClick={playOrPause}
              className="cursor-pointer text-4xl leading-none hover:text-white/80"
              aria-label={remotePaused ? "Play" : "Pause"}
            >
              {remotePaused ? "▶" : "⏸"}
            </button>
            <button
              type="button"
              onClick={() => seek(remoteCurrentTime + 10)}
              className="cursor-pointer text-sm text-white/90 hover:text-white"
              aria-label="Forward 10 seconds"
            >
              10s »
            </button>
          </div>
          <p className="text-sm tabular-nums text-white/60">
            {fmtTime(remoteCurrentTime)} / {fmtTime(remoteDuration)}
          </p>
          {castError && <p className="text-sm text-yellow-300">{castError}</p>}
          <button
            type="button"
            onClick={stopCasting}
            className={`cursor-pointer ${pillClass}`}
          >
            Stop casting
          </button>
        </div>
      )}
    </div>
  );
}
