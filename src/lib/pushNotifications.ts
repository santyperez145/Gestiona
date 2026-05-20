/**
 * pushNotifications.ts
 * Browser-side helpers for Web Push subscription management.
 *
 * Usage:
 *   import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '@/lib/pushNotifications';
 */

import { supabase } from "@/integrations/supabase/client";

// ── VAPID public key ─────────────────────────────────────────
// Generate with: npx web-push generate-vapid-keys
// Store private key as VAPID_PRIVATE_KEY secret in Supabase.
// Put the public key here (safe to expose).
const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Returns true if browser supports push and permission is granted. */
export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Returns the current notification permission status. */
export function getNotificationPermission(): NotificationPermission {
  return Notification.permission;
}

/** Returns current push subscription or null. */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Request notification permission + subscribe to push.
 * Saves the subscription to Supabase via push-subscribe edge function.
 */
export async function subscribeToPush(orgId: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (!VAPID_PUBLIC_KEY) {
    console.warn("pushNotifications: VITE_VAPID_PUBLIC_KEY not set");
    return false;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Already subscribed — just save/update in DB
      await saveSubscription(existing, orgId);
      return true;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    await saveSubscription(subscription, orgId);
    return true;
  } catch (err) {
    console.error("pushNotifications: subscribe failed", err);
    return false;
  }
}

/** Unsubscribe from push and remove from DB. */
export async function unsubscribeFromPush(orgId: string): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();

  // Remove from DB
  await supabase
    .from("push_subscriptions" as any)
    .delete()
    .eq("endpoint", endpoint)
    .eq("org_id", orgId);
}

async function saveSubscription(sub: PushSubscription, orgId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const subJson = sub.toJSON();
  await supabase.functions.invoke("push-subscribe", {
    body: {
      endpoint: sub.endpoint,
      p256dh: subJson.keys?.p256dh ?? "",
      auth: subJson.keys?.auth ?? "",
      org_id: orgId,
    },
  });
}
