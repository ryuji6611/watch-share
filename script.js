const MAX_TITLE = 120;
const MAX_NOTE = 160;
const MAX_OVERVIEW = 600;
const DEFAULT_ROOM = "main";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

const addForm = document.getElementById("add-form");
const titleInput = document.getElementById("title");
const typeInput = document.getElementById("type");
const noteInput = document.getElementById("note");
const posterUrlInput = document.getElementById("poster-url");
const searchInput = document.getElementById("search");
const shareBtn = document.getElementById("share-btn");
const clearBtn = document.getElementById("clear-btn");
const shareMessage = document.getElementById("share-message");
const statsMessage = document.getElementById("stats-message");
const todoListEl = document.getElementById("todo-list");
const watchedListEl = document.getElementById("watched-list");
const todoEmptyEl = document.getElementById("todo-empty");
const watchedEmptyEl = document.getElementById("watched-empty");
const itemTemplate = document.getElementById("item-template");
const roomLabel = document.getElementById("room-label");

const url = new URL(window.location.href);
const roomId = normalizeRoomId(url.searchParams.get("room"));
let items = [];
let supabaseClient = null;
let realtimeChannel = null;

roomLabel.textContent = `ルーム: ${roomId}`;
searchInput.addEventListener("input", render);

shareBtn.addEventListener("click", async () => {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("room", roomId);

  try {
    await navigator.clipboard.writeText(shareUrl.toString());
    setMessage("共有URLをコピーしました。Discordに貼って使ってください。", "success");
  } catch {
    setMessage(`共有URL: ${shareUrl.toString()}`);
  }
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;

  const title = titleInput.value.trim();
  const type = typeInput.value === "ドラマ" ? "ドラマ" : "映画";
  const note = noteInput.value.trim();
  const manualPosterUrl = sanitizePosterUrl(posterUrlInput.value);

  if (!title) return;

  const tmdbMeta = await resolveTmdbMeta(title, type);
  const posterUrl = manualPosterUrl || tmdbMeta.posterUrl;
  const { error } = await supabaseClient.from("watch_items").insert({
    room_id: roomId,
    title: title.slice(0, MAX_TITLE),
    type,
    note: note.slice(0, MAX_NOTE),
    poster_url: posterUrl,
    overview_ja: tmdbMeta.overviewJa.slice(0, MAX_OVERVIEW),
    watched: false,
  });

  if (error) {
    setMessage(`追加に失敗しました: ${error.message}`, "error");
    return;
  }

  await fetchItems();
  addForm.reset();
  titleInput.focus();
  setMessage("作品を追加しました。", "success");
});

clearBtn.addEventListener("click", async () => {
  if (!supabaseClient) return;

  const ok = window.confirm(`ルーム「${roomId}」の作品をすべて削除しますか？`);
  if (!ok) return;

  const { error } = await supabaseClient.from("watch_items").delete().eq("room_id", roomId);
  if (error) {
    setMessage(`削除に失敗しました: ${error.message}`, "error");
    return;
  }

  await fetchItems();
  setMessage("このルームのリストを削除しました。", "success");
});

bootstrap();

async function bootstrap() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setMessage("Supabaseライブラリの読み込みに失敗しました。", "error");
    setUiDisabled();
    return;
  }

  const supabaseUrl = normalizeSupabaseUrl(window.WATCHSHARE_SUPABASE_URL);
  const supabaseAnonKey = String(window.WATCHSHARE_SUPABASE_ANON_KEY || "").trim();

  if (!isConfigured(supabaseUrl, supabaseAnonKey)) {
    setMessage("`supabase-config.js` のURLまたはAnon Keyの形式が不正です。", "error");
    setUiDisabled();
    return;
  }

  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

  await fetchItems();
  subscribeRealtime();
}

async function fetchItems() {
  const { data, error } = await supabaseClient
    .from("watch_items")
    .select("id, title, type, note, watched, poster_url, overview_ja, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });

  if (error) {
    setMessage(`読み込みに失敗しました: ${error.message}`, "error");
    return;
  }

  items = (data || []).map((item) => sanitizeItem(item));
  render();
}

function subscribeRealtime() {
  realtimeChannel = supabaseClient
    .channel(`watch-items-${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "watch_items",
        filter: `room_id=eq.${roomId}`,
      },
      async () => {
        await fetchItems();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setMessage("リアルタイム同期中です。", "success");
      }
    });
}

function render() {
  todoListEl.innerHTML = "";
  watchedListEl.innerHTML = "";

  const query = searchInput.value.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const statusLabel = item.watched ? "視聴済み" : "見たい";
    const text = `${item.title} ${item.note} ${item.overviewJa} ${item.type} ${statusLabel}`.toLowerCase();
    return text.includes(query);
  });

  const todoItems = filtered.filter((item) => !item.watched);
  const watchedItems = filtered.filter((item) => item.watched);

  for (const item of todoItems) {
    todoListEl.appendChild(createItemNode(item));
  }

  for (const item of watchedItems) {
    watchedListEl.appendChild(createItemNode(item));
  }

  todoEmptyEl.classList.toggle("hidden", todoItems.length !== 0);
  watchedEmptyEl.classList.toggle("hidden", watchedItems.length !== 0);
  updateStats(filtered.length);
}

function createItemNode(item) {
  const node = itemTemplate.content.firstElementChild.cloneNode(true);
  const posterEl = node.querySelector(".poster");
  const titleEl = node.querySelector("h3");
  const summaryEl = node.querySelector(".summary");
  const noteEl = node.querySelector(".note");
  const typeBadge = node.querySelector(".type-badge");
  const toggleBtn = node.querySelector(".toggle-btn");
  const deleteBtn = node.querySelector(".delete-btn");

  posterEl.src = item.posterUrl || createPosterPlaceholder(item.title);
  posterEl.alt = `${item.title} のポスター`;
  posterEl.addEventListener(
    "error",
    () => {
      posterEl.src = createPosterPlaceholder(item.title);
    },
    { once: true },
  );

  titleEl.textContent = item.title;
  summaryEl.textContent = item.overviewJa || "";
  summaryEl.classList.toggle("hidden", !item.overviewJa);
  noteEl.textContent = item.note ? `メモ: ${item.note}` : "";
  noteEl.classList.toggle("hidden", !item.note);
  typeBadge.textContent = item.type;
  typeBadge.style.background = item.type === "映画" ? "#e2553f" : "#0f7b74";
  toggleBtn.textContent = item.watched ? "未視聴に戻す" : "視聴済みにする";

  if (item.watched) {
    node.classList.add("watched");
  }

  toggleBtn.addEventListener("click", async () => {
    const { error } = await supabaseClient
      .from("watch_items")
      .update({ watched: !item.watched })
      .eq("id", item.id)
      .eq("room_id", roomId);

    if (error) {
      setMessage(`更新に失敗しました: ${error.message}`, "error");
      return;
    }

    await fetchItems();
    setMessage("ステータスを更新しました。", "success");
  });

  deleteBtn.addEventListener("click", async () => {
    const { error } = await supabaseClient
      .from("watch_items")
      .delete()
      .eq("id", item.id)
      .eq("room_id", roomId);

    if (error) {
      setMessage(`削除に失敗しました: ${error.message}`, "error");
      return;
    }

    await fetchItems();
    setMessage("作品を削除しました。", "success");
  });

  return node;
}

function sanitizeItem(item) {
  return {
    id: String(item.id),
    title: String(item.title || "").slice(0, MAX_TITLE),
    type: item.type === "ドラマ" ? "ドラマ" : "映画",
    note: String(item.note || "").slice(0, MAX_NOTE),
    posterUrl: String(item.poster_url || ""),
    overviewJa: String(item.overview_ja || "").slice(0, MAX_OVERVIEW),
    watched: Boolean(item.watched),
  };
}

function sanitizePosterUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value.slice(0, 400);
}

function normalizeRoomId(value) {
  if (!value) return DEFAULT_ROOM;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(normalized)) {
    return DEFAULT_ROOM;
  }
  return normalized;
}

function isConfigured(url, key) {
  if (!url || !key) return false;
  if (url === "YOUR_SUPABASE_URL") return false;
  if (key === "YOUR_SUPABASE_ANON_KEY") return false;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return false;
  if (url.includes(";")) return false;
  const isLegacyAnon = key.startsWith("eyJ");
  const isPublishable = key.startsWith("sb_publishable_");
  if (!isLegacyAnon && !isPublishable) return false;
  return true;
}

function normalizeSupabaseUrl(raw) {
  let url = String(raw || "").trim();
  url = url.replace(/;+$/g, "");
  url = url.replace(/\/+$/g, "");
  url = url.replace(/\/rest\/v1$/i, "");
  return url;
}

function setUiDisabled() {
  addForm.querySelector("button").disabled = true;
  clearBtn.disabled = true;
}

function setMessage(text, type = "") {
  shareMessage.textContent = text;
  shareMessage.classList.remove("error", "success");
  if (type) {
    shareMessage.classList.add(type);
  }
}

function updateStats(filteredCount) {
  const total = items.length;
  const todoCount = items.filter((item) => !item.watched).length;
  const watchedCount = total - todoCount;
  const suffix = filteredCount === total ? "" : ` | 検索一致: ${filteredCount}件`;
  statsMessage.textContent = `全${total}件 | 見たい: ${todoCount}件 | 視聴済み: ${watchedCount}件${suffix}`;
}

async function resolveTmdbMeta(title, type) {
  const apiKey = String(window.WATCHSHARE_TMDB_API_KEY || "").trim();
  if (!apiKey || apiKey === "YOUR_TMDB_API_KEY") {
    return { posterUrl: "", overviewJa: "" };
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    query: title,
    language: "ja-JP",
    include_adult: "false",
  });

  try {
    const response = await fetch(`https://api.themoviedb.org/3/search/multi?${params.toString()}`);
    if (!response.ok) return { posterUrl: "", overviewJa: "" };
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results : [];
    const kind = type === "ドラマ" ? "tv" : "movie";
    const preferred = results.find((x) => x && x.media_type === kind);
    const fallback = results.find((x) => x && (x.media_type === "movie" || x.media_type === "tv"));
    const picked = preferred || fallback;
    if (!picked) return { posterUrl: "", overviewJa: "" };

    const posterUrl = picked.poster_path ? `${TMDB_IMAGE_BASE}${picked.poster_path}` : "";
    const overviewJa = typeof picked.overview === "string" ? picked.overview.trim() : "";
    return { posterUrl, overviewJa };
  } catch {
    return { posterUrl: "", overviewJa: "" };
  }
}

function createPosterPlaceholder(title) {
  const first = String(title || "?").trim().charAt(0) || "?";
  const safeFirst = escapeSvgText(first);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='92'><rect width='100%' height='100%' fill='%23ece7df'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='28' fill='%23697484' font-family='Arial'>${safeFirst}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

window.addEventListener("beforeunload", () => {
  if (supabaseClient && realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }
});
