"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

interface VideoPlayerProps {
  src: string;
  title: string;
  backHref: string;
  playableId: string;
  resumeSeconds: number;
}

const SAVE_INTERVAL_SECONDS = 10;

export default function VideoPlayer({
  src,
  title,
  backHref,
  playableId,
  resumeSeconds,
}: Readonly<VideoPlayerProps>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef(0);

  // Resume + progress reporting.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function saveProgress() {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.currentTime)) return;
      const payload = JSON.stringify({
        playableId,
        position: v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : null,
      });
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/progress", blob);
      } else {
        void fetch("/api/progress", { method: "POST", body: payload, keepalive: true });
      }
      lastSavedRef.current = v.currentTime;
    }

    function onLoadedMetadata() {
      const v = videoRef.current;
      if (!v) return;
      if (resumeSeconds > 1 && resumeSeconds < v.duration - 1) {
        v.currentTime = resumeSeconds;
      }
    }

    function onTimeUpdate() {
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
  }, [playableId, resumeSeconds]);

  // Basic keyboard controls: space toggles play, arrows seek ±10s.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
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
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Link
        href={backHref}
        className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-black/80"
      >
        <span aria-hidden>←</span> Back
      </Link>
      {/* No caption tracks: this is a personal library without subtitle files. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={src}
        title={title}
        controls
        autoPlay
        preload="metadata"
        className="h-full w-full bg-black"
      />
    </div>
  );
}
