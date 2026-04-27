const MAX_TITLE = 120;
const MAX_NOTE = 160;
const MAX_OVERVIEW = 600;
const DEFAULT_ROOM = "main";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const TYPE_OPTIONS = ["洋画", "邦画", "国内ドラマ", "海外ドラマ"];
const SUGGESTION_LIMIT = 8;
const TRAILER_TIMEOUT_MS = 8000;

const addForm = document.getElementById("add-form");
const titleInput = document.getElementById("title");
const typeInput = document.getElementById("type");
const noteInput = document.getElementById("note");
const searchInput = document.getElementById("search");
const titleSuggestionsEl = document.getElementById("title-suggestions");
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
const trailerModalEl = document.getElementById("trailer-modal");
const trailerCloseBtn = document.getElementById("trailer-close");
const trailerStatusEl = document.getElementById("trailer-status");
const trailerFrameEl = document.getElementById("trailer-frame");
const trailerTitleEl = document.getElementById("trailer-title");

const url = new URL(window.location.href);
const roomId = normalizeRoomId(url.searchParams.get("room"));
let items = [];
let supabaseClient = null;
let realtimeChannel = null;
let suggestionTimer = null;
let suggestionAbortController = null;
let latestSuggestions = [];
let trailerAbortController = null;
let trailerRequestToken = 0;
const trailerCache = new Map();

roomLabel.textContent = `ルーム: ${roomId}`;
searchInput.addEventListener("input", render);
titleInput.addEventListener("input", handleTitleInput);
titleInput.addEventListener("change", applySuggestionTypeIfMatched);
trailerCloseBtn.addEventListener("click", closeTrailerModal);
trailerModalEl.addEventListener("click", (event) => {
  if (event.target === trailerModalEl) {
    closeTrailerModal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !trailerModalEl.classList.contains("hidden")) {
    closeTrailerModal();
  }
});

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
  const type = normalizeType(typeInput.value);
  const note = noteInput.value.trim();

  if (!title) return;

  const tmdbMeta = await resolveTmdbMeta(title, type);
  const posterUrl = tmdbMeta.posterUrl;
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
  typeInput.value = TYPE_OPTIONS[0];
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
  const typeSelect = node.querySelector(".type-select");
  const toggleBtn = node.querySelector(".toggle-btn");
  const deleteBtn = node.querySelector(".delete-btn");
  const itemMain = node.querySelector(".item-main");

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

  TYPE_OPTIONS.forEach((optionType) => {
    const option = document.createElement("option");
    option.value = optionType;
    option.textContent = optionType;
    typeSelect.appendChild(option);
  });
  typeSelect.value = normalizeType(item.type);
  typeSelect.style.background = typeColor(typeSelect.value);

  typeSelect.addEventListener("change", async () => {
    const nextType = normalizeType(typeSelect.value);
    const { error } = await supabaseClient
      .from("watch_items")
      .update({ type: nextType })
      .eq("id", item.id)
      .eq("room_id", roomId);

    if (error) {
      setMessage(`種別更新に失敗しました: ${error.message}`, "error");
      typeSelect.value = normalizeType(item.type);
      typeSelect.style.background = typeColor(typeSelect.value);
      return;
    }

    typeSelect.style.background = typeColor(nextType);
    await fetchItems();
    setMessage("種別を更新しました。", "success");
  });

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

  itemMain.addEventListener("click", async (event) => {
    if (event.target.closest(".type-select")) return;
    await openTrailerModal(item);
  });

  return node;
}

function sanitizeItem(item) {
  return {
    id: String(item.id),
    title: String(item.title || "").slice(0, MAX_TITLE),
    type: normalizeType(item.type),
    note: String(item.note || "").slice(0, MAX_NOTE),
    posterUrl: String(item.poster_url || ""),
    overviewJa: String(item.overview_ja || "").slice(0, MAX_OVERVIEW),
    watched: Boolean(item.watched),
  };
}

function normalizeType(value) {
  if (TYPE_OPTIONS.includes(value)) return value;
  if (value === "映画") return "邦画";
  if (value === "ドラマ") return "国内ドラマ";
  return TYPE_OPTIONS[0];
}

function inferTypeFromSuggestion(suggestion) {
  const mediaType = suggestion.mediaType;
  const lang = String(suggestion.originalLanguage || "").toLowerCase();
  if (mediaType === "movie") return lang === "ja" ? "邦画" : "洋画";
  if (mediaType === "tv") return lang === "ja" ? "国内ドラマ" : "海外ドラマ";
  return null;
}

function typeColor(type) {
  if (type === "洋画") return "#6f49cf";
  if (type === "邦画") return "#e2553f";
  if (type === "国内ドラマ") return "#0f7b74";
  if (type === "海外ドラマ") return "#2f7dbd";
  return "#4d6070";
}

function handleTitleInput() {
  const query = titleInput.value.trim();
  if (query.length < 2) {
    clearSuggestions();
    return;
  }

  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(() => {
    fetchTitleSuggestions(query);
  }, 220);
}

function applySuggestionTypeIfMatched() {
  const matched = findSuggestionByTitle(titleInput.value.trim());
  if (!matched) return;
  const inferred = inferTypeFromSuggestion(matched);
  if (!inferred) return;
  typeInput.value = inferred;
}

async function fetchTitleSuggestions(query) {
  const apiKey = String(window.WATCHSHARE_TMDB_API_KEY || "").trim();
  if (!apiKey || apiKey === "YOUR_TMDB_API_KEY") {
    clearSuggestions();
    return;
  }

  if (suggestionAbortController) {
    suggestionAbortController.abort();
  }
  suggestionAbortController = new AbortController();

  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    language: "ja-JP",
    include_adult: "false",
  });

  try {
    const response = await fetch(`https://api.themoviedb.org/3/search/multi?${params.toString()}`, {
      signal: suggestionAbortController.signal,
    });
    if (!response.ok) {
      clearSuggestions();
      return;
    }

    const payload = await response.json();
    const raw = Array.isArray(payload.results) ? payload.results : [];
    const seen = new Set();
    const suggestions = [];

    for (const item of raw) {
      if (!item || (item.media_type !== "movie" && item.media_type !== "tv")) continue;
      const title = String(item.title || item.name || "").trim();
      if (!title) continue;
      const key = `${item.media_type}:${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({
        title,
        mediaType: item.media_type,
        originalLanguage: item.original_language || "",
        posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : "",
        overviewJa: typeof item.overview === "string" ? item.overview.trim() : "",
      });

      if (suggestions.length >= SUGGESTION_LIMIT) break;
    }

    latestSuggestions = suggestions;
    renderSuggestionList(suggestions);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    clearSuggestions();
  }
}

function renderSuggestionList(suggestions) {
  titleSuggestionsEl.innerHTML = "";
  for (const suggestion of suggestions) {
    const option = document.createElement("option");
    option.value = suggestion.title;
    titleSuggestionsEl.appendChild(option);
  }
}

function clearSuggestions() {
  latestSuggestions = [];
  titleSuggestionsEl.innerHTML = "";
}

async function openTrailerModal(item) {
  trailerRequestToken += 1;
  const requestToken = trailerRequestToken;
  if (trailerAbortController) {
    trailerAbortController.abort();
  }
  trailerAbortController = new AbortController();

  trailerTitleEl.textContent = `${item.title} の予告編`;
  trailerStatusEl.textContent = "予告編を探しています...";
  trailerStatusEl.classList.remove("hidden");
  trailerFrameEl.classList.add("hidden");
  trailerFrameEl.src = "";
  trailerModalEl.classList.remove("hidden");
  trailerModalEl.setAttribute("aria-hidden", "false");

  const cacheKey = `${item.id}:${item.title}:${item.type}`;
  if (trailerCache.has(cacheKey)) {
    trailerFrameEl.src = trailerCache.get(cacheKey);
    trailerStatusEl.classList.add("hidden");
    trailerFrameEl.classList.remove("hidden");
    return;
  }

  const trailerUrl = await resolveTrailerUrl(item.title, item.type, trailerAbortController.signal);
  if (requestToken !== trailerRequestToken) return;
  if (!trailerUrl) {
    trailerStatusEl.textContent = "予告編が見つかりませんでした。";
    return;
  }

  trailerCache.set(cacheKey, trailerUrl);
  trailerFrameEl.src = trailerUrl;
  trailerStatusEl.classList.add("hidden");
  trailerFrameEl.classList.remove("hidden");
}

function closeTrailerModal() {
  trailerRequestToken += 1;
  if (trailerAbortController) {
    trailerAbortController.abort();
    trailerAbortController = null;
  }
  trailerModalEl.classList.add("hidden");
  trailerModalEl.setAttribute("aria-hidden", "true");
  trailerFrameEl.src = "";
}

async function resolveTrailerUrl(title, type, signal) {
  const apiKey = String(window.WATCHSHARE_TMDB_API_KEY || "").trim();
  if (!apiKey || apiKey === "YOUR_TMDB_API_KEY") {
    trailerStatusEl.textContent = "TMDB APIキー未設定のため再生できません。";
    return "";
  }

  const baseInfo = await resolveTmdbBaseInfo(title, type, apiKey, signal);
  if (!baseInfo) return "";

  const videoKey = await fetchTrailerVideoKey(apiKey, baseInfo.mediaType, baseInfo.id, signal);
  if (!videoKey) return "";
  return `https://www.youtube.com/embed/${videoKey}`;
}

async function resolveTmdbBaseInfo(title, type, apiKey, signal) {
  const params = new URLSearchParams({
    api_key: apiKey,
    query: title,
    language: "ja-JP",
    include_adult: "false",
  });

  try {
    const response = await fetchWithTimeout(
      `https://api.themoviedb.org/3/search/multi?${params.toString()}`,
      { signal },
      TRAILER_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results : [];
    const preferredMedia = type === "国内ドラマ" || type === "海外ドラマ" ? "tv" : "movie";
    const preferred = results.find((x) => x && x.media_type === preferredMedia);
    const fallback = results.find((x) => x && (x.media_type === "movie" || x.media_type === "tv"));
    const picked = preferred || fallback;
    if (!picked || !picked.id || !picked.media_type) return null;
    return { id: picked.id, mediaType: picked.media_type };
  } catch (error) {
    if (error && error.name === "AbortError") return null;
    trailerStatusEl.textContent = "通信がタイムアウトしました。もう一度お試しください。";
    return null;
  }
}

async function fetchTrailerVideoKey(apiKey, mediaType, tmdbId, signal) {
  const languages = ["ja-JP", "en-US", ""];
  for (const language of languages) {
    const params = new URLSearchParams({ api_key: apiKey });
    if (language) params.set("language", language);
    try {
      const response = await fetchWithTimeout(
        `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?${params.toString()}`,
        { signal },
        TRAILER_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const payload = await response.json();
      const results = Array.isArray(payload.results) ? payload.results : [];
      const youtubeOnly = results.filter((x) => x && x.site === "YouTube");
      const trailer = youtubeOnly.find((x) => x.type === "Trailer") || youtubeOnly.find((x) => x.type === "Teaser") || youtubeOnly[0];
      if (trailer && trailer.key) return trailer.key;
    } catch (error) {
      if (error && error.name === "AbortError") return "";
      continue;
    }
  }
  return "";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  try {
    const mergedSignal = combineSignals(options.signal, timeoutController.signal);
    return await fetch(url, { ...options, signal: mergedSignal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineSignals(signalA, signalB) {
  if (!signalA) return signalB;
  if (!signalB) return signalA;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signalA.addEventListener("abort", onAbort, { once: true });
  signalB.addEventListener("abort", onAbort, { once: true });
  if (signalA.aborted || signalB.aborted) {
    controller.abort();
  }
  return controller.signal;
}

function findSuggestionByTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  if (!normalized) return null;
  return latestSuggestions.find((x) => x.title.toLowerCase() === normalized) || null;
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
  const matched = findSuggestionByTitle(title);
  if (matched) {
    return {
      posterUrl: matched.posterUrl,
      overviewJa: matched.overviewJa,
    };
  }

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
    const preferredMedia = type === "国内ドラマ" || type === "海外ドラマ" ? "tv" : "movie";
    const preferred = results.find((x) => x && x.media_type === preferredMedia);
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
  if (trailerAbortController) {
    trailerAbortController.abort();
  }
  if (supabaseClient && realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }
});
