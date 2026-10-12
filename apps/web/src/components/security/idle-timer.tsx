"use client";

import * as React from "react";
import { signOut, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@educore/ui/alert-dialog";
import { Button } from "@educore/ui/button";
import { ACTIVITY_PING_MS, idlePhase } from "@/lib/security/session-limits";

const SHARED_KEY = "educore.lastActivity";
const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(SHARED_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeShared(t: number) {
  try {
    window.localStorage.setItem(SHARED_KEY, String(t));
  } catch {
    // Private window or blocked storage: this tab keeps its own clock.
  }
}

/**
 * Signs the person out after the school's inactivity limit (tester review,
 * Oct 2026). Activity in any tab counts. While active, the server is told
 * about it once a minute — the server enforces the same limit, so closing
 * the tab or switching off JavaScript doesn't get round it. A warning gives
 * a minute's notice first.
 */
export function IdleTimer() {
  const t = useTranslations("sessionSecurity");
  const { data, update } = useSession();
  const idleMinutes = data?.idle ?? 0;
  const last = React.useRef(Date.now());
  const lastPing = React.useRef(Date.now());
  const leaving = React.useRef(false);
  const [left, setLeft] = React.useState<number | null>(null);

  const markActive = React.useCallback(() => {
    const now = Date.now();
    if (now - last.current < 1000) return;
    last.current = now;
    writeShared(now);
  }, []);

  React.useEffect(() => {
    if (!idleMinutes) return;
    writeShared(Date.now());
    for (const e of EVENTS) window.addEventListener(e, markActive, { passive: true });
    const tick = window.setInterval(() => {
      const now = Date.now();
      const latest = Math.max(last.current, readShared());
      last.current = latest;
      const { phase, msLeft } = idlePhase(latest, idleMinutes, now);
      if (phase === "expired") {
        if (!leaving.current) {
          leaving.current = true;
          void signOut({ callbackUrl: "/login?notice=SignedOutIdle" });
        }
        return;
      }
      setLeft(phase === "warning" ? Math.ceil(msLeft / 1000) : null);
      if (phase === "active" && latest > lastPing.current && now - lastPing.current >= ACTIVITY_PING_MS) {
        lastPing.current = now;
        void update({ touch: true });
      }
    }, 1000);
    return () => {
      window.clearInterval(tick);
      for (const e of EVENTS) window.removeEventListener(e, markActive);
    };
  }, [idleMinutes, markActive, update]);

  if (left === null) return null;
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("warningTitle")}</AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">{t("warningBody", { seconds: left })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => void signOut({ callbackUrl: "/login" })}>
            {t("signOutNow")}
          </Button>
          <Button
            type="button"
            autoFocus
            onClick={() => {
              const now = Date.now();
              last.current = now;
              lastPing.current = now;
              writeShared(now);
              setLeft(null);
              void update({ touch: true });
            }}
          >
            {t("staySignedIn")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
