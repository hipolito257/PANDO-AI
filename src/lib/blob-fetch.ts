import { put, del } from "@vercel/blob";

// Authenticated put for private blob store
export function blobPut(pathname: string, data: Buffer, opts?: { addRandomSuffix?: boolean }) {
  return put(pathname, data, {
    access: "private",
    addRandomSuffix: opts?.addRandomSuffix ?? false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  } as Parameters<typeof put>[2]);
}

// Authenticated fetch for private blob store
export async function blobFetch(url: string): Promise<Buffer> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Blob fetch failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Re-export del for convenience
export { del as blobDel };
