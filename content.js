/**
 * Natural Voice Reader v1.1.0 — Fluent Sentence-Pipelined Content Script
 *
 * Why v1.1.0 is dramatically more fluent:
 * 1. Sentence-Level Prosody (Never chops mid-sentence at visual line wraps):
 *    Visual lines are used ONLY for visual highlighting and Prev/Next Line navigation.
 *    The speech engine speaks full sentences/clauses using Intl.Segmenter so the voice
 *    maintains natural human intonation across line wraps.
 * 2. Lookahead Utterance Pipelining (Zero-Gap Transitions):
 *    Pre-queues upcoming sentences into window.speechSynthesis while the current sentence
 *    is still speaking. Chrome pre-fetches/synthesizes the next sentence in the background,
 *    eliminating the 400ms network/synthesis pause between sentences and paragraphs.
 * 3. Smart Text Normalization:
 *    Strips inline Wikipedia/academic citation brackets like [1], [12], soft hyphens,
 *    and awkward line-break artifacts without losing exact word-to-DOM-Range mapping.
 * 4. Pure Native Neural Pitch (1.0):
 *    Preserves native neural voice prosody without metallic pitch-resampling artifacts.
 */

(() => {
  if (window.__NVR_INITIALIZED__) return;
  window.__NVR_INITIALIZED__ = true;

  // --- State ---
  const state = {
    paragraphs: [],        // Array of paragraph models
    utteranceQueue: [],    // Flattened list of speakable sentence chunks across the page
    queueCursor: 0,        // Index of chunk currently speaking
    enqueuedUpTo: -1,      // Highest chunk index pushed into window.speechSynthesis lookahead
    pIndex: 0,             // Active paragraph index
    lIndex: 0,             // Active visual line index inside active paragraph
    wIndex: 0,             // Active word index inside active visual line
    isPlaying: false,
    isPaused: false,
    clickToRead: true,
    autoScroll: true,
    widgetVisible: true,
    minimized: false,
    rate: 1.0,
    voiceURI: "",
    flowMode: "fluent",    // fluent (zero-gap pipeline) | relaxed (gentle pause) | brisk
    voices: [],
    posX: null,
    posY: null,
    sessionId: 0,
    wordTimer: null,
    keepAliveTimer: null
  };

  const LOOKAHEAD_SIZE = 3; // Number of sentences pre-queued into speechSynthesis simultaneously

  // --- Settings Persistence ---
  function loadSettings() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["nvrSettings", "nvrPosition"], (res) => {
        if (res.nvrSettings) {
          Object.assign(state, res.nvrSettings);
        }
        if (res.nvrPosition && typeof res.nvrPosition.x === "number") {
          state.posX = res.nvrPosition.x;
          state.posY = res.nvrPosition.y;
          applyWidgetPosition();
        }
        syncUIFromState();
      });
    }
  }

  function saveSettings() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        nvrSettings: {
          rate: state.rate,
          voiceURI: state.voiceURI,
          flowMode: state.flowMode,
          clickToRead: state.clickToRead,
          autoScroll: state.autoScroll,
          widgetVisible: state.widgetVisible
        }
      });
    }
  }

  function savePosition() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        nvrPosition: { x: state.posX, y: state.posY }
      });
    }
  }

  // --- Build Isolated Shadow DOM Floating Player & Highlight Overlays ---
  const host = document.createElement("div");
  host.id = "nvr-extension-root";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif; }
    
    #nvr-highlights {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483640;
    }
    .nvr-hl-para {
      position: fixed;
      background: rgba(59, 130, 246, 0.05);
      border-left: 3px solid rgba(37, 99, 235, 0.75);
      border-radius: 4px;
      pointer-events: none;
      transition: top 0.14s ease-out, left 0.14s ease-out, width 0.14s ease-out, height 0.14s ease-out;
    }
    .nvr-hl-line {
      position: fixed;
      background: rgba(250, 204, 21, 0.22);
      border-bottom: 2px solid rgba(234, 179, 8, 0.65);
      border-radius: 3px;
      pointer-events: none;
      transition: top 0.1s ease-out, left 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out;
    }
    .nvr-hl-word {
      position: fixed;
      background: rgba(249, 115, 22, 0.36);
      outline: 2px solid rgba(234, 88, 12, 0.85);
      border-radius: 3px;
      pointer-events: none;
      transition: top 0.05s linear, left 0.05s linear, width 0.05s linear;
    }

    #nvr-player {
      position: fixed;
      top: 24px;
      right: 24px;
      width: 360px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(12px);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 16px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06);
      pointer-events: auto;
      user-select: none;
      z-index: 2147483647;
      overflow: hidden;
    }
    #nvr-player.hidden { display: none !important; }
    #nvr-player.minimized { width: 236px; }
    #nvr-player.minimized .nvr-body { display: none; }

    .nvr-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(90deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      cursor: grab;
    }
    .nvr-header:active { cursor: grabbing; }
    .nvr-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .nvr-grip { color: #64748b; font-size: 15px; }
    .nvr-badge-live {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .nvr-win-btns { display: flex; gap: 4px; }
    .nvr-icon-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }
    .nvr-icon-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }

    .nvr-body {
      padding: 12px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    .nvr-status-box {
      background: rgba(30, 41, 59, 0.75);
      border: 1px solid rgba(148, 163, 184, 0.15);
      border-radius: 10px;
      padding: 8px 10px;
    }
    .nvr-status-meta {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .nvr-status-text {
      font-size: 12px;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
    }

    .nvr-nav-section {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .nvr-nav-row, .nvr-nav-row-secondary {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 6px;
      align-items: center;
    }
    .nvr-btn {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.22);
      color: #f1f5f9;
      padding: 7px 10px;
      border-radius: 9px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    .nvr-btn:hover {
      background: rgba(51, 65, 85, 0.95);
      border-color: rgba(148, 163, 184, 0.45);
      transform: translateY(-1px);
    }
    .nvr-btn:active { transform: translateY(0); }
    .nvr-btn-primary {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      border-color: #3b82f6;
      color: #ffffff;
      padding: 8px 18px;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    }
    .nvr-btn-primary:hover {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
    }
    .nvr-btn-stop {
      padding: 7px 14px;
      color: #fca5a5;
      border-color: rgba(248, 113, 113, 0.28);
    }
    .nvr-btn-stop:hover {
      background: rgba(127, 29, 29, 0.45);
      border-color: rgba(248, 113, 113, 0.5);
    }

    .nvr-speed-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(30, 41, 59, 0.6);
      padding: 7px 10px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.14);
    }
    .nvr-speed-label {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      min-width: 40px;
    }
    .nvr-speed-step {
      width: 28px;
      height: 26px;
      border-radius: 7px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(15, 23, 42, 0.8);
      color: #f8fafc;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .nvr-speed-step:hover {
      background: rgba(51, 65, 85, 0.9);
      border-color: #60a5fa;
    }
    .nvr-speed-slider {
      flex: 1;
      accent-color: #3b82f6;
      height: 5px;
      cursor: pointer;
    }
    .nvr-speed-val {
      font-size: 12px;
      font-weight: 700;
      color: #60a5fa;
      min-width: 42px;
      text-align: right;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .nvr-speed-val:hover { background: rgba(59, 130, 246, 0.15); }

    .nvr-voice-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .nvr-field-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nvr-field-label {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      width: 52px;
      flex-shrink: 0;
    }
    .nvr-select {
      flex: 1;
      background: rgba(30, 41, 59, 0.9);
      color: #f1f5f9;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 11.5px;
      outline: none;
      cursor: pointer;
      width: 100%;
    }
    .nvr-select:focus { border-color: #3b82f6; }

    .nvr-toggles {
      display: flex;
      gap: 6px;
      padding-top: 2px;
    }
    .nvr-pill-toggle {
      flex: 1;
      font-size: 11px;
      font-weight: 600;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(30, 41, 59, 0.5);
      color: #94a3b8;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .nvr-pill-toggle.active {
      background: rgba(37, 99, 235, 0.22);
      border-color: rgba(59, 130, 246, 0.55);
      color: #93c5fd;
    }
  `;
  shadow.appendChild(styleEl);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div id="nvr-highlights">
      <div class="nvr-hl-para" id="nvr-hl-para" style="display:none;"></div>
      <div class="nvr-hl-line" id="nvr-hl-line" style="display:none;"></div>
      <div class="nvr-hl-word" id="nvr-hl-word" style="display:none;"></div>
    </div>

    <div id="nvr-player">
      <div class="nvr-header" id="nvr-drag-handle" title="Drag anywhere on this bar to move player">
        <div class="nvr-brand">
          <span class="nvr-grip">⋮⋮</span>
          <span>Natural Voice Reader</span>
          <span class="nvr-badge-live" id="nvr-state-badge">Fluent v1.1</span>
        </div>
        <div class="nvr-win-btns">
          <button class="nvr-icon-btn" id="nvr-btn-min" title="Minimize / Expand">—</button>
          <button class="nvr-icon-btn" id="nvr-btn-close" title="Hide Player (Alt+R to reopen)">✕</button>
        </div>
      </div>

      <div class="nvr-body">
        <div class="nvr-status-box">
          <div class="nvr-status-meta">
            <span id="nvr-pos-indicator">Click any word on the page to start reading</span>
            <span id="nvr-line-indicator">Para 0/0 · Line 0/0</span>
          </div>
          <div class="nvr-status-text" id="nvr-live-preview">
            Continuous sentence prosody & zero-gap lookahead active.
          </div>
        </div>

        <div class="nvr-nav-section">
          <div class="nvr-nav-row">
            <button class="nvr-btn" id="nvr-prev-line" title="Jump to Previous Line">
              <span>◀</span> <span>Prev Line</span>
            </button>
            <button class="nvr-btn nvr-btn-primary" id="nvr-play-pause" title="Play or Pause reading">
              <span id="nvr-play-icon">▶</span> <span id="nvr-play-label">Play</span>
            </button>
            <button class="nvr-btn" id="nvr-next-line" title="Jump to Next Line">
              <span>Next Line</span> <span>▶</span>
            </button>
          </div>

          <div class="nvr-nav-row-secondary">
            <button class="nvr-btn" id="nvr-prev-para" title="Jump to Previous Paragraph">
              <span>⏮</span> <span>Prev Para</span>
            </button>
            <button class="nvr-btn nvr-btn-stop" id="nvr-stop" title="Stop and clear highlight">
              <span>⏹ Stop</span>
            </button>
            <button class="nvr-btn" id="nvr-next-para" title="Jump to Next Paragraph">
              <span>Next Para</span> <span>⏭</span>
            </button>
          </div>
        </div>

        <div class="nvr-speed-row">
          <span class="nvr-speed-label">Speed</span>
          <button class="nvr-speed-step" id="nvr-speed-down" title="Decrease reading speed (-0.1x)">−</button>
          <input type="range" class="nvr-speed-slider" id="nvr-speed-slider" min="0.5" max="3.0" step="0.05" value="1.0" />
          <button class="nvr-speed-step" id="nvr-speed-up" title="Increase reading speed (+0.1x)">+</button>
          <span class="nvr-speed-val" id="nvr-speed-val" title="Click to reset to 1.0x">1.00x</span>
        </div>

        <div class="nvr-voice-grid">
          <div class="nvr-field-row">
            <span class="nvr-field-label">Voice</span>
            <select class="nvr-select" id="nvr-voice-select" title="Choose Natural English Voice Model"></select>
          </div>
          <div class="nvr-field-row">
            <span class="nvr-field-label">Flow</span>
            <select class="nvr-select" id="nvr-flow-select" title="Sentence Continuity & Pacing Mode">
              <option value="fluent">Seamless Continuous (Zero-Gap Lookahead)</option>
              <option value="relaxed">Relaxed Narrative (Gentle Sentence Breath)</option>
              <option value="brisk">Fast Article Skimmer (+10% Cadence)</option>
            </select>
          </div>
        </div>

        <div class="nvr-toggles">
          <button class="nvr-pill-toggle active" id="nvr-toggle-click" title="When ON, clicking any word on the page starts reading fluently from that word">
            👆 Click Word: ON
          </button>
          <button class="nvr-pill-toggle active" id="nvr-toggle-scroll" title="Automatically scroll the page to follow reading">
            📜 Auto-Scroll: ON
          </button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(wrapper);

  // --- UI References ---
  const playerEl = shadow.getElementById("nvr-player");
  const dragHandle = shadow.getElementById("nvr-drag-handle");
  const hlParaEl = shadow.getElementById("nvr-hl-para");
  const hlLineEl = shadow.getElementById("nvr-hl-line");
  const hlWordEl = shadow.getElementById("nvr-hl-word");

  const stateBadge = shadow.getElementById("nvr-state-badge");
  const posIndicator = shadow.getElementById("nvr-pos-indicator");
  const lineIndicator = shadow.getElementById("nvr-line-indicator");
  const livePreview = shadow.getElementById("nvr-live-preview");

  const btnPlayPause = shadow.getElementById("nvr-play-pause");
  const playIcon = shadow.getElementById("nvr-play-icon");
  const playLabel = shadow.getElementById("nvr-play-label");
  const btnStop = shadow.getElementById("nvr-stop");
  const btnPrevLine = shadow.getElementById("nvr-prev-line");
  const btnNextLine = shadow.getElementById("nvr-next-line");
  const btnPrevPara = shadow.getElementById("nvr-prev-para");
  const btnNextPara = shadow.getElementById("nvr-next-para");

  const btnSpeedDown = shadow.getElementById("nvr-speed-down");
  const btnSpeedUp = shadow.getElementById("nvr-speed-up");
  const speedSlider = shadow.getElementById("nvr-speed-slider");
  const speedVal = shadow.getElementById("nvr-speed-val");

  const voiceSelect = shadow.getElementById("nvr-voice-select");
  const flowSelect = shadow.getElementById("nvr-flow-select");
  const btnToggleClick = shadow.getElementById("nvr-toggle-click");
  const btnToggleScroll = shadow.getElementById("nvr-toggle-scroll");
  const btnMin = shadow.getElementById("nvr-btn-min");
  const btnClose = shadow.getElementById("nvr-btn-close");

  // --- Draggable Floating Controller ---
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function applyWidgetPosition() {
    if (state.posX === null || state.posY === null) return;
    const rect = playerEl.getBoundingClientRect();
    const w = rect.width || 360;
    const h = rect.height || 80;
    const clampedX = Math.max(8, Math.min(window.innerWidth - w - 8, state.posX));
    const clampedY = Math.max(8, Math.min(window.innerHeight - h - 8, state.posY));
    playerEl.style.left = `${clampedX}px`;
    playerEl.style.top = `${clampedY}px`;
    playerEl.style.right = "auto";
  }

  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    isDragging = true;
    const rect = playerEl.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    state.posX = e.clientX - dragOffsetX;
    state.posY = e.clientY - dragOffsetY;
    applyWidgetPosition();
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      savePosition();
    }
  });

  window.addEventListener("resize", () => {
    applyWidgetPosition();
    updateHighlightBoxes();
  });

  window.addEventListener("scroll", () => {
    if (state.isPlaying || state.isPaused) {
      updateHighlightBoxes();
    }
  }, { passive: true });

  // --- Natural Voice Discovery & Intelligent Ranking ---
  function scoreVoice(v) {
    let score = 0;
    const name = (v.name || "").toLowerCase();
    const lang = (v.lang || "").toLowerCase();
    if (lang.startsWith("en-us")) score += 50;
    else if (lang.startsWith("en-gb")) score += 46;
    else if (lang.startsWith("en-au") || lang.startsWith("en-ca")) score += 42;
    else if (lang.startsWith("en")) score += 35;
    else return -1;

    // Prioritize Neural / Online Natural / Google Cloud voices
    if (name.includes("natural") || name.includes("neural")) score += 120;
    if (name.includes("ava") || name.includes("andrew") || name.includes("aria") || name.includes("jenny") || name.includes("guy") || name.includes("sonia") || name.includes("ryan")) score += 90;
    if (name.includes("google us english")) score += 105;
    else if (name.includes("google uk english")) score += 100;
    else if (name.includes("google")) score += 85;
    if (name.includes("online")) score += 75;
    if (name.includes("samantha") || name.includes("daniel") || name.includes("karen") || name.includes("moira") || name.includes("rishi")) score += 65;
    if (name.includes("premium") || name.includes("enhanced")) score += 60;
    // Penalize legacy robotic desktop voices so natural ones always default first
    if (name.includes("desktop") || name.includes("espeak")) score -= 30;
    return score;
  }

  function populateVoices() {
    const rawVoices = window.speechSynthesis.getVoices() || [];
    let englishVoices = rawVoices
      .map((v) => ({ voice: v, score: scoreVoice(v) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (englishVoices.length === 0 && rawVoices.length > 0) {
      englishVoices = rawVoices.map((v) => ({ voice: v, score: 10 }));
    }

    state.voices = englishVoices.map((item) => item.voice);
    voiceSelect.innerHTML = "";

    const naturalGroup = document.createElement("optgroup");
    naturalGroup.label = "★ Natural & Neural English Models";
    const standardGroup = document.createElement("optgroup");
    standardGroup.label = "Standard System English Models";

    state.voices.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      const isNatural = /natural|neural|google|online|premium|enhanced|samantha|daniel|ava|andrew|aria|guy|jenny|sonia|ryan/i.test(v.name);
      opt.textContent = `${isNatural ? "★ " : ""}${v.name} (${v.lang})`;
      if (state.voiceURI && v.voiceURI === state.voiceURI) {
        opt.selected = true;
      } else if (!state.voiceURI && idx === 0) {
        opt.selected = true;
        state.voiceURI = v.voiceURI;
      }
      if (isNatural) naturalGroup.appendChild(opt);
      else standardGroup.appendChild(opt);
    });

    if (naturalGroup.children.length > 0) voiceSelect.appendChild(naturalGroup);
    if (standardGroup.children.length > 0) voiceSelect.appendChild(standardGroup);
  }

  populateVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  // --- Prosody Text Cleaner (Removes citation brackets & normalizes punctuation) ---
  function cleanWordForSpeech(rawWord) {
    if (!rawWord) return "";
    let w = rawWord
      .replace(/\u00AD/g, "") // soft hyphen
      .replace(/\[\d+\]/g, "") // Wikipedia [1], [12] citations
      .replace(/\[(?:citation needed|edit|note \d+)\]/gi, "");
    // Replace standalone em-dash or double-hyphen with comma pause
    if (w === "—" || w === "--") return ",";
    w = w.replace(/—/g, ", ");
    return w.trim();
  }

  // --- DOM Paragraph, Visual Line & Fluent Sentence Indexer ---
  const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, pre";

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("#nvr-extension-root, nav, footer, script, style, noscript, aside, [aria-hidden='true'], .mw-editsection, sup.reference")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 20 && rect.height > 8;
  }

  function collectTextNodes(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("sup.reference, .mw-editsection, script, style, noscript, svg")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  /**
   * Builds both:
   * 1. Visual Lines (`lines[]`) -> used for on-page highlight band & Prev/Next Line buttons.
   * 2. Fluent Sentences (`sentences[]`) -> used by the TTS engine so speech NEVER stops at visual line wraps!
   */
  function buildParagraphModel(el, pIndex) {
    const textNodes = collectTextNodes(el);
    const words = [];
    const wordRegex = /\S+/g;

    for (const node of textNodes) {
      const val = node.nodeValue;
      let match;
      while ((match = wordRegex.exec(val)) !== null) {
        const rawStr = match[0];
        const spokenStr = cleanWordForSpeech(rawStr);
        if (!spokenStr) continue;

        const nodeStart = match.index;
        const nodeEnd = match.index + rawStr.length;

        const range = document.createRange();
        range.setStart(node, nodeStart);
        range.setEnd(node, nodeEnd);
        const rect = range.getBoundingClientRect();

        words.push({
          word: rawStr,
          spoken: spokenStr,
          node,
          nodeStart,
          nodeEnd,
          pIndex,
          wordIndexInPara: words.length,
          top: Math.round(rect.top),
          height: Math.round(rect.height)
        });
      }
    }

    if (words.length === 0) return null;

    // 1. Group words into Visual Lines (by vertical screen coordinate `top`)
    const lines = [];
    let currentLineWords = [];
    let currentTop = null;

    for (const w of words) {
      const sameVisualRow = currentTop !== null && Math.abs(w.top - currentTop) <= 9;
      if (currentLineWords.length > 0 && (!sameVisualRow || currentLineWords.length >= 20)) {
        lines.push(finalizeVisualLine(currentLineWords, lines.length));
        currentLineWords = [];
        currentTop = null;
      }
      if (currentTop === null) currentTop = w.top;
      currentLineWords.push(w);
    }
    if (currentLineWords.length > 0) {
      lines.push(finalizeVisualLine(currentLineWords, lines.length));
    }

    // 2. Group words into Natural Sentences / Breath Clauses for Fluent Speech
    // Never break at visual line wraps! Break only at real sentence endings (. ! ?)
    // or, if a sentence exceeds 32 words, at a major clause boundary (; : — ,) so Chrome TTS stays responsive.
    const sentences = [];
    let curSentWords = [];
    const ABBREV_REGEX = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|inc|ltd|co|corp|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|u\.s|e\.g|i\.e)\.$/i;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      curSentWords.push(w);

      const endsWithTerminal = /[.!?]["'”’)\]]*$/.test(w.spoken) && !ABBREV_REGEX.test(w.spoken);
      const endsWithMajorClause = /[;:—]["'”’)\]]*$/.test(w.spoken) || (curSentWords.length >= 26 && /,$/.test(w.spoken));
      const isTooLong = curSentWords.length >= 38;

      if (endsWithTerminal || (curSentWords.length >= 18 && endsWithMajorClause) || isTooLong || i === words.length - 1) {
        sentences.push(curSentWords);
        curSentWords = [];
      }
    }

    return {
      pIndex,
      element: el,
      words,
      lines,
      sentences
    };
  }

  function finalizeVisualLine(lineWords, lineIndex) {
    const mapped = lineWords.map((w, idx) => {
      w.lineIndex = lineIndex;
      w.wordIndexInLine = idx;
      return w;
    });
    return {
      lineIndex,
      text: mapped.map((w) => w.word).join(" "),
      words: mapped
    };
  }

  function indexPageParagraphs(targetElement = null) {
    const candidates = Array.from(document.querySelectorAll(BLOCK_SELECTOR));
    const filtered = candidates.filter((el) => {
      if (!isElementVisible(el)) return false;
      const nested = el.querySelector("p, li, blockquote");
      if (nested && el !== targetElement) return false;
      const txt = (el.innerText || "").trim();
      return txt.length >= 2;
    });

    if (targetElement && !filtered.includes(targetElement) && isElementVisible(targetElement)) {
      filtered.push(targetElement);
    }

    const models = [];
    for (const el of filtered) {
      const m = buildParagraphModel(el, models.length);
      if (m && m.lines.length > 0) {
        models.push(m);
      }
    }
    state.paragraphs = models;
    return models;
  }

  // --- Highlighting & Auto-Scroll Engine ---
  function createRangeForWords(firstWord, lastWord) {
    if (!firstWord || !lastWord) return null;
    try {
      const r = document.createRange();
      r.setStart(firstWord.node, firstWord.nodeStart);
      r.setEnd(lastWord.node, lastWord.nodeEnd);
      return r;
    } catch (e) {
      return null;
    }
  }

  function clearHighlights() {
    hlParaEl.style.display = "none";
    hlLineEl.style.display = "none";
    hlWordEl.style.display = "none";
  }

  function updateHighlightBoxes() {
    const para = state.paragraphs[state.pIndex];
    if (!para || (!state.isPlaying && !state.isPaused)) {
      clearHighlights();
      return;
    }

    const pRect = para.element.getBoundingClientRect();
    if (pRect.width > 0 && pRect.height > 0) {
      hlParaEl.style.display = "block";
      hlParaEl.style.left = `${pRect.left - 6}px`;
      hlParaEl.style.top = `${pRect.top - 3}px`;
      hlParaEl.style.width = `${pRect.width + 12}px`;
      hlParaEl.style.height = `${pRect.height + 6}px`;
    }

    const line = para.lines[state.lIndex];
    if (line && line.words.length > 0) {
      const lineRange = createRangeForWords(line.words[0], line.words[line.words.length - 1]);
      if (lineRange) {
        const lRect = lineRange.getBoundingClientRect();
        if (lRect.width > 0 && lRect.height > 0) {
          hlLineEl.style.display = "block";
          hlLineEl.style.left = `${lRect.left - 2}px`;
          hlLineEl.style.top = `${lRect.top - 1}px`;
          hlLineEl.style.width = `${lRect.width + 4}px`;
          hlLineEl.style.height = `${lRect.height + 2}px`;
        }
      }

      const activeWord = line.words[Math.min(state.wIndex, line.words.length - 1)];
      if (activeWord) {
        const wordRange = createRangeForWords(activeWord, activeWord);
        if (wordRange) {
          const wRect = wordRange.getBoundingClientRect();
          if (wRect.width > 0 && wRect.height > 0) {
            hlWordEl.style.display = "block";
            hlWordEl.style.left = `${wRect.left - 2}px`;
            hlWordEl.style.top = `${wRect.top - 1}px`;
            hlWordEl.style.width = `${wRect.width + 4}px`;
            hlWordEl.style.height = `${wRect.height + 2}px`;
          }
        }
      }
    }
  }

  function autoScrollToActiveLine() {
    if (!state.autoScroll) return;
    const para = state.paragraphs[state.pIndex];
    if (!para) return;
    const line = para.lines[state.lIndex];
    if (!line || line.words.length === 0) return;

    const lineRange = createRangeForWords(line.words[0], line.words[line.words.length - 1]);
    if (!lineRange) return;
    const rect = lineRange.getBoundingClientRect();

    const topMargin = window.innerHeight * 0.20;
    const bottomMargin = window.innerHeight * 0.76;
    if (rect.top < topMargin || rect.bottom > bottomMargin) {
      const targetScrollY = window.scrollY + rect.top - window.innerHeight * 0.36;
      window.scrollTo({
        top: Math.max(0, targetScrollY),
        behavior: "smooth"
      });
    }
  }

  // --- Fluent Lookahead Speech Pipeline ---
  function clearTimers() {
    if (state.wordTimer) {
      clearInterval(state.wordTimer);
      state.wordTimer = null;
    }
    if (state.keepAliveTimer) {
      clearInterval(state.keepAliveTimer);
      state.keepAliveTimer = null;
    }
  }

  /**
   * Builds the sequence of sentence chunks starting from the exact word `(startP, startWordInPara)`
   * through the rest of the page.
   * The very first chunk starts at the exact clicked/target word and runs to the end of its sentence;
   * all following chunks are complete sentences!
   */
  function buildSentenceQueueFrom(startP, startWordInPara) {
    const queue = [];
    for (let p = startP; p < state.paragraphs.length; p++) {
      const para = state.paragraphs[p];
      for (const sentWords of para.sentences) {
        if (p === startP) {
          const lastW = sentWords[sentWords.length - 1];
          if (lastW.wordIndexInPara < startWordInPara) continue;
          const filtered = sentWords.filter((w) => w.wordIndexInPara >= startWordInPara);
          if (filtered.length > 0) {
            queue.push(createSentenceChunk(p, filtered));
          }
        } else {
          queue.push(createSentenceChunk(p, sentWords));
        }
      }
    }
    return queue;
  }

  function createSentenceChunk(pIndex, wordList) {
    let text = "";
    const offsets = [];
    // Weight each word's natural spoken duration by syllable/character count + punctuation pause
    let totalWeight = 0;

    wordList.forEach((w, idx) => {
      const start = text.length;
      text += (idx > 0 ? " " : "") + w.spoken;
      const end = text.length;

      let weight = Math.max(2.2, w.spoken.length);
      if (/[,;:—]$/.test(w.spoken)) weight += 3.5; // Natural comma/clause breath
      else if (/[.!?]$/.test(w.spoken)) weight += 4.5;

      const weightStart = totalWeight;
      totalWeight += weight;

      offsets.push({
        start,
        end,
        weightStart,
        weightEnd: totalWeight,
        wordObj: w
      });
    });

    return {
      pIndex,
      text,
      words: wordList,
      offsets,
      totalWeight
    };
  }

  /**
   * Starts fluent pipelined playback from `(pIndex, lIndex, wIndex)`.
   */
  function startFluentPlayback(pIndex, lIndex, wIndexInLine = 0) {
    clearTimers();
    window.speechSynthesis.cancel();

    if (state.paragraphs.length === 0) {
      indexPageParagraphs();
    }
    if (state.paragraphs.length === 0) {
      livePreview.textContent = "No readable English text found on this page.";
      return;
    }

    state.pIndex = Math.max(0, Math.min(state.paragraphs.length - 1, pIndex));
    const para = state.paragraphs[state.pIndex];
    state.lIndex = Math.max(0, Math.min(para.lines.length - 1, lIndex));
    const line = para.lines[state.lIndex];
    state.wIndex = Math.max(0, Math.min(line.words.length - 1, wIndexInLine));

    const startWordObj = line.words[state.wIndex] || para.words[0];
    state.utteranceQueue = buildSentenceQueueFrom(state.pIndex, startWordObj.wordIndexInPara);

    if (state.utteranceQueue.length === 0) {
      stopReading("Finished reading page");
      return;
    }

    state.isPlaying = true;
    state.isPaused = false;
    state.queueCursor = 0;
    state.enqueuedUpTo = -1;
    const currentSession = ++state.sessionId;

    // Chrome remote TTS keep-alive (prevents Chrome from pausing long network synthesis streams)
    state.keepAliveTimer = setInterval(() => {
      if (state.isPlaying && !state.isPaused && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);

    fillLookaheadPipeline(currentSession);
    syncUIFromState();
  }

  /**
   * Enqueues up to LOOKAHEAD_SIZE sentence utterances into window.speechSynthesis
   * so Chrome pre-synthesizes sentence N+1 while sentence N is playing (zero-gap transition).
   */
  function fillLookaheadPipeline(sessionId) {
    if (sessionId !== state.sessionId || !state.isPlaying || state.isPaused) return;

    const maxTarget = state.flowMode === "relaxed"
      ? state.queueCursor // 1 at a time for a gentle pause between sentences
      : Math.min(state.utteranceQueue.length - 1, state.queueCursor + LOOKAHEAD_SIZE - 1);

    while (state.enqueuedUpTo < maxTarget) {
      const nextIdx = state.enqueuedUpTo + 1;
      const chunk = state.utteranceQueue[nextIdx];
      if (!chunk) break;
      state.enqueuedUpTo = nextIdx;
      enqueueChunkUtterance(chunk, nextIdx, sessionId);
    }
  }

  function enqueueChunkUtterance(chunk, chunkIdx, sessionId) {
    const utterance = new SpeechSynthesisUtterance(chunk.text);

    const chosenVoice = state.voices.find((v) => v.voiceURI === state.voiceURI) || state.voices[0];
    if (chosenVoice) {
      utterance.voice = chosenVoice;
      utterance.lang = chosenVoice.lang || "en-US";
    } else {
      utterance.lang = "en-US";
    }

    const rateBoost = state.flowMode === "brisk" ? 1.10 : 1.0;
    const effectiveRate = Math.max(0.5, Math.min(3.0, +(state.rate * rateBoost).toFixed(2)));
    utterance.rate = effectiveRate;
    utterance.pitch = 1.0; // Pure 1.0 pitch preserves natural neural prosody

    let boundaryFired = false;

    utterance.onstart = () => {
      if (sessionId !== state.sessionId) return;
      state.queueCursor = chunkIdx;

      // Top up lookahead queue so the next sentence is always pre-synthesized in Chrome
      fillLookaheadPipeline(sessionId);

      // Highlight the first word of this sentence immediately
      const firstWord = chunk.words[0];
      if (firstWord) {
        applyActiveWord(firstWord);
      }

      // Start smooth prosody-weighted word timer fallback (for Google network voices that omit onboundary)
      if (state.wordTimer) clearInterval(state.wordTimer);
      const estTotalMs = (chunk.text.length * (60 / effectiveRate)) + 120;
      const startTime = performance.now();

      state.wordTimer = setInterval(() => {
        if (sessionId !== state.sessionId || state.queueCursor !== chunkIdx || !state.isPlaying || state.isPaused) return;
        if (boundaryFired) return;
        const elapsed = performance.now() - startTime;
        const progress = Math.min(0.99, elapsed / estTotalMs);
        const targetWeight = progress * chunk.totalWeight;
        const matched = chunk.offsets.find((o) => targetWeight >= o.weightStart && targetWeight <= o.weightEnd);
        if (matched) {
          applyActiveWord(matched.wordObj);
        }
      }, 45);
    };

    utterance.onboundary = (event) => {
      if (sessionId !== state.sessionId || state.queueCursor !== chunkIdx) return;
      if (event.name === "word" || typeof event.charIndex === "number") {
        boundaryFired = true;
        const ci = event.charIndex || 0;
        const matched = chunk.offsets.find((o) => ci >= o.start && ci <= o.end + 1);
        if (matched) {
          applyActiveWord(matched.wordObj);
        }
      }
    };

    utterance.onend = () => {
      if (sessionId !== state.sessionId) return;
      if (chunkIdx + 1 >= state.utteranceQueue.length) {
        stopReading("Finished reading page");
      } else if (state.flowMode === "relaxed") {
        state.queueCursor = chunkIdx + 1;
        fillLookaheadPipeline(sessionId);
      }
    };

    utterance.onerror = (e) => {
      if (sessionId !== state.sessionId) return;
      if (e.error !== "interrupted" && e.error !== "canceled") {
        if (chunkIdx + 1 < state.utteranceQueue.length && state.enqueuedUpTo < chunkIdx + 1) {
          state.queueCursor = chunkIdx + 1;
          fillLookaheadPipeline(sessionId);
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  function applyActiveWord(wordObj) {
    if (!wordObj) return;
    const prevP = state.pIndex;
    const prevL = state.lIndex;

    state.pIndex = wordObj.pIndex;
    state.lIndex = wordObj.lineIndex;
    state.wIndex = wordObj.wordIndexInLine;

    if (state.pIndex !== prevP || state.lIndex !== prevL) {
      autoScrollToActiveLine();
    }
    updateHighlightBoxes();
    updateLiveStatusUI();
  }

  // --- Transport Controls (Line & Paragraph Forward/Backward) ---
  function skipLine(delta) {
    if (state.paragraphs.length === 0) indexPageParagraphs();
    if (state.paragraphs.length === 0) return;

    const para = state.paragraphs[state.pIndex];
    if (!para) return;

    let newP = state.pIndex;
    let newL = state.lIndex + delta;

    if (newL < 0) {
      if (newP > 0) {
        newP -= 1;
        const prevPara = state.paragraphs[newP];
        newL = Math.max(0, prevPara.lines.length - 1);
      } else {
        newL = 0;
      }
    } else if (newL >= para.lines.length) {
      if (newP + 1 < state.paragraphs.length) {
        newP += 1;
        newL = 0;
      } else {
        newL = para.lines.length - 1;
      }
    }

    startFluentPlayback(newP, newL, 0);
  }

  function skipParagraph(delta) {
    if (state.paragraphs.length === 0) indexPageParagraphs();
    if (state.paragraphs.length === 0) return;

    const newP = Math.max(0, Math.min(state.paragraphs.length - 1, state.pIndex + delta));
    startFluentPlayback(newP, 0, 0);
  }

  function togglePlayPause() {
    if (!state.isPlaying && !state.isPaused) {
      startFluentPlayback(state.pIndex, state.lIndex, state.wIndex || 0);
    } else if (state.isPlaying && !state.isPaused) {
      state.isPaused = true;
      state.isPlaying = false;
      state.sessionId++;
      clearTimers();
      window.speechSynthesis.cancel();
      syncUIFromState();
    } else if (state.isPaused) {
      startFluentPlayback(state.pIndex, state.lIndex, state.wIndex || 0);
    }
  }

  function stopReading(statusText = "Stopped") {
    state.sessionId++;
    clearTimers();
    window.speechSynthesis.cancel();
    state.isPlaying = false;
    state.isPaused = false;
    clearHighlights();
    posIndicator.textContent = statusText;
    syncUIFromState();
  }

  function adjustSpeed(newRate) {
    state.rate = Math.max(0.5, Math.min(3.0, +newRate.toFixed(2)));
    saveSettings();
    syncUIFromState();
    if (state.isPlaying) {
      startFluentPlayback(state.pIndex, state.lIndex, state.wIndex);
    }
  }

  // --- Click Any Word on the Webpage to Start Reading ---
  function getCaretPoint(clientX, clientY) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(clientX, clientY);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(clientX, clientY);
      if (p) return { node: p.offsetNode, offset: p.offset };
    }
    return null;
  }

  document.addEventListener("click", (e) => {
    if (!state.clickToRead || !state.widgetVisible) return;
    if (e.defaultPrevented) return;
    if (e.composedPath().includes(host)) return;
    if (!e.altKey && e.target.closest("a, button, input, textarea, select, label, [role='button'], [contenteditable='true']")) {
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 25) return;

    const caret = getCaretPoint(e.clientX, e.clientY);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return;

    const blockEl = caret.node.parentElement ? caret.node.parentElement.closest(BLOCK_SELECTOR) || caret.node.parentElement : null;
    if (!blockEl || !isElementVisible(blockEl)) return;

    const testRange = document.createRange();
    testRange.selectNodeContents(caret.node);
    const rect = testRange.getBoundingClientRect();
    if (
      e.clientX < rect.left - 16 ||
      e.clientX > rect.right + 16 ||
      e.clientY < rect.top - 16 ||
      e.clientY > rect.bottom + 16
    ) {
      return;
    }

    const models = indexPageParagraphs(blockEl);
    const pIdx = models.findIndex((m) => m.element === blockEl || m.element.contains(caret.node));
    if (pIdx === -1) return;

    const paraModel = models[pIdx];
    let targetLineIdx = 0;
    let targetWordIdx = 0;

    for (const line of paraModel.lines) {
      for (const w of line.words) {
        if (w.node === caret.node && caret.offset >= w.nodeStart && caret.offset <= w.nodeEnd + 1) {
          targetLineIdx = line.lineIndex;
          targetWordIdx = w.wordIndexInLine;
          break;
        }
      }
    }

    startFluentPlayback(pIdx, targetLineIdx, targetWordIdx);
  }, true);

  // --- UI Synchronization & Event Bindings ---
  function updateLiveStatusUI() {
    const totalP = state.paragraphs.length;
    const para = state.paragraphs[state.pIndex];
    if (!para) return;
    const totalL = para.lines.length;
    const line = para.lines[state.lIndex];

    lineIndicator.textContent = `Para ${state.pIndex + 1}/${totalP} · Line ${state.lIndex + 1}/${totalL}`;
    if (line) {
      const currentWordObj = line.words[state.wIndex];
      posIndicator.textContent = currentWordObj ? `Reading: "${currentWordObj.word}"` : "Reading...";
      livePreview.textContent = line.text;
    }
  }

  function syncUIFromState() {
    playerEl.classList.toggle("hidden", !state.widgetVisible);
    playerEl.classList.toggle("minimized", state.minimized);

    if (state.isPlaying) {
      stateBadge.textContent = "Speaking Fluently";
      playIcon.textContent = "⏸";
      playLabel.textContent = "Pause";
    } else if (state.isPaused) {
      stateBadge.textContent = "Paused";
      playIcon.textContent = "▶";
      playLabel.textContent = "Resume";
    } else {
      stateBadge.textContent = "Fluent v1.1";
      playIcon.textContent = "▶";
      playLabel.textContent = "Play";
    }

    speedSlider.value = state.rate;
    speedVal.textContent = `${state.rate.toFixed(2)}x`;
    flowSelect.value = state.flowMode || "fluent";

    btnToggleClick.classList.toggle("active", state.clickToRead);
    btnToggleClick.textContent = `👆 Click Word: ${state.clickToRead ? "ON" : "OFF"}`;

    btnToggleScroll.classList.toggle("active", state.autoScroll);
    btnToggleScroll.textContent = `📜 Auto-Scroll: ${state.autoScroll ? "ON" : "OFF"}`;
  }

  btnPlayPause.addEventListener("click", togglePlayPause);
  btnStop.addEventListener("click", () => stopReading("Stopped"));
  btnPrevLine.addEventListener("click", () => skipLine(-1));
  btnNextLine.addEventListener("click", () => skipLine(1));
  btnPrevPara.addEventListener("click", () => skipParagraph(-1));
  btnNextPara.addEventListener("click", () => skipParagraph(1));

  btnSpeedDown.addEventListener("click", () => adjustSpeed(state.rate - 0.1));
  btnSpeedUp.addEventListener("click", () => adjustSpeed(state.rate + 0.1));
  speedSlider.addEventListener("input", (e) => adjustSpeed(parseFloat(e.target.value)));
  speedVal.addEventListener("click", () => adjustSpeed(1.0));

  voiceSelect.addEventListener("change", (e) => {
    state.voiceURI = e.target.value;
    saveSettings();
    if (state.isPlaying) startFluentPlayback(state.pIndex, state.lIndex, state.wIndex);
  });

  flowSelect.addEventListener("change", (e) => {
    state.flowMode = e.target.value;
    saveSettings();
    if (state.isPlaying) startFluentPlayback(state.pIndex, state.lIndex, state.wIndex);
  });

  btnToggleClick.addEventListener("click", () => {
    state.clickToRead = !state.clickToRead;
    saveSettings();
    syncUIFromState();
  });

  btnToggleScroll.addEventListener("click", () => {
    state.autoScroll = !state.autoScroll;
    saveSettings();
    syncUIFromState();
  });

  btnMin.addEventListener("click", () => {
    state.minimized = !state.minimized;
    btnMin.textContent = state.minimized ? "□" : "—";
    syncUIFromState();
  });

  btnClose.addEventListener("click", () => {
    state.widgetVisible = false;
    stopReading("Stopped");
    saveSettings();
    syncUIFromState();
  });

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === "TOGGLE_WIDGET") {
        state.widgetVisible = !state.widgetVisible;
        saveSettings();
        syncUIFromState();
        sendResponse({ ok: true, widgetVisible: state.widgetVisible });
      } else if (msg.action === "SHOW_AND_PLAY") {
        state.widgetVisible = true;
        syncUIFromState();
        togglePlayPause();
        sendResponse({ ok: true });
      } else if (msg.action === "GET_STATE") {
        sendResponse({
          ok: true,
          widgetVisible: state.widgetVisible,
          isPlaying: state.isPlaying,
          rate: state.rate,
          clickToRead: state.clickToRead,
          autoScroll: state.autoScroll
        });
      }
      return true;
    });
  }

  loadSettings();
})();
