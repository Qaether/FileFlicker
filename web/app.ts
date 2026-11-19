import { exclusionReason } from "./upload-rules";

interface FileRecord {
  id: string;
  original_name: string;
  category: string | null;
  summary: string | null;
  tags: string[];
}

type FileOperation =
  | { action: "reserve"; name: string; size: number; contentType: string; sha256: string }
  | { action: "complete" | "download"; id: string };
type Reservation = { id: string; duplicate: true } | { id: string; duplicate?: false; url: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청에 실패했습니다.";

const url = "https://elbepqrahykhefjdlnqn.supabase.co";
const key = "sb_publishable_SYqVjlSMZ_RGR6Tat5Q9cg_UhPc9GHK";
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing element: ${id}`);
  return target as T;
}
const login = element<HTMLFormElement>("login");
const logout = element("logout");
const drop = element("drop");
const picker = element<HTMLInputElement>("pick");
const search = element<HTMLInputElement>("search");
const status = element("status");
let session: string | undefined;
let records: FileRecord[] = [];
let queue = Promise.resolve();

async function api<T>(path: string, { body, token }: { body?: object; token?: string } = {}): Promise<T> {
  const headers = new Headers({ apikey: key });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body) headers.set("content-type", "application/json");
  const response = await fetch(url + path, {
    method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.message || result.error || "요청에 실패했습니다.");
  return result;
}

const fileAction = <T>(token: string, body: FileOperation) => api<T>("/functions/v1/files", {
  token, body,
});

function renderFiles() {
  const query = search.value.trim().toLocaleLowerCase();
  const list = element("files");
  list.replaceChildren();
  for (const file of records) {
    const text = [file.original_name, file.category, file.summary, ...file.tags].join(" ");
    if (!text.toLocaleLowerCase().includes(query)) continue;
    const row = document.createElement("li");
    row.textContent = file.original_name;
    const button = document.createElement("button");
    button.textContent = "다운로드";
    button.addEventListener("click", async () => {
      try {
        if (!session) return;
        const { url: download } = await fileAction<{ url: string }>(session, { action: "download", id: file.id });
        window.location.assign(download);
      } catch (error) {
        status.textContent = errorMessage(error);
      }
    });
    row.append(button);
    list.append(row);
  }
  element("files-state").textContent = list.childElementCount
    ? `${list.childElementCount}개 파일`
    : query ? "검색 조건에 맞는 파일이 없습니다." : "저장된 파일이 없습니다.";
}

async function refresh(token: string) {
  const rows = await api<FileRecord[]>("/rest/v1/files?select=id,original_name,summary,category,tags&upload_status=eq.uploaded&deleted_at=is.null&order=created_at.desc", { token });
  if (session !== token) return;
  records = rows;
  renderFiles();
}

element("refresh-files").addEventListener("click", async () => {
  if (!session) return;
  status.textContent = "";
  try {
    await refresh(session);
  } catch (error) {
    status.textContent = errorMessage(error);
  }
});

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = login.querySelector("button");
  if (!button) return;
  button.disabled = true;
  status.textContent = "";
  try {
    const credentials = Object.fromEntries(new FormData(login));
    const result = await api<{ access_token: string }>("/auth/v1/token?grant_type=password", { body: credentials });
    session = result.access_token;
    login.reset();
    login.hidden = true;
    logout.hidden = false;
    element("library").hidden = false;
    await refresh(session);
  } catch (error) {
    status.textContent = errorMessage(error);
  } finally {
    button.disabled = false;
  }
});

logout.addEventListener("click", () => {
  session = undefined;
  records = [];
  renderFiles();
  element("uploads").replaceChildren();
  element("library").hidden = true;
  logout.hidden = true;
  login.hidden = false;
  status.textContent = "";
});

function enqueue(files: Iterable<File>) {
  if (!session) return;
  const token = session;
  for (const file of files) {
    const row = document.createElement("li");
    element("uploads").append(row);
    const report = (message: string) => { row.textContent = `${file.name} — ${message}`; };
    const reason = exclusionReason(file);
    if (reason) {
      report(`제외 (${file.size.toLocaleString()}바이트). ${reason}`);
      continue;
    }
    report("대기 중");
    queue = queue.then(async () => {
      try {
        if (session !== token) return;
        report("중복 확인 중");
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (session !== token) return;
        const reservation = await fileAction<Reservation>(token, {
          action: "reserve",
          name: file.name, size: file.size, contentType: file.type, sha256,
        });
        if (reservation.duplicate) {
          report("이미 보관 중");
          return;
        }
        if (session !== token) return;
        report("업로드 중");
        const response = await fetch(reservation.url, { method: "PUT", body: file });
        if (!response.ok) throw new Error(`저장소 응답 ${response.status}`);
        if (session !== token) return;
        await fileAction(token, { action: "complete", id: reservation.id });
        report("업로드 완료");
        await refresh(token).catch(() => { status.textContent = "파일 목록을 새로 고치지 못했습니다."; });
      } catch (error) {
        report(`실패. ${errorMessage(error)}`);
      }
    });
  }
}

picker.addEventListener("change", () => {
  if (picker.files) enqueue(picker.files);
  picker.value = "";
});
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("active");
});
drop.addEventListener("dragleave", () => drop.classList.remove("active"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("active");
  if (event.dataTransfer) enqueue(event.dataTransfer.files);
});
search.addEventListener("input", renderFiles);
