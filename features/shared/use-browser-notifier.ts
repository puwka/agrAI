"use client";

import { useCallback, useEffect, useRef } from "react";

export function useBrowserNotifier() {
  const faviconTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalFaviconHrefRef = useRef<string | null>(null);
  const alertedFaviconHrefRef = useRef<string | null>(null);

  const playNotificationSound = useCallback(() => {
    try {
      const AC =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ||
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const now = ctx.currentTime;
      const notes: Array<{ freq: number; dur: number }> = [
        { freq: 880, dur: 0.08 },
        { freq: 1174, dur: 0.1 },
      ];
      let t = now;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = n.freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + n.dur);
        t += n.dur + 0.03;
      }
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 700);
    } catch {
      // Ignore browser autoplay/sound policy errors.
    }
  }, []);

  const ensureFaviconLinks = useCallback(() => {
    const current =
      (document.querySelector("link[rel='icon']") as HTMLLinkElement | null) ||
      (document.querySelector("link[rel='shortcut icon']") as HTMLLinkElement | null);
    if (!current) return null;
    if (!originalFaviconHrefRef.current) {
      originalFaviconHrefRef.current = current.href;
    }
    if (!alertedFaviconHrefRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) return current;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = originalFaviconHrefRef.current || "/favicon.ico";
      img.onload = () => {
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 0, 0, 64, 64);
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(50, 14, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        alertedFaviconHrefRef.current = canvas.toDataURL("image/png");
      };
    }
    return current;
  }, []);

  const startFaviconAlert = useCallback(() => {
    const current = ensureFaviconLinks();
    if (!current || faviconTimerRef.current) return;
    let on = false;
    faviconTimerRef.current = setInterval(() => {
      const href = on
        ? originalFaviconHrefRef.current || current.href
        : alertedFaviconHrefRef.current || originalFaviconHrefRef.current || current.href;
      current.href = href;
      on = !on;
    }, 650);
  }, [ensureFaviconLinks]);

  const stopFaviconAlert = useCallback(() => {
    if (faviconTimerRef.current) {
      clearInterval(faviconTimerRef.current);
      faviconTimerRef.current = null;
    }
    const current =
      (document.querySelector("link[rel='icon']") as HTMLLinkElement | null) ||
      (document.querySelector("link[rel='shortcut icon']") as HTMLLinkElement | null);
    if (current && originalFaviconHrefRef.current) {
      current.href = originalFaviconHrefRef.current;
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        stopFaviconAlert();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopFaviconAlert();
    };
  }, [stopFaviconAlert]);

  const notify = useCallback(() => {
    playNotificationSound();
    startFaviconAlert();
  }, [playNotificationSound, startFaviconAlert]);

  return { notify, stopFaviconAlert };
}
