# Natural Voice Reader — Fluent Click-to-Read Chrome Extension






**Natural Voice Reader** is a lightweight, zero-cost Chrome Extension (Manifest V3) for reading English articles and webpages aloud with natural prosody. It provides a freely draggable floating player, click-any-word instant playback, synchronized 3-level highlighting (paragraph, visual line, and word), automatic page scrolling, dedicated line and paragraph skip buttons, and real-time speed controls.

## Key Features

* **100% Free Natural & Neural English Voices**: Uses the browser's built-in Web Speech synthesis engine with zero API keys or subscriptions. Automatically detects and prioritizes natural/neural English voice models (`Google US English`, `Google UK English Female/Male`, `Microsoft Online Natural`, `Samantha`, `Daniel`) at the top of the voice selector.
* **Fluent Sentence-Pipelined Prosody (v1.1)**: Separates visual line tracking from speech synthesis. Instead of stopping mid-sentence at the right margin of wrapped lines, the engine feeds complete sentences into a 3-sentence lookahead pipeline so Chrome pre-synthesizes upcoming audio in the background with zero gap between sentences.
* **Freely Draggable Floating Controller**: Renders inside an isolated **Shadow DOM** root (`#nvr-extension-root`) so host webpage CSS never affects the player. Drag the top header bar anywhere on the screen—your preferred coordinates are automatically saved across tabs and sessions.
* **Click-Any-Word Playback**: Click any English word on a webpage to begin reading continuously from that exact word through the rest of the page. Standard links, buttons, and inputs continue to work normally (hold `Alt` + click to read link text).
* **Non-Destructive 3-Level Live Highlighting & Auto-Scroll**: Highlights the active paragraph (subtle blue accent bar), active visual line (warm yellow band), and active spoken word (crisp orange box) using viewport-mapped DOM `Range` overlays without mutating the webpage's HTML or breaking React/SPA event listeners. Automatically scrolls the page to keep the active line comfortably centered.
* **Dual Forward & Backward Navigation**: Includes two independent pairs of skip buttons—one for jumping **line by line** (`◀ Prev Line` / `Next Line ▶`) and one for jumping **paragraph by paragraph** (`⏮ Prev Para` / `Next Para ⏭`).
* **Live Speed & Flow Controls**: Adjust reading speed from `0.50x` to `3.00x` on the fly using the `−` and `+` buttons (`0.10x` increments), the continuous slider, or a single click on the speed readout badge to reset to `1.00x`. Includes selectable flow modes (*Seamless Continuous*, *Relaxed Narrative*, and *Fast Article Skimmer*).
* **Smart Text Normalization**: Automatically strips inline reference brackets (such as `[1]`, `[12]`, or `[citation needed]` on Wikipedia) and soft hyphens before speaking so the voice never stumbles over footnote markers.

## Controls & Shortcuts Overview

| Control / Shortcut | Action | Description |
| :--- | :--- | :--- |
| **Click Any Word** | Start Reading Here | Detects the exact word under your mouse cursor and reads continuously down the page |
| **`▶ Play` / `⏸ Pause`** | Toggle Playback | Starts, pauses, or resumes reading from the current word |
| **`⏹ Stop`** | Stop & Clear | Cancels speech synthesis and clears all on-page highlight overlays |
| **`◀ Prev Line` / `Next Line ▶`** | Line Skip | Jumps backward or forward by one visual line on the webpage |
| **`⏮ Prev Para` / `Next Para ⏭`** | Paragraph Skip | Jumps backward or forward to the start of the previous or next paragraph |
| **`−` / `+` / Slider** | Reading Speed | Decreases or increases reading speed between `0.50x` and `3.00x` (`0.10x` steps) |
| **Click Speed Badge (`1.00x`)** | Reset Speed | Instantly resets reading speed to `1.00x` |
| **Drag Header Bar (`⋮⋮`)** | Move Player | Repositions the floating player anywhere in the browser viewport |
| **`👆 Click Word: ON/OFF`** | Toggle Click-to-Read | Enables or disables starting playback by clicking words on the page |
| **`📜 Auto-Scroll: ON/OFF`** | Toggle Auto-Scroll | Enables or disables smooth viewport scrolling as reading progresses |
| **`Alt + R`** | Toggle Player | Keyboard shortcut to show or hide the floating player on any tab |
| **`Alt + Click`** | Force Read Link | Starts reading from a word inside an `<a>` hyperlink without navigating |

## Repository Structure

```text
natural-voice-reader/
├── manifest.json       # Chrome Extension Manifest V3 configuration & permissions
├── background.js       # Service worker for shortcuts, context menu & dynamic script injection
├── content.js          # Core TTS pipeline, DOM indexer, Shadow DOM floating UI & highlighter
├── popup.html          # Toolbar action popup interface
├── popup.js            # Toolbar popup controller script
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # Project documentation
```

## Installation Guide

### Load as an Unpacked Extension (Developer Mode)

1. Clone or download this repository to your computer (if downloaded as a `.zip`, extract it to a folder):
   ```bash
   git clone https://github.com/your-username/natural-voice-reader.git
   ```
2. Open Google Chrome (or any Chromium browser such as Microsoft Edge or Brave) and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner and select the `natural-voice-reader` directory (the folder containing `manifest.json`).
5. Pin **Natural Voice Reader** to your Chrome toolbar for quick access.

## How to Use

1. **Open Any English Webpage**: Navigate to any news article, blog post, documentation page, or Wikipedia entry.
2. **Position the Floating Player**: Drag the `⋮⋮ Natural Voice Reader` header bar to place the controller anywhere on your screen. Click `—` to collapse it into a compact mini-bar when needed.
3. **Click Any Word to Read**: With `👆 Click Word: ON` active, click directly on any word on the page. The reader will highlight the paragraph, line, and word and read fluently down the page while auto-scrolling.
4. **Navigate by Line or Paragraph**: Use `◀ Prev Line` / `Next Line ▶` to re-read or skip a single line, or `⏮ Prev Para` / `Next Para ⏭` to jump across paragraphs.
5. **Switch Voice Models & Speed**: Choose from the **Voice** dropdown (voices marked with `★` are natural/neural models) and adjust the **Speed** (`0.50x`–`3.00x`) or **Flow** mode at any time—changes apply immediately from the active word.

## Technical Architecture

1. **Dual-Layer DOM Indexing (Visual Lines vs. Spoken Sentences)**:
   * When indexing a readable block (`p, li, h1–h6, blockquote, dd, dt, figcaption, pre`), the extension maps every word's exact DOM `Text` node and character offsets via `document.createRange()`.
   * Words are grouped into **visual lines** by measuring vertical screen coordinates (`getBoundingClientRect().top`) so the yellow line highlight and `Prev/Next Line` buttons match the exact layout on screen.
   * Simultaneously, words are grouped into **complete sentences and natural breath clauses** (respecting common English abbreviations such as `Mr.`, `Dr.`, `U.S.`, `e.g.`) for the TTS engine so vocal intonation never drops mid-sentence at a visual line wrap.
2. **Lookahead Utterance Pipelining**:
   * Cloud-backed voices in Chrome (such as `Google US English` and `Google UK English`) synthesize audio over the network when `speechSynthesis.speak()` is called. Waiting for `onend` before queuing the next sentence causes an audible 300–500ms gap.
   * Natural Voice Reader maintains a rolling lookahead buffer of 3 sentences in `window.speechSynthesis`, allowing Chrome to pre-buffer upcoming sentences while the current sentence is playing.
3. **Hybrid Word-Boundary Tracking**:
   * Local OS voices emit hardware `onboundary` events for each word, while remote network voices often omit them. The engine automatically locks onto hardware `onboundary` events when present and falls back to a syllable- and punctuation-weighted word timer when using network voices.

## Troubleshooting

* **Player does not appear on a tab opened before installation**: Click the extension icon in your Chrome toolbar and click **Show / Hide Floating Player**, or refresh the webpage once.
* **Fewer voices appear in the dropdown**: Chrome loads cloud voices (`Google US English`, `Google UK English Female`, `Google UK English Male`) asynchronously when connected to the internet. Wait a moment or re-open the dropdown; on Windows/macOS, you can also install additional English voices in your operating system's Accessibility / Speech settings.
* **Clicking a word does not start playback**: Ensure `👆 Click Word: ON` is enabled in the bottom-left corner of the floating player, and make sure you are single-clicking plain text rather than dragging to select a long passage.

## License

This project is licensed under the **MIT License**. Feel free to fork, modify, and distribute it.
