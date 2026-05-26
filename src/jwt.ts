import crypto from "crypto";

function base64UrlEncode(str: string | Buffer): string {
  const base64 = typeof str === "string" ? Buffer.from(str).toString("base64") : str.toString("base64");
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export function signJwt(payload: object, secret: string, expiresInSeconds: number): string {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const tokenInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(tokenInput)
    .digest();

  const encodedSignature = base64UrlEncode(signature);
  return `${tokenInput}.${encodedSignature}`;
}

export function verifyJwt(token: string, secret: string): any {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token structure.");
  }

  const encodedHeader = parts[0] ?? "";
  const encodedPayload = parts[1] ?? "";
  const encodedSignature = parts[2] ?? "";
  const tokenInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", secret).update(tokenInput).digest()
  );

  if (encodedSignature !== expectedSignature) {
    throw new Error("Invalid token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error("Token expired.");
  }

  return payload;
}
