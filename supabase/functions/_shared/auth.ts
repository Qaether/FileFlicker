export interface FileOwner {
  id: string;
}

export async function getFileOwner(
  request: Request,
  projectUrl: string,
  publishableKey: string,
  requestAuth: typeof fetch = fetch,
): Promise<FileOwner | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s,]+$/i.test(authorization)) return null;

  const response = await requestAuth(new URL("/auth/v1/user", projectUrl), {
    headers: { authorization, apikey: publishableKey },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Supabase Auth verification failed");

  const user = await response.json();
  if (
    typeof user.id !== "string" ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(user.id) ||
    user.is_anonymous === true
  ) return null;

  return { id: user.id };
}
