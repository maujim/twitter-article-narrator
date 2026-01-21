# Article Narrator Extension - Architecture

## Overview

A Chrome extension that extracts article text from Twitter/X articles and provides text-to-speech narration with streaming audio playback. The UI is injected directly into the page's sidebar using Twitter's native button styles for seamless integration.

## File Structure

```
pocket-tts-extension/
├── manifest.json           # Extension manifest
├── background.js           # Service worker for HTTP proxy
├── content.js              # Main UI logic and injection
├── narrator-ui.html        # Reusable HTML template
├── streaming-player.js     # Streaming WAV audio player
└── ARCHITECTURE.md         # This file
```

## Component Overview

### 1. manifest.json
- **Role**: Extension configuration
- **Key points**:
  - No popup (UI is injected into page)
  - Content scripts load in order: `streaming-player.js` → `content.js`
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
- **Role**: Main UI logic and page injection
- **Responsibilities**:
  - Detects Twitter/X article pages via `span[data-text="true"]`
  - Loads HTML template from `narrator-ui.html`
  - Clones Twitter's Follow button for consistent native styling
  - Clones sidebar and injects narrator UI with "Article Narrator" header
  - Auto-extracts text on page load
  - Sets up all event listeners (Play All, Pause, Stop, Copy, Open Tab, Settings toggle)
  - Manages playback state and sequential span playback
  - Auto-scrolls to and highlights spans during playback
  - Coordinates with `StreamingWavPlayer` for audio
- **State managed**:
  - `extractedText`, `currentSpanIndex`, `totalSpanCount`
  - `isPlaying`, `currentPlayer`, `sequentialSpans`
  - API URL and voice settings (localStorage)

### 4. narrator-ui.html
- **Role**: Reusable HTML template
- **Contents**:
  - Playback controls container (Play All, Pause, Stop)
  - Copy/Open buttons container (Copy Text, Open in Tab)
  - Open Settings button (toggles settings section)
  - Settings section (API URL input, Voice select, Save button) - hidden by default
  - Status output div (log entries)
- **Design**: Uses `<template>` tag, loaded via `chrome.runtime.getURL()`
- **UI elements are cloned from Twitter's native Follow button for consistent styling**

### 5. streaming-player.js
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

## UI Layout (Top to Bottom)

1. **Playback Controls** (centered)
   - Play All button
   - Pause/Resume button
   - Stop button

2. **Copy/Open Buttons**
   - Copy Text button
   - Open in Tab button

3. **Open Settings Button**
   - Toggles settings section visibility
   - Text changes between "Open settings" and "Close settings"

4. **Settings Section** (hidden by default)
   - API URL input with Save button
   - Voice selection dropdown

5. **Status Output Log**
   - Shows playback status, errors, and info messages
   - Auto-scrolls to latest entry

## Data Flow

### Text Extraction Flow (Auto on Load)
```
Page loads with article content
  → content.js: setupNarratorUI() detects span[data-text="true"]
  → Auto-calls extractText()
  → groupSpansByParent() groups spans by container
  → Updates UI with counts (spans, words, characters)
```

### Audio Playback Flow (Single Span)
```
content.js: playSingleSpan()
  → Sends "fetchTTS" message to background.js
  → background.js: POST to localhost:8000/tts
  → Streams back as "ttsChunk" messages
  → StreamingWavPlayer.addChunk()
  → AudioContext plays buffers
  → onComplete callback updates UI
  → Auto-scrolls to and highlights the span being played
```

### Audio Playback Flow (Sequential/Play All)
```
User clicks "Play All"
  → content.js: playSpansSequentially()
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

### From content.js to background.js
```javascript
{ type: "fetchTTS", text: "string", apiUrl: "string", voice: "string" }
```

### From background.js to content.js
```javascript
{ type: 'ttsChunk', done: boolean, value: Array<number> }
```

## Key Design Decisions

### Why inject UI instead of using a popup?
1. **Better UX**: Sidebar UI stays visible while scrolling through article
2. **Context**: UI is right next to the content being narrated
3. **No popups**: Doesn't block the page or require closing to continue reading

### Why use Twitter's native button styles?
1. **Seamless integration**: Buttons look like native Twitter elements
2. **Consistent UX**: Users are already familiar with Twitter's button patterns
3. **Less maintenance**: Inherits Twitter's styling updates automatically

### Why stream audio instead of waiting for full file?
1. **Faster time-to-audio**: Playback starts as soon as first chunk arrives
2. **Better feedback**: User hears something immediately vs waiting for generation
3. **Memory efficient**: Doesn't need to hold full audio file in memory

### Why use a background proxy for TTS?
1. **Mixed content**: HTTPS page cannot fetch from HTTP localhost
2. **Extension isolation**: Background scripts can make any HTTP request
3. **Streaming support**: Allows chunking response back to content script

### Why auto-extract on load?
1. **Less friction**: Users don't need to remember to click extract
2. **Faster workflow**: Can start playback immediately upon page load
3. **Better feedback**: Shows article stats right away
