import { unsupportedUploadReason, uploadExtensions, uploadSizeReason } from "../supabase/functions/_shared/upload-rules";
import { matchesFile } from "./file-search";
import { createClient } from "@supabase/supabase-js";

interface FileRecord {
  id: string;
  original_name: string;
  title: string | null;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
  summary: string | null;
  tags: string[];
}

type FileOperation =
  | { action: "reserve"; name: string; size: number; contentType: string; sha256: string }
  | { action: "complete" | "download" | "trash" | "restore" | "purge"; id: string }
  | { action: "generate"; id: string; kind: "summary" | "tags"; text: string; images: string[] }
  | { action: "update"; id: string; title: string; summary: string; tags: string[] };
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
picker.accept = uploadExtensions.join(",");
const search = element<HTMLInputElement>("search");
const status = element("status");
let session: string | undefined;
let records: FileRecord[] = [];
let queue = Promise.resolve();
let trashView = false;
let selected: FileRecord | undefined;
let savedSnapshot = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<boolean> | undefined;
let tagValues: string[] = [];
let page = 1;
const pageSize = 20;
const dialog = element<HTMLDialogElement>("file-dialog");
const fileForm = element<HTMLFormElement>("file-form");
const filesPage = element("files-heading").closest("section")!;
const uploadPage = element("upload-page");
const authorizationId = location.pathname === "/oauth/consent" ? new URLSearchParams(location.search).get("authorization_id") : null;

async function showConsent() {
  if (!authorizationId) return;
  const { data, error } = await auth.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) throw error || new Error("연결 요청을 확인할 수 없습니다.");
  if (!("authorization_id" in data)) {
    location.assign(data.redirect_url);
    return;
  }
  element("library").hidden = true;
  element("oauth-consent").hidden = false;
  element("oauth-client").textContent = data.client.name || "이름 없는 앱";
  element("oauth-redirect").textContent = `돌아갈 주소: ${data.redirect_uri}`;
  element("oauth-scope").textContent = `요청 권한: ${data.scope || "기본 접근"}`;
}

async function decideConsent(approve: boolean) {
  if (!authorizationId) return;
  try {
    const result = approve
      ? await auth.auth.oauth.approveAuthorization(authorizationId)
      : await auth.auth.oauth.denyAuthorization(authorizationId);
    if (result.error) throw result.error;
    if (result.data?.redirect_url) location.assign(result.data.redirect_url);
  } catch (error) { status.textContent = errorMessage(error); }
}
element("oauth-approve").addEventListener("click", () => void decideConsent(true));
element("oauth-deny").addEventListener("click", () => void decideConsent(false));

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
  const query = search.value.trim();
  const list = element("files");
  list.replaceChildren();
  const filtered = records.filter(file => matchesFile(file, query));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, totalPages);
  for (const file of filtered.slice((page - 1) * pageSize, page * pageSize)) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.textContent = file.title || file.original_name;
    button.title = file.title || file.original_name;
    button.addEventListener("click", () => openFile(file));
    const date = document.createElement("span");
    date.className = "file-meta";
    date.textContent = new Date(file.created_at).toLocaleDateString("ko-KR");
    const size = document.createElement("span");
    size.className = "file-meta";
    size.textContent = file.size_bytes < 1_000_000
      ? `${(file.size_bytes / 1000).toFixed(1)} KB`
      : `${(file.size_bytes / 1_000_000).toFixed(1)} MB`;
    row.append(button, date, size);
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
    const batch = await api<FileRecord[]>(`/rest/v1/files?select=id,original_name,title,size_bytes,created_at,deleted_at,summary,tags&upload_status=eq.uploaded&deleted_at=${deleted}&order=created_at.desc,id.desc&limit=${batchSize}&offset=${offset}`, { token });
    if (!session || trashView !== view) return;
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  if (!session) return;
  records = rows;
  renderFiles();
}

function openFile(file: FileRecord) {
  detailVersion++;
  selected = file;
  const set = (name: string, value: string) => { (fileForm.elements.namedItem(name) as HTMLInputElement).value = value; };
  set("title", file.title || file.original_name);
  set("summary", file.summary || "");
  set("tags", "");
  tagValues = [...file.tags];
  renderTags();
  savedSnapshot = snapshot();
  element("save-status").textContent = "";
  element("retry-save").hidden = true;
  (fileForm.elements.namedItem("title") as HTMLInputElement).readOnly = trashView;
  element<HTMLTextAreaElement>("summary").readOnly = trashView;
  element<HTMLInputElement>("tags").hidden = trashView;
  for (const kind of aiKinds) {
    clearAi(kind);
    const button = element<HTMLButtonElement>(`generate-${kind}`);
    button.hidden = trashView;
    setAiLoading(button, false);
  }
  element("original-name").textContent = `원본 파일명: ${file.original_name}`;
  element("file-info").textContent = `${file.size_bytes.toLocaleString()}바이트 · ${new Date(file.created_at).toLocaleDateString("ko-KR")}`;
  element("dialog-status").textContent = "";
  for (const id of ["download-file", "trash-file"]) element(id).hidden = trashView;
  for (const id of ["restore-file", "purge-file"]) element(id).hidden = !trashView;
  dialog.showModal();
}

async function changeFile(action: "trash" | "restore" | "purge") {
  if (!session || !selected) return;
  if (action === "trash" && !window.confirm("이 파일을 휴지통으로 이동하시겠습니까?")) return;
  if (action === "trash" && !(await saveChanges())) return;
  if (action === "purge" && !window.confirm("이 파일을 영구 삭제하시겠습니까? 복구할 수 없습니다.")) return;
  try {
    await fileAction(session, { action, id: selected.id });
    dialog.close();
    await refresh(session);
  } catch (error) { element("dialog-status").textContent = errorMessage(error); }
}
async function closeFile() {
  if (await saveChanges()) dialog.close();
}
element("close-dialog").addEventListener("click", () => void closeFile());
dialog.addEventListener("cancel", (event) => { event.preventDefault(); void closeFile(); });
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
fileForm.addEventListener("submit", (event) => event.preventDefault());

function renderTags() {
  const container = element("tag-chips");
  container.replaceChildren();
  tagValues.forEach((tag, index) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.append(document.createTextNode(tag));
    if (!trashView) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${tag} 태그 삭제`);
      remove.addEventListener("click", () => { tagValues.splice(index, 1); renderTags(); scheduleSave(); });
      chip.append(remove);
    }
    container.append(chip);
  });
}
function commitTags() {
  const field = element<HTMLInputElement>("tags");
  const additions = field.value.split(",").map(tag => tag.trim()).filter(Boolean);
  if (additions.length) {
    tagValues = [...new Set([...tagValues, ...additions])];
    field.value = "";
    renderTags();
  }
}
function snapshot() {
  return JSON.stringify({
    title: String(new FormData(fileForm).get("title") || "").trim(),
    summary: element<HTMLTextAreaElement>("summary").value,
    tags: tagValues,
  });
}
async function saveChanges(): Promise<boolean> {
  clearTimeout(saveTimer);
  if (!selected || trashView) return true;
  commitTags();
  if (saving) {
    if (!(await saving)) return false;
    if (snapshot() === savedSnapshot) return true;
  }
  const current = snapshot();
  if (current === savedSnapshot) return true;
  const data = JSON.parse(current) as { title: string; summary: string; tags: string[] };
  if (!data.title || data.tags.length > 50 || data.tags.some(tag => tag.length > 100)) {
    element("save-status").textContent = "제목과 태그를 확인해 주세요.";
    return false;
  }
  if (!session) {
    element("save-status").textContent = "로그인 세션이 만료되었습니다. 내용을 복사한 뒤 다시 로그인해 주세요.";
    return false;
  }
  const id = selected.id;
  element("save-status").textContent = "저장 중";
  element("retry-save").hidden = true;
  saving = (async () => {
    try {
      await fileAction(session!, { action: "update", id, ...data });
      savedSnapshot = current;
      const record = records.find(file => file.id === id);
      if (record) { record.title = data.title; record.summary = data.summary; record.tags = data.tags; }
      renderFiles();
      element("save-status").textContent = "저장됨";
      return true;
    } catch (error) {
      element("save-status").textContent = `저장 실패: ${errorMessage(error)}`;
      element("retry-save").hidden = false;
      return false;
    }
  })();
  const success = await saving;
  saving = undefined;
  if (success && snapshot() !== savedSnapshot) return saveChanges();
  return success;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  element("save-status").textContent = "저장 대기 중";
  saveTimer = setTimeout(() => void saveChanges(), 800);
}
fileForm.addEventListener("input", (event) => {
  if ((event.target as HTMLElement).id !== "tags") scheduleSave();
});
fileForm.addEventListener("focusout", (event) => {
  if ((event.target as HTMLElement).id === "tags") commitTags();
  if (!trashView && snapshot() !== savedSnapshot) void saveChanges();
});
const tagsInput = element<HTMLInputElement>("tags");
let composingTag = false;
let commitOnCompositionEnd = false;
tagsInput.addEventListener("compositionstart", () => {
  composingTag = true;
  commitOnCompositionEnd = false;
});
tagsInput.addEventListener("compositionend", () => {
  composingTag = false;
  if (commitOnCompositionEnd) {
    commitOnCompositionEnd = false;
    commitTags();
    scheduleSave();
  }
});
tagsInput.addEventListener("input", (event) => {
  if (!(event as InputEvent).isComposing && !composingTag && tagsInput.value.includes(",")) {
    commitTags();
    scheduleSave();
  }
});
tagsInput.addEventListener("keydown", (event) => {
  if (event.isComposing || composingTag || event.keyCode === 229) {
    if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") {
      commitOnCompositionEnd = true;
    }
    return;
  }
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    commitTags();
    scheduleSave();
  }
});
element("retry-save").addEventListener("click", () => void saveChanges());
window.addEventListener("beforeunload", (event) => {
  if (dialog.open && !trashView && (saving || snapshot() !== savedSnapshot || element<HTMLInputElement>("tags").value.trim())) {
    event.preventDefault();
  }
});

const aiKinds = ["summary", "tags"] as const;
type AiKind = typeof aiKinds[number];
const aiResults: { summary?: string; tags?: string[] } = {};
let detailVersion = 0;

function clearAi(kind: AiKind) {
  delete aiResults[kind];
  element(`ai-${kind}-preview`).hidden = true;
  const status = element(`ai-${kind}-status`);
  status.hidden = true;
  status.textContent = "";
}

function setAiLoading(button: HTMLButtonElement, loading: boolean) {
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  if (loading) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

async function generate(kind: AiKind) {
  if (!session || !selected) return;
  const target = selected.id;
  const filename = selected.original_name;
  const version = detailVersion;
  const isCurrent = () => dialog.open && detailVersion === version && selected?.id === target;
  const button = element<HTMLButtonElement>(`generate-${kind}`);
  setAiLoading(button, true);
  clearAi(kind);
  try {
    const download = await fileAction<{ url: string }>(session, { action: "download", id: target });
    const { extractBeginning } = await import("./extract-text");
    const source = await extractBeginning(download.url, filename);
    if (!isCurrent() || !session) return;
    const result = await fileAction<{ summary?: string; tags?: string[] }>(session, { action: "generate", id: target, kind, ...source });
    if (!isCurrent()) return;
    if (kind === "summary" && typeof result.summary === "string") aiResults.summary = result.summary;
    else if (kind === "tags" && Array.isArray(result.tags)) aiResults.tags = result.tags;
    else throw new Error("AI 결과를 읽지 못했습니다.");
    element(`ai-${kind}-result`).textContent = (kind === "summary" ? aiResults.summary : aiResults.tags?.join(", ")) ?? "";
    element(`ai-${kind}-preview`).hidden = false;
  } catch (error) {
    if (isCurrent()) {
      const status = element(`ai-${kind}-status`);
      status.hidden = false;
      status.textContent = errorMessage(error);
    }
  } finally { if (detailVersion === version) setAiLoading(button, false); }
}
function applyAi(kind: AiKind, append = false) {
  if (kind === "summary") {
    if (aiResults.summary === undefined) return;
    element<HTMLTextAreaElement>("summary").value = aiResults.summary;
  } else {
    const tags = aiResults.tags;
    if (!tags) return;
    commitTags();
    tagValues = [...new Set([...(append ? tagValues : []), ...tags])];
    renderTags();
  }
  clearAi(kind);
  scheduleSave();
}
for (const kind of aiKinds) {
  element(`generate-${kind}`).addEventListener("click", () => void generate(kind));
  element(`ai-${kind}-dismiss`).addEventListener("click", () => clearAi(kind));
  element(`ai-${kind}-apply`).addEventListener("click", () => applyAi(kind));
}
element("ai-tags-add").addEventListener("click", () => applyAi("tags", true));
element("show-upload").addEventListener("click", () => { filesPage.hidden = true; uploadPage.hidden = false; });
element("back-to-files").addEventListener("click", () => {
  uploadPage.hidden = true;
  element("uploads").replaceChildren();
  picker.value = "";
  filesPage.hidden = false;
});
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
    if (authorizationId) await showConsent();
    else await refresh(session);
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
  element("oauth-consent").hidden = true;
  logout.hidden = true;
  login.hidden = false;
  status.textContent = "";
}

logout.addEventListener("click", async () => {
  if (dialog.open && !(await saveChanges())) return;
  const { error } = await auth.auth.signOut({ scope: "local" });
  showSignedOut();
  if (error) status.textContent = "이 기기에서는 로그아웃했지만 서버 연결에 실패했습니다.";
});

auth.auth.onAuthStateChange((event, current) => {
  if (event === "TOKEN_REFRESHED" && current) session = current.access_token;
  if (event === "SIGNED_OUT") {
    if (dialog.open && !trashView && (saving || snapshot() !== savedSnapshot || element<HTMLInputElement>("tags").value.trim())) {
      session = undefined;
      element("save-status").textContent = "로그인 세션이 만료되었습니다. 내용을 복사한 뒤 다시 로그인해 주세요.";
      return;
    }
    showSignedOut();
  }
});

async function restoreSession() {
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) return;
  session = data.session.access_token;
  login.hidden = true;
  logout.hidden = false;
  element("library").hidden = false;
  try { if (authorizationId) await showConsent(); else await refresh(session); }
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
    const reason = unsupportedUploadReason(file.name, file.type) ?? uploadSizeReason(file.size);
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
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
