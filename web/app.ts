import { exclusionReason } from "./upload-rules";
import { createClient } from "@supabase/supabase-js";

interface FileRecord {
  id: string;
  original_name: string;
  title: string | null;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
  category: string | null;
  summary: string | null;
  tags: string[];
}

type FileOperation =
  | { action: "reserve"; name: string; size: number; contentType: string; sha256: string }
  | { action: "complete" | "download" | "trash" | "restore" | "purge"; id: string }
  | { action: "update"; id: string; title: string; summary: string; category: string; tags: string[] };
type Reservation = { id: string; duplicate: true } | { id: string; duplicate?: false; url: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청에 실패했습니다.";

const url = "https://elbepqrahykhefjdlnqn.supabase.co";
const key = "sb_publishable_SYqVjlSMZ_RGR6Tat5Q9cg_UhPc9GHK";
const auth = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
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
let trashView = false;
let selected: FileRecord | undefined;
let page = 1;
const pageSize = 20;
const dialog = element<HTMLDialogElement>("file-dialog");
const fileForm = element<HTMLFormElement>("file-form");
const filesPage = element("files-heading").closest("section")!;
const uploadPage = element("upload-page");

async function api<T>(path: string, { body, token }: { body?: object; token?: string } = {}): Promise<T> {
  const headers = new Headers({ apikey: key });
  if (token) {
    const { data, error } = await auth.auth.getSession();
    if (error || !data.session) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
    headers.set("authorization", `Bearer ${data.session.access_token}`);
  }
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
  const filtered = records.filter((file) => {
    const text = [file.title, file.original_name, file.category, file.summary, ...file.tags].join(" ");
    return text.toLocaleLowerCase().includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, totalPages);
  for (const file of filtered.slice((page - 1) * pageSize, page * pageSize)) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.textContent = file.title || file.original_name;
    button.className = "min-w-0 w-full truncate text-left";
    button.title = file.title || file.original_name;
    button.addEventListener("click", () => openFile(file));
    row.append(button);
    list.append(row);
  }
  element("files-state").textContent = filtered.length
    ? `${filtered.length}개 파일`
    : query ? "검색 조건에 맞는 파일이 없습니다." : trashView ? "휴지통이 비어 있습니다." : "저장된 파일이 없습니다.";
  element("page-state").textContent = `${page} / ${totalPages}`;
  element<HTMLButtonElement>("previous-page").disabled = page <= 1;
  element<HTMLButtonElement>("next-page").disabled = page >= totalPages;
}
element("previous-page").addEventListener("click", () => { if (page > 1) { page--; renderFiles(); } });
element("next-page").addEventListener("click", () => { page++; renderFiles(); });

async function refresh(token: string) {
  const deleted = trashView ? "not.is.null" : "is.null";
  const view = trashView;
  const rows: FileRecord[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const batch = await api<FileRecord[]>(`/rest/v1/files?select=id,original_name,title,size_bytes,created_at,deleted_at,summary,category,tags&upload_status=eq.uploaded&deleted_at=${deleted}&order=created_at.desc,id.desc&limit=${batchSize}&offset=${offset}`, { token });
    if (!session || trashView !== view) return;
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  if (!session) return;
  records = rows;
  renderFiles();
}

function openFile(file: FileRecord) {
  selected = file;
  const set = (name: string, value: string) => { (fileForm.elements.namedItem(name) as HTMLInputElement).value = value; };
  set("title", file.title || file.original_name);
  set("summary", file.summary || "");
  set("category", file.category || "");
  set("tags", file.tags.join(", "));
  element("original-name").textContent = `원본 파일명: ${file.original_name}`;
  element("file-info").textContent = `${file.size_bytes.toLocaleString()}바이트 · ${new Date(file.created_at).toLocaleDateString("ko-KR")}`;
  element("dialog-status").textContent = "";
  for (const id of ["save-file", "download-file", "trash-file"]) element(id).hidden = trashView;
  for (const id of ["restore-file", "purge-file"]) element(id).hidden = !trashView;
  dialog.showModal();
}

async function changeFile(action: "trash" | "restore" | "purge") {
  if (!session || !selected) return;
  if (action === "purge" && !window.confirm("이 파일을 영구 삭제하시겠습니까? 복구할 수 없습니다.")) return;
  try {
    await fileAction(session, { action, id: selected.id });
    dialog.close();
    await refresh(session);
  } catch (error) { element("dialog-status").textContent = errorMessage(error); }
}
element("close-dialog").addEventListener("click", () => dialog.close());
element("trash-file").addEventListener("click", () => void changeFile("trash"));
element("restore-file").addEventListener("click", () => void changeFile("restore"));
element("purge-file").addEventListener("click", () => void changeFile("purge"));
element("download-file").addEventListener("click", async () => {
  if (!session || !selected) return;
  try {
    const result = await fileAction<{ url: string }>(session, { action: "download", id: selected.id });
    window.location.assign(result.url);
  } catch (error) { element("dialog-status").textContent = errorMessage(error); }
});
fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || !selected) return;
  const data = new FormData(fileForm);
  const tags = String(data.get("tags") || "").split(",").map(tag => tag.trim()).filter(Boolean);
  try {
    await fileAction(session, { action: "update", id: selected.id, title: String(data.get("title") || ""),
      summary: String(data.get("summary") || ""), category: String(data.get("category") || ""), tags });
    dialog.close();
    await refresh(session);
  } catch (error) { element("dialog-status").textContent = errorMessage(error); }
});
element("show-upload").addEventListener("click", () => { filesPage.hidden = true; uploadPage.hidden = false; });
element("back-to-files").addEventListener("click", () => { uploadPage.hidden = true; filesPage.hidden = false; });
element("show-trash").addEventListener("click", async () => {
  if (!session) return;
  trashView = !trashView;
  page = 1;
  element("files-heading").textContent = trashView ? "휴지통" : "저장된 파일";
  element("show-trash").textContent = trashView ? "파일 목록" : "휴지통";
  try { await refresh(session); } catch (error) { status.textContent = errorMessage(error); }
});

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
    const credentials = new FormData(login);
    const { data, error } = await auth.auth.signInWithPassword({
      email: String(credentials.get("email") || ""),
      password: String(credentials.get("password") || ""),
    });
    if (error || !data.session) throw error || new Error("로그인하지 못했습니다.");
    session = data.session.access_token;
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

function showSignedOut() {
  if (dialog.open) dialog.close();
  trashView = false;
  element("files-heading").textContent = "저장된 파일";
  element("show-trash").textContent = "휴지통";
  filesPage.hidden = false;
  uploadPage.hidden = true;
  session = undefined;
  records = [];
  renderFiles();
  element("uploads").replaceChildren();
  element("library").hidden = true;
  logout.hidden = true;
  login.hidden = false;
  status.textContent = "";
}

logout.addEventListener("click", async () => {
  const { error } = await auth.auth.signOut({ scope: "local" });
  showSignedOut();
  if (error) status.textContent = "이 기기에서는 로그아웃했지만 서버 연결에 실패했습니다.";
});

auth.auth.onAuthStateChange((event, current) => {
  if (event === "TOKEN_REFRESHED" && current) session = current.access_token;
  if (event === "SIGNED_OUT") showSignedOut();
});

async function restoreSession() {
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) return;
  session = data.session.access_token;
  login.hidden = true;
  logout.hidden = false;
  element("library").hidden = false;
  try { await refresh(session); }
  catch (error) { status.textContent = errorMessage(error); }
}
void restoreSession();

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
        if (!session) return;
        report("중복 확인 중");
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (!session) return;
        const reservation = await fileAction<Reservation>(token, {
          action: "reserve",
          name: file.name, size: file.size, contentType: file.type, sha256,
        });
        if (reservation.duplicate) {
          report("이미 보관 중");
          return;
        }
        if (!session) return;
        report("업로드 중");
        const response = await fetch(reservation.url, { method: "PUT", body: file });
        if (!response.ok) throw new Error(`저장소 응답 ${response.status}`);
        if (!session) return;
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
search.addEventListener("input", () => { page = 1; renderFiles(); });
