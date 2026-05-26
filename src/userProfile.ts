import { FieldValue } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import admin from "./firebaseAdmin";

type SyncUserBody = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  username?: string;
  avatarUrl?: string;
  displayName?: string;
  photoURL?: string;
};

type UserProfileFields = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  username: string | null;
  avatarUrl: string | null;
};

const db = admin.firestore();

export function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function pickProfileFields(body: unknown): UserProfileFields {
  const payload = (body ?? {}) as SyncUserBody;

  return {
    firstName: normalizeString(payload.firstName),
    lastName: normalizeString(payload.lastName),
    phone: normalizeString(payload.phone),
    username: normalizeString(payload.username),
    avatarUrl: normalizeString(payload.avatarUrl) ?? normalizeString(payload.photoURL)
  };
}

export function buildUserPayload(decoded: DecodedIdToken, body?: unknown) {
  const profile = pickProfileFields(body);
  const normalizedBody = (body ?? {}) as SyncUserBody;

  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    emailVerified: Boolean(decoded.email_verified),
    displayName: decoded.name ?? normalizeString(normalizedBody.displayName),
    photoURL: decoded.picture ?? normalizeString(normalizedBody.photoURL),
    provider: decoded.firebase.sign_in_provider ?? null,
    lastLoginAt: FieldValue.serverTimestamp(),
    ...profile
  };
}

export async function ensureUserDocument(decoded: DecodedIdToken, body?: unknown) {
  const userRef = db.collection("users").doc(decoded.uid);
  const snapshot = await userRef.get();
  const payload = buildUserPayload(decoded, body);

  if (!snapshot.exists) {
    await userRef.set(
      {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        onboardingCompleted: false
      },
      { merge: true }
    );
  } else {
    await userRef.set(
      {
        ...payload,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  const storedSnapshot = await userRef.get();

  return {
    ref: userRef,
    snapshot: storedSnapshot,
    isNewUser: !snapshot.exists
  };
}
