# Article Narrator Extension - Architecture

## Overview

A Chrome extension that extracts article text from Twitter/X articles and provides text-to-speech narration with streaming audio playback. The UI is injected directly into the page's sidebar.

## File Structure

```
pocket-tts-extension/
├── manifest.json           # Extension manifest
├── background.js           # Service worker for HTTP proxy
├── content.js              # Lightweight message handler
├── narrator-ui.js          # Main UI logic and injection
├── narrator-ui.html        # Reusable HTML template
├── streaming-player.js     # Streaming WAV audio player
└── ARCHITECTURE.md         # This file
```

## Component Overview

### 1. manifest.json
- **Role**: Extension configuration
- **Key points**:
  - No popup (UI is injected into page)
  - Content scripts load in order: `streaming-player.js` → `content.js` → `narrator-ui.js`
  - `narrator-ui.html` is web-accessible for template loading
  - Permissions: `activeTab`, `scripting`, `webRequest`
  - Host permissions for localhost TTS server

### 2. background.js
- **Role**: HTTP proxy for mixed-content requests
- **Why needed**: Content scripts on HTTPS pages (twitter.com) cannot make HTTP requests (localhost:8000) due to mixed content blocking
- **How it works**:
  1. Receives `fetchTTS` message from content script with text
  2. Forwards request to `http://localhost:8000/tts` via POST
  3. Streams response back as `ttsChunk` messages
  4. Sends `done: true` when stream ends

### 3. content.js
- **Role**: Lightweight bridge for cross-script communication
- **Responsibilities**:
  - Caches extracted data (persists while tab is open)
  - Handles `getCache`, `clearCache`, `getSpanText`, `jumpToSpan`, `count` messages
  - Provides `groupSpansByParent()` for text extraction logic
- **Does NOT handle**: UI rendering, audio playback, user interactions

### 4. narrator-ui.js
- **Role**: Main UI logic and page injection
- **Responsibilities**:
  - Detects Twitter/X article pages via `span[data-text="true"]`
  - Loads HTML template from `narrator-ui.html`
  - Clones sidebar and injects narrator UI
  - Sets up all event listeners (Extract, Play, Pause, Stop, navigation)
  - Manages playback state and sequential span playback
  - Coordinates with `StreamingWavPlayer` for audio
- **State managed**:
  - `extractedText`, `currentSpanIndex`, `totalSpanCount`
  - `isPlaying`, `currentPlayer`, `sequentialSpans`

### 5. narrator-ui.html
- **Role**: Reusable HTML template
- **Contents**:
  - Scoped `<style>` block with all UI CSS
  - Button groups for Extract, Play, Pause, Stop
  - Pagination controls (Prev/Next with counter)
  - Info panels (span info, audio size, estimate)
  - All UI elements with IDs for JS access
- **Design**: Uses `<template>` tag, loaded via `chrome.runtime.getURL()`

### 6. streaming-player.js
- **Role**: Streaming WAV audio playback
- **Class**: `StreamingWavPlayer`
- **Key features**:
  - Parses WAV header (44 bytes) for sample rate and channels
  - Buffers PCM data as chunks arrive
  - Plays audio via Web Audio API (AudioContext)
  - Schedules buffers seamlessly for gapless playback
  - Supports pause/resume via AudioContext suspend/resume
- **Methods**:
  - `addChunk(chunk)` - Add raw WAV data
  - `complete()` - Signal end of stream
  - `stop()` - Close AudioContext
  - `pause()` / `resume()` - Suspend/resume playback

## Data Flow

### Text Extraction Flow
```
User clicks "Extract Text"
  → narrator-ui.js: groupSpansByParent()
  → Finds all span[data-text="true"]
  → Groups by container (paragraphs)
  → Updates UI with counts
```

### Audio Playback Flow (Single Span)
```
User clicks "Play Current"
  → narrator-ui.js: playSingleSpan()
  → Sends "fetchTTS" message to background.js
  → background.js: POST to localhost:8000/tts
  → Streams back as "ttsChunk" messages
  → StreamingWavPlayer.addChunk()
  → AudioContext plays buffers
  → onComplete callback updates UI
```

### Audio Playback Flow (Sequential/Play All)
```
User clicks "Play All"
  → narrator-ui.js: playSpansSequentially()
  → Loops through spans with await playSingleSpan()
  → Checks isPlaying flag each iteration
  → Allows pause/stop to break loop
  → Updates UI on completion
```

## External Dependencies

### Local TTS Server
- **URL**: `http://localhost:8000/tts`
- **Method**: POST
- **Body**: FormData with `text` field
- **Response**: Streaming WAV file
- **Required**: User must run local TTS server separately

## Message Protocol

### From narrator-ui.js to background.js
```javascript
{ type: "fetchTTS", text: "string" }
```

### From background.js to narrator-ui.js
```javascript
{ type: 'ttsChunk', done: boolean, value: Array<number> }
```

### Cross-script (content.js messages)
```javascript
{ type: "getCache" }           → { cached: data | null }
{ type: "clearCache" }         → { ok: true }
{ type: "getSpanText", index: n } → { ok: bool, text: string, ... }
{ type: "jumpToSpan", index: n }  → { ok: bool, index: n }
{ type: "count" }              → { count: n, text: string, ... }
```

## Key Design Decisions

### Why inject UI instead of using a popup?
1. **Better UX**: Sidebar UI stays visible while scrolling through article
2. **Context**: UI is right next to the content being narrated
3. **No popups**: Doesn't block the page or require closing to continue reading

### Why stream audio instead of waiting for full file?
1. **Faster time-to-audio**: Playback starts as soon as first chunk arrives
2. **Better feedback**: User hears something immediately vs waiting for generation
3. **Memory efficient**: Doesn't need to hold full audio file in memory

### Why use a background proxy for TTS?
1. **Mixed content**: HTTPS page cannot fetch from HTTP localhost
2. **Extension isolation**: Background scripts can make any HTTP request
3. **Streaming support**: Allows chunking response back to content script

### Why separate template from JS?
1. **DRY principle**: Template can be reused if needed
2. **Maintainability**: HTML changes don't require touching JS
3. **Security**: Template is static, loaded via chrome.runtime.getURL()
