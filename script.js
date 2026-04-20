const MAX_TITLE = 120;
const MAX_NOTE = 160;
const DEFAULT_ROOM = "main";

const addForm = document.getElementById("add-form");
const titleInput = document.getElementById("title");
const typeInput = document.getElementById("type");
const noteInput = document.getElementById("note");
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

  if (!title) return;

  const { error } = await supabaseClient.from("watch_items").insert({
    room_id: roomId,
    title: title.slice(0, MAX_TITLE),
    type,
    note: note.slice(0, MAX_NOTE),
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
    .select("id, title, type, note, watched, created_at")
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
    const text = `${item.title} ${item.note} ${item.type} ${statusLabel}`.toLowerCase();
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
    const titleEl = node.querySelector("h3");
    const noteEl = node.querySelector(".note");
    const typePill = node.querySelector(".type-pill");
    const toggleBtn = node.querySelector(".toggle-btn");
    const deleteBtn = node.querySelector(".delete-btn");

    titleEl.textContent = item.title;
    noteEl.textContent = item.note || "メモなし";
    typePill.textContent = item.type;
    typePill.style.background = item.type === "映画" ? "#e2553f" : "#0f7b74";
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
    watched: Boolean(item.watched),
  };
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

window.addEventListener("beforeunload", () => {
  if (supabaseClient && realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }
});
