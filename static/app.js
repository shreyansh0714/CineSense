/* CineSense frontend — intake form, SSE streaming, conversational refinement. */

let sessionId = null;

const intakeView = document.getElementById("intake-view");
const chatView = document.getElementById("chat-view");
const messagesEl = document.getElementById("messages");
const intakeForm = document.getElementById("intake-form");
const submitBtn = document.getElementById("submit-btn");
const refineForm = document.getElementById("refine-form");
const refineInput = document.getElementById("refine-input");
const refineBtn = document.getElementById("refine-btn");

/* ---------- mood suggestion chips ---------- */
document.getElementById("mood-chips").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;
  const mood = document.getElementById("mood");
  mood.value = e.target.textContent;
  mood.focus();
});

/* ---------- minimal markdown renderer (##, **, *, line breaks) ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // Block structure: "## " lines become h2, everything else becomes
  // paragraphs (double newline = new paragraph, single newline = <br>)
  return html
    .split(/\n{2,}/)
    .map((block) => {
      let out = "";
      let para = [];
      const flush = () => {
        if (para.length) out += `<p>${para.join("<br>")}</p>`;
        para = [];
      };
      for (const line of block.split("\n")) {
        const h = line.match(/^## (.+)$/);
        if (h) {
          flush();
          out += `<h2>${h[1]}</h2>`;
        } else {
          para.push(line);
        }
      }
      flush();
      return out;
    })
    .join("");
}

/* ---------- message bubbles ---------- */
function addUserBubble(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  messagesEl.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

function addAssistantBubble() {
  const div = document.createElement("div");
  div.className = "msg assistant cursor";
  messagesEl.appendChild(div);
  return div;
}

function addErrorBubble(text) {
  const div = document.createElement("div");
  div.className = "msg error";
  div.textContent = text;
  messagesEl.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

/* ---------- SSE over fetch (EventSource can't POST) ---------- */
async function streamRequest(url, body, bubble) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      detail = (await res.json()).detail || detail;
    } catch (_) { /* non-JSON error body */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line
    const events = buffer.split("\n\n");
    buffer = events.pop(); // keep incomplete trailing chunk

    for (const raw of events) {
      let eventName = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);

      if (eventName === "session") {
        sessionId = payload.id;
      } else if (eventName === "delta") {
        fullText += payload.text;
        bubble.innerHTML = renderMarkdown(fullText); // progressive render
        bubble.scrollIntoView({ behavior: "smooth", block: "end" });
      } else if (eventName === "error") {
        throw new Error(payload.message);
      } else if (eventName === "done") {
        bubble.classList.remove("cursor");
      }
    }
  }
  bubble.classList.remove("cursor");
  return fullText;
}

/* ---------- first recommendation ---------- */
intakeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const favorites = [];
  document.querySelectorAll(".favorite").forEach((row) => {
    const title = row.querySelector(".fav-title").value.trim();
    const why = row.querySelector(".fav-why").value.trim();
    if (title) favorites.push({ title, why });
  });
  if (favorites.length === 0) return;

  const body = {
    mood: document.getElementById("mood").value.trim(),
    favorites,
    constraints: document.getElementById("constraints").value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Thinking...";

  intakeView.hidden = true;
  chatView.hidden = false;

  const summary =
    `Mood: ${body.mood}\n` +
    favorites.map((f) => `Loved: ${f.title}${f.why ? " — " + f.why : ""}`).join("\n") +
    (body.constraints ? `\nLimits: ${body.constraints}` : "");
  addUserBubble(summary);

  const bubble = addAssistantBubble();
  try {
    await streamRequest("/api/recommend", body, bubble);
  } catch (err) {
    bubble.remove();
    addErrorBubble(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Find my movie";
    refineInput.focus();
  }
});

/* ---------- refinement turns ---------- */
refineForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = refineInput.value.trim();
  if (!message || !sessionId) return;

  refineInput.value = "";
  refineBtn.disabled = true;
  addUserBubble(message);

  const bubble = addAssistantBubble();
  try {
    await streamRequest("/api/refine", { session_id: sessionId, message }, bubble);
  } catch (err) {
    bubble.remove();
    addErrorBubble(err.message);
  } finally {
    refineBtn.disabled = false;
    refineInput.focus();
  }
});

/* ---------- start over ---------- */
document.getElementById("restart-btn").addEventListener("click", () => {
  sessionId = null;
  messagesEl.innerHTML = "";
  chatView.hidden = true;
  intakeView.hidden = false;
  window.scrollTo({ top: 0 });
});
