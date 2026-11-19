import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.922.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.922.0";
import { createHash } from "node:crypto";
import { getFileOwner } from "../_shared/auth.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const projectUrl = env("SUPABASE_URL");
const publicKey = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") || "{}").default ?? env("SUPABASE_ANON_KEY");
const secretKey = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}").default ?? env("SUPABASE_SERVICE_ROLE_KEY");
const bucket = env("R2_BUCKET_NAME");
const uploadLimitBytes = 50_000_000;
const videoExtension = /\.(?:3g2|3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|webm|wmv)$/i;
const storage = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
});

async function files(query: URLSearchParams, method = "GET", body?: object, prefer?: string) {
  const headers = new Headers({ apikey: secretKey, "content-type": "application/json" });
  if (!secretKey.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${secretKey}`);
  if (prefer) headers.set("prefer", prefer);
  const response = await fetch(`${projectUrl}/rest/v1/files?${query}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("File metadata request failed");
  return await response.json();
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const origins = ["http://localhost:5173", env("APP_ORIGIN")];
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  const reply = (data: object, status = 200) => Response.json(data, { status, headers });
  if (origin && !origins.includes(origin)) return reply({ error: "Origin not allowed" }, 403);
  if (origin) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, apikey, content-type, x-client-info");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const user = await getFileOwner(request, projectUrl, publicKey);
    if (!user) return reply({ error: "Sign in required" }, 401);
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object") return reply({ error: "Invalid request" }, 400);
    const owned = new URLSearchParams({ owner_id: `eq.${user.id}`, deleted_at: "is.null" });
    if (input.action === "reserve") {
      const { name, sha256, size, contentType } = input;
      if (typeof name !== "string" || !name.trim() || name.length > 1024 ||
        typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isSafeInteger(size) || size < 0) {
        return reply({ error: "Invalid file metadata" }, 400);
      }
      if (videoExtension.test(name.trim()) ||
        (typeof contentType === "string" && /^video\//i.test(contentType.trim()))) {
        return reply({ error: "FileFlicker는 동영상 업로드를 지원하지 않습니다." }, 415);
      }
      if (size >= uploadLimitBytes) {
        return reply({ error: "파일은 50 MB 미만만 업로드할 수 있습니다. 이미지는 압축하고, 문서는 필요한 부분을 나눠 다시 선택해 주세요." }, 413);
      }
      const id = crypto.randomUUID();
      await files(new URLSearchParams({ on_conflict: "owner_id,sha256" }), "POST", {
        id, owner_id: user.id, original_name: name, sha256, size_bytes: size,
        object_key: `${user.id}/${id}`,
      }, "resolution=ignore-duplicates,return=representation");
      owned.set("sha256", `eq.${sha256}`);
      const [file] = await files(owned);
      if (!file) return reply({ error: "File is in the trash" }, 409);
      if (file.upload_status === "uploaded") return reply({ id: file.id, duplicate: true });
      if (file.size_bytes !== size) return reply({ error: "File size differs from reservation" }, 409);
      const url = await getSignedUrl(storage, new PutObjectCommand({
        Bucket: bucket, Key: `pending/${file.object_key}`, ContentLength: size,
      }), { expiresIn: 300, signableHeaders: new Set(["content-length"]) });
      return reply({ id: file.id, url });
    }

    if (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/i.test(input.id)) {
      return reply({ error: "Invalid file ID" }, 400);
    }
    if (input.action === "restore" || input.action === "purge") owned.set("deleted_at", "not.is.null");
    owned.set("id", `eq.${input.id}`);
    const [file] = await files(owned);
    if (!file) return reply({ error: "File not found" }, 404);
    const object = { Bucket: bucket, Key: file.object_key };
    if (input.action === "update" && file.upload_status === "uploaded") {
      const { title, summary, category, tags } = input;
      if (typeof title !== "string" || !title.trim() || title.length > 1024 ||
          typeof summary !== "string" || summary.length > 20000 ||
          typeof category !== "string" || category.length > 200 ||
          !Array.isArray(tags) || tags.length > 50 ||
          !tags.every((tag: unknown) => typeof tag === "string" && tag.length > 0 && tag.length <= 100)) {
        return reply({ error: "입력 내용을 확인해 주세요." }, 400);
      }
      await files(owned, "PATCH", { title: title.trim(), summary, category, tags, updated_at: new Date().toISOString() }, "return=representation");
      return reply({ id: file.id });
    }
    if (input.action === "trash" && file.upload_status === "uploaded") {
      await files(owned, "PATCH", { deleted_at: new Date().toISOString() }, "return=representation");
      return reply({ id: file.id });
    }
    if (input.action === "restore") {
      await files(owned, "PATCH", { deleted_at: null }, "return=representation");
      return reply({ id: file.id });
    }
    if (input.action === "purge") {
      await storage.send(new DeleteObjectCommand(object));
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: `pending/${file.object_key}` }));
      await files(owned, "DELETE", undefined, "return=representation");
      return reply({ id: file.id });
    }
    if (input.action === "complete") {
      if (file.upload_status === "uploaded") return reply({ id: file.id });
      if (file.size_bytes >= uploadLimitBytes) return reply({ error: "업로드 한도인 50 MB를 초과했습니다." }, 413);
      const stagingKey = `pending/${file.object_key}`;
      const info = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: stagingKey })).catch((error) => {
        if (error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      });
      if (!info?.Body || !info.ETag) return reply({ error: "Upload missing or incomplete" }, 409);
      const stream = info.Body.transformToWebStream();
      if (info.ContentLength !== file.size_bytes) {
        await stream.cancel();
        return reply({ error: "Upload size differs from reservation" }, 409);
      }
      const hash = createHash("sha256");
      for await (const chunk of stream) hash.update(chunk);
      if (hash.digest("hex") !== file.sha256) {
        return reply({ error: "Upload checksum differs from reservation" }, 409);
      }
      await storage.send(new CopyObjectCommand({
        ...object, CopySource: `${bucket}/${stagingKey}`, CopySourceIfMatch: info.ETag,
        MetadataDirective: "REPLACE", ContentType: "application/octet-stream",
      }));
      await files(owned, "PATCH", {
        upload_status: "uploaded", updated_at: new Date().toISOString(),
      }, "return=representation");
      return reply({ id: file.id });
    }
    if (input.action === "download" && file.upload_status === "uploaded") {
      const name = encodeURIComponent(file.original_name.replace(/[\u0000-\u001f\u007f]/g, "_"))
        .replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
      const url = await getSignedUrl(storage, new GetObjectCommand({
        ...object, ResponseContentDisposition: `attachment; filename*=UTF-8''${name}`,
      }), { expiresIn: 120 });
      return reply({ url });
    }
    return reply({ error: "Unsupported action or file unavailable" }, 400);
  } catch (error) {
    console.error("File operation failed", error instanceof Error ? error.name : "unknown");
    return reply({ error: "File operation failed" }, 500);
  }
});
