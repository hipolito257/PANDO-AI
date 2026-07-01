import crypto from "crypto";

// The project's Vercel Blob store only supports public access (private access
// requires a separately-provisioned private store, which isn't configured
// here). Since the translator handles potentially confidential legal/financial
// documents, we encrypt everything at rest instead: even though blob URLs are
// technically public, an attacker who obtains one only gets ciphertext —
// decryption requires this server's AUTH_SECRET, which never leaves the server.
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encrypt document content");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptBuffer(buf: Buffer): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptBuffer(data: Buffer): Buffer {
  const key = getKey();
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
