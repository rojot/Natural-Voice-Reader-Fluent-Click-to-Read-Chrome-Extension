# Natural Voice Reader v1.1.0 — Fluent Sentence-Pipelined Chrome Extension

A free, natural-sounding English Text-to-Speech Chrome Extension with **zero-gap sentence lookahead pipelining**, a draggable floating player, click-any-word reading, live word/line/paragraph highlighting, auto-scrolling, dual navigation buttons (Lines & Paragraphs), and reading speed controls.

## What's New in v1.1.0 (Fluency Upgrade)

1. **Sentence-Level Continuous Prosody (No Mid-Sentence Line Chopping)**:
   - Previously, speaking one visual screen line at a time caused the voice to pause and drop intonation at the right margin of every line.
   - Now, the speech engine groups words into **complete sentences/clauses** while still mapping every spoken word back to its **visual line** on the page. The voice flows across line wraps naturally without stopping, while the yellow line highlight and `Prev/Next Line` buttons continue to track visual lines seamlessly.
2. **Lookahead Utterance Pipelining (Zero-Gap Transitions)**:
   - Pre-queues upcoming sentences into Chrome's speech synthesis buffer while the current sentence is still playing, so network-backed voices (`Google US English`, `Google UK English`) pre-fetch audio in the background with **zero pause** between sentences.
3. **Smart Text Cleaning**:
   - Automatically skips inline footnote brackets (like `[1]`, `[12]` on Wikipedia) and soft hyphens so the voice never stumbles over reference numbers.
4. **Pure Native Neural Pitch (`1.0`)**:
   - Keeps vocal pitch at native `1.0` so neural voices sound clear and natural without resampling artifacts.

## Updating the Extension in Chrome

1. Unzip the new `natural_voice_reader_extension.zip` over your existing folder (or into a new folder).
2. Open `chrome://extensions/` and click the **Reload (⟳)** icon on the **Natural Voice Reader** card (or click **Load unpacked** and select the updated folder).
3. Refresh your webpage tab and click any word to hear the smooth, continuous reading flow.
