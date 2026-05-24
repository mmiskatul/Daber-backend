import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  port: number;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
};

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export const config: EnvConfig = {
  port: Number(process.env.PORT || 4000),
  firebaseProjectId: getEnv("FIREBASE_PROJECT_ID"),
  firebaseClientEmail: getEnv("FIREBASE_CLIENT_EMAIL"),
  firebasePrivateKey: normalizePrivateKey(getEnv("FIREBASE_PRIVATE_KEY"))
};
