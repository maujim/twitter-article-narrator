// Cache for extracted data (persists while tab is open, cleared on reload)
let cachedData = null;
let cachedGroups = null;

// Group spans by their common container ancestor
// Climbs up past nested span wrappers to find the actual paragraph container
function groupSpansByParent() {
  const selector = 'span[data-text="true"]';
  const spans = Array.from(document.querySelectorAll(selector));

  const parentMap = new Map(); // container element -> array of spans

  // For each span, find its container (climb past nested span wrappers)
  for (const span of spans) {
    let container = span.parentElement;

    // Climb up past nested spans to find the real container
    while (container && container.tagName === 'SPAN') {
      container = container.parentElement;
    }

    if (!container) continue;

    if (!parentMap.has(container)) {
      parentMap.set(container, []);
    }
    parentMap.get(container).push(span);
  }

  // Convert map to array of groups, preserving document order
  const allContainers = Array.from(parentMap.keys());

  // Sort containers by document order (position of first child)
  allContainers.sort((a, b) => {
    const aFirst = parentMap.get(a)[0];
    const bFirst = parentMap.get(b)[0];
    const position = aFirst.compareDocumentPosition(bFirst);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  // Build groups
  const groups = [];
  for (const container of allContainers) {
    const containerSpans = parentMap.get(container);
    // Sort spans within this container by document order
    containerSpans.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Combine text from all spans in this container
    const combinedText = containerSpans
      .map(s => s.textContent)
      .join('');

    groups.push({
      parent: container,
      spans: containerSpans,
      text: combinedText,
      spanCount: containerSpans.length
    });
  }

  return groups;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Return cached data if available
  if (msg.type === "getCache") {
    sendResponse({ cached: cachedData });
    return true;
  }

  // Clear cache
  if (msg.type === "clearCache") {
    cachedData = null;
    cachedGroups = null;
    sendResponse({ ok: true });
    return true;
  }

  // Get text of a specific group by index
  if (msg.type === "getSpanText") {
    const groups = groupSpansByParent();
    const index = msg.index;

    if (index < 0 || index >= groups.length) {
      sendResponse({ ok: false, error: `Invalid index: ${index}. Valid range: 0-${groups.length - 1}` });
      return true;
    }

    const group = groups[index];
    sendResponse({
      ok: true,
      index: index,
      text: group.text,
      spanCount: group.spanCount,
      totalSpans: groups.length
    });
    return true;
  }

  // Jump to (scroll to) a specific group
  if (msg.type === "jumpToSpan") {
    const groups = groupSpansByParent();
    const index = msg.index;

    if (index < 0 || index >= groups.length) {
      sendResponse({ ok: false, error: `Invalid index: ${index}` });
      return true;
    }

    const group = groups[index];
    // Scroll to the first span in the group
    if (group.spans.length > 0) {
      group.spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    sendResponse({ ok: true, index: index });
    return true;
  }

  if (msg.type !== "count") return;

  // Build groups and return summary
  const groups = groupSpansByParent();
  const rawSpans = document.querySelectorAll('span[data-text="true"]');

  // Collect all text from the groups
  const fullText = groups
    .map(g => g.text)
    .join(' ');

  const firstGroupText = groups.length > 0 ? groups[0].text : '';

  // Cache the result
  cachedData = {
    count: groups.length,
    rawSpanCount: rawSpans.length,
    text: fullText,
    firstSpanText: firstGroupText
  };

  sendResponse(cachedData);
  return true;
});

// State for in-page popup2 UI
let extractedText = "";
let currentSpanIndex = 0;
let currentSpanText = "";
let lastPlayedAudioSize = 0;
let totalSpanCount = 0;
let spanGroups = [];

// State for sequential playback (from original content.js)
let currentPlayer = null;
let isPlaying = false;
let sequentialSpans = []; // Array of span texts to play sequentially
let totalSpans = 0;
let currentChunkListener = null;

// Clean up playback state and listeners
function cleanupPlayback() {
  if (currentChunkListener) {
    chrome.runtime.onMessage.removeListener(currentChunkListener);
    currentChunkListener = null;
  }
  if (currentPlayer) {
    currentPlayer.stop();
    currentPlayer = null;
  }
  isPlaying = false;
}

// Play a single span's audio and return a promise that resolves when done
// Uses background script proxy to avoid mixed content blocking (https → http)
async function playSingleSpan(text, spanIndex) {
  const startTime = performance.now();
  const outEl = document.getElementById('out');
  const groups = groupSpansByParent();

  // Update popup2 UI to show current span
  currentSpanIndex = spanIndex;
  if (spanIndex >= 0 && spanIndex < groups.length) {
    updateSpanInfo(groups[spanIndex].text, spanIndex);
  }

  // Update status text
  if (outEl) {
    outEl.textContent = `connecting to TTS...`;
  }

  // Create streaming player
  const player = new StreamingWavPlayer();
  currentPlayer = player;

  return new Promise((resolve, reject) => {
    player.onComplete = (totalBytes) => {
      // Track audio size for Estimate feature
      lastPlayedAudioSize = totalBytes;

      // Update audio info panel
      const audioInfoDiv = document.getElementById("audioInfo");
      const wavSizeSpan = document.getElementById("wavSize");
      if (audioInfoDiv && wavSizeSpan) {
        const sizeKB = (totalBytes / 1024).toFixed(2);
        wavSizeSpan.textContent = `${sizeKB} KB (${totalBytes} bytes)`;
        audioInfoDiv.classList.add("visible");
      }

      // Enable estimate button
      const estimateBtn = document.getElementById("estimate");
      if (estimateBtn) {
        estimateBtn.disabled = false;
      }

      const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
      const firstAudioSecs = ((firstAudioTime - startTime) / 1000).toFixed(2);
      if (outEl) {
        outEl.textContent = `done (${firstAudioSecs}s to first audio, ${totalTime}s total)`;
      }

      currentPlayer = null;
      resolve();
    };

    player.onError = (error) => {
      currentPlayer = null;
      reject(error);
    };

    // Set up listener for streaming chunks from background script
    const chunkListener = (msg) => {
      if (msg.type === 'ttsChunk') {
        if (msg.done) {
          player.complete();
        } else if (msg.value) {
          player.addChunk(new Uint8Array(msg.value));
          // Update status on first audio chunk
          if (!player.firstAudioChunkTime) {
            player.firstAudioChunkTime = performance.now();
            const timeToFirst = ((player.firstAudioChunkTime - firstAudioTime) / 1000).toFixed(2);
            if (outEl) {
              outEl.textContent = `playing (first audio in ${timeToFirst}s)...`;
            }
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(chunkListener);
    currentChunkListener = chunkListener;

    // Clean up listener after playback completes
    const originalOnComplete = player.onComplete;
    player.onComplete = (totalBytes) => {
      chrome.runtime.onMessage.removeListener(chunkListener);
      currentChunkListener = null;
      if (originalOnComplete) originalOnComplete(totalBytes);
    };

    let firstAudioTime = startTime;

    // Start the TTS fetch via background script
    chrome.runtime.sendMessage(
      { type: "fetchTTS", text: text },
      (response) => {
        if (chrome.runtime.lastError) {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error('No response from background script'));
          return;
        }
        if (response.type === 'error') {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(response.error));
          return;
        }
        if (!response.ok) {
          chrome.runtime.onMessage.removeListener(chunkListener);
          currentChunkListener = null;
          reject(new Error(`Failed to start TTS`));
          return;
        }
        // Got start signal, audio is generating
        if (outEl) {
          outEl.textContent = `generating audio...`;
        }
        firstAudioTime = performance.now();
        // If successful, the chunkListener will handle the streaming
      }
    );
  });
}

// Play all spans sequentially with proper UI updates
async function playSpansSequentially(spans, startOffset = 0) {
  const narratorUi = document.getElementById('narrator-ui');
  try {
    for (let i = 0; i < spans.length; i++) {
      if (!isPlaying) {
        // User stopped playback
        break;
      }
      // Use startOffset + i + 1 for 1-based display index
      await playSingleSpan(spans[i], startOffset + i + 1);
    }

    // All spans completed or playback was stopped
    if (isPlaying && currentSpanIndex === totalSpans) {
      // Natural completion
      isPlaying = false;
      if (narratorUi) {
        narratorUi.querySelector('#out').textContent = 'playback complete';
        narratorUi.querySelector('#playAll').disabled = false;
        narratorUi.querySelector('#pausePlayback').disabled = true;
        narratorUi.querySelector('#stopPlayback').disabled = true;
        narratorUi.querySelector('#playFirst').disabled = totalSpanCount === 0;
        narratorUi.querySelector('#playCurrent').disabled = false;
      }
    }
    currentPlayer = null;
  } catch (error) {
    console.error('Sequential playback error:', error);
    cleanupPlayback();
    if (narratorUi) {
      narratorUi.querySelector('#out').textContent = `playback error: ${error.message}`;
      narratorUi.querySelector('#playAll').disabled = false;
      narratorUi.querySelector('#pausePlayback').disabled = true;
      narratorUi.querySelector('#stopPlayback').disabled = true;
      narratorUi.querySelector('#playFirst').disabled = totalSpanCount === 0;
      narratorUi.querySelector('#playCurrent').disabled = false;
    }
  }
}

// Update the span info panel
function updateSpanInfo(text, index) {
  currentSpanText = text;
  currentSpanIndex = index;

  const spanInfoDiv = document.getElementById("spanInfo");
  const spanIndexSpan = document.getElementById("spanIndex");
  const spanTextDiv = document.getElementById("spanText");
  const spanLengthSpan = document.getElementById("spanLength");
  const spanWordsSpan = document.getElementById("spanWords");

  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;

  spanIndexSpan.textContent = index + 1;
  spanTextDiv.textContent = preview;
  spanLengthSpan.textContent = text.length;
  spanWordsSpan.textContent = words;
  spanInfoDiv.classList.add("visible");

  // Update pagination
  document.getElementById("currentSpan").textContent = index + 1;
  updatePaginationButtons();
}

// Update pagination button states
function updatePaginationButtons() {
  document.getElementById("prevSpan").disabled = currentSpanIndex <= 0;
  document.getElementById("nextSpan").disabled = currentSpanIndex >= totalSpanCount - 1;
}

// Show pagination and jump controls
function showNavigation() {
  document.getElementById("pagination").style.display = "flex";
  document.getElementById("jumpGroup").style.display = "flex";
  document.getElementById("totalSpans").textContent = totalSpanCount;
}

// Load span by index directly
function loadSpan(index) {
  if (index < 0 || index >= spanGroups.length) {
    return false;
  }
  const group = spanGroups[index];
  updateSpanInfo(group.text, index);
  return true;
}

// Inject narrator UI into the Twitter sidebar
// Uses the popup2.html UI design verbatim
function setupNarratorUI() {
  // Only run on Twitter/X article pages (pages with extractable text)
  const hasArticleText = document.querySelector('span[data-text="true"]');
  if (!hasArticleText) {
    return;
  }

  // Check if narrator UI already exists
  if (document.getElementById('narrator-ui')) {
    return;
  }

  // Try to find the sidebar by aria-label first, then fallback to first <aside>
  const sidebar = document.querySelector('aside[aria-label="Relevant people"]') ||
                  document.querySelector('aside');

  if (!sidebar) {
    return;
  }

  // Create shadow DOM to isolate styles
  const narratorUi = document.createElement('div');
  narratorUi.id = 'narrator-ui';

  // Add the popup2.html UI verbatim with scoped styles
  narratorUi.innerHTML = `
    <style>
      #narrator-ui * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      #narrator-ui {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #333;
        background: #fafafa;
        padding: 8px;
      }

      #narrator-ui #out {
        padding: 8px 10px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        font-size: 11px;
        color: #6b7280;
        min-height: 18px;
        display: flex;
        align-items: center;
      }

      #narrator-ui .info-panel {
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11px;
        margin-bottom: 8px;
        display: none;
      }

      #narrator-ui .info-panel.visible {
        display: block;
      }

      #narrator-ui .info-panel.span-info {
        background: #eff6ff;
        border: 1px solid #dbeafe;
      }

      #narrator-ui .info-panel.audio-info {
        background: #fffbeb;
        border: 1px solid #fde68a;
      }

      #narrator-ui .info-panel.estimate-info {
        background: #f0fdf4;
        border: 1px solid #dcfce7;
      }

      #narrator-ui .info-label {
        font-weight: 600;
        color: #4b5563;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 3px;
      }

      #narrator-ui .info-value.preview {
        font-style: italic;
        color: #6b7280;
        margin: 4px 0;
        line-height: 1.4;
      }

      #narrator-ui .info-row {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid rgba(0,0,0,0.06);
      }

      #narrator-ui .info-row span {
        color: #9ca3af;
        font-size: 10px;
      }

      #narrator-ui .info-row strong {
        color: #374151;
        font-weight: 600;
      }

      #narrator-ui .btn-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      #narrator-ui .btn-row {
        display: flex;
        gap: 6px;
      }

      #narrator-ui button {
        flex: 1;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid #e5e7eb;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.1s ease;
        background: #fff;
        color: #374151;
      }

      #narrator-ui button:hover:not(:disabled) {
        background: #f9fafb;
        border-color: #d1d5db;
      }

      #narrator-ui button:active:not(:disabled) {
        background: #f3f4f6;
        transform: translateY(1px);
      }

      #narrator-ui button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      #narrator-ui button.primary {
        background: #2563eb;
        color: white;
        border-color: #2563eb;
      }

      #narrator-ui button.primary:hover:not(:disabled) {
        background: #1d4ed8;
        border-color: #1d4ed8;
      }

      #narrator-ui button.danger {
        background: #ef4444;
        color: white;
        border-color: #ef4444;
      }

      #narrator-ui button.danger:hover:not(:disabled) {
        background: #dc2626;
        border-color: #dc2626;
      }

      /* Pagination */
      #narrator-ui .pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        border: 1px solid #e5e7eb;
        border-radius: 5px;
        background: #fff;
        margin-bottom: 8px;
      }

      #narrator-ui .pagination button {
        flex: 1;
        padding: 8px 0;
        background: transparent;
        border: none;
        color: #2563eb;
        font-weight: 500;
        font-size: 11px;
      }

      #narrator-ui .pagination button:hover:not(:disabled) {
        background: #eff6ff;
      }

      #narrator-ui .pagination button:disabled {
        color: #d1d5db;
      }

      #narrator-ui .pagination-info {
        font-size: 10px;
        color: #9ca3af;
        text-align: center;
        flex: 0 0 auto;
        min-width: 50px;
        padding: 0 4px;
      }

      #narrator-ui .pagination-info strong {
        color: #374151;
      }

      #narrator-ui .divider {
        height: 1px;
        background: #e5e7eb;
        margin: 10px 0;
      }
    </style>

    <div class="btn-group">
      <button id="run" class="primary">Extract Text</button>
    </div>

    <div class="divider"></div>

    <div id="out">Ready</div>

    <div id="spanInfo" class="info-panel span-info">
      <div class="info-label">Span <span id="spanIndex">0</span></div>
      <div class="info-value preview" id="spanText"></div>
      <div class="info-row">
        <span><strong id="spanLength">0</strong> chars</span>
        <span><strong id="spanWords">0</strong> words</span>
      </div>
    </div>

    <div class="pagination" id="pagination" style="display: none;">
      <button id="prevSpan" disabled>&lt; Prev</button>
      <div class="pagination-info">
        <strong id="currentSpan">0</strong> / <strong id="totalSpans">0</strong>
      </div>
      <button id="nextSpan" disabled>Next &gt;</button>
    </div>

    <div class="btn-group" id="jumpGroup" style="display: none;">
      <button id="jumpToSpan">Jump to Span</button>
    </div>

    <div class="divider"></div>

    <div id="audioInfo" class="info-panel audio-info">
      <div class="info-label">Audio</div>
      <div class="info-row" style="margin-top: 0; padding-top: 0; border: none;">
        <span>Size</span>
        <span><strong id="wavSize">—</strong></span>
      </div>
    </div>

    <div id="estimateInfo" class="info-panel estimate-info">
      <div class="info-label">Document Estimate</div>
      <div class="info-row" style="margin-top: 0; padding-top: 0; border: none;">
        <span>Ratio</span>
        <span><strong id="ratioDisplay">—</strong> b/char</span>
      </div>
      <div class="info-row">
        <span>Total</span>
        <span><strong id="totalChars">—</strong> chars</span>
      </div>
      <div class="info-row">
        <span>Est. size</span>
        <span><strong id="estimatedSize">—</strong></span>
      </div>
    </div>

    <div class="divider"></div>

    <div class="btn-group">
      <div class="btn-row">
        <button id="copy" disabled>Copy Text</button>
        <button id="openTab" disabled>Open in Tab</button>
      </div>
      <div class="btn-row">
        <button id="playAll" class="primary" disabled>Play All</button>
        <button id="pausePlayback" disabled>Pause</button>
        <button id="stopPlayback" class="danger" disabled>Stop</button>
      </div>
      <div class="btn-row">
        <button id="playFirst" class="primary" disabled>Play First</button>
        <button id="playCurrent" class="primary" disabled>Play Current</button>
      </div>
      <div class="btn-row">
        <button id="estimate" disabled>Estimate Audio</button>
      </div>
    </div>
  `;

  // Clone the sidebar and insert our UI
  const clonedSidebar = sidebar.cloneNode(true);
  clonedSidebar.setAttribute('aria-label', 'Article Narrator');

  // Find and update the header
  const headerDiv = clonedSidebar.querySelector('div[dir="ltr"]');
  if (headerDiv) {
    headerDiv.textContent = 'Article Narrator';
  }

  // Find the <ul> inside the cloned sidebar
  const ul = clonedSidebar.querySelector('ul');
  if (!ul) {
    return;
  }

  // Clear the existing <li> items
  while (ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  // Create a new <li> for our narrator UI
  const newLi = document.createElement('li');
  newLi.setAttribute('role', 'listitem');
  newLi.appendChild(narratorUi);

  // Add the <li> to the <ul>
  ul.appendChild(newLi);

  // Insert the cloned sidebar AFTER the original sidebar
  if (sidebar.nextSibling) {
    sidebar.parentNode.insertBefore(clonedSidebar, sidebar.nextSibling);
  } else {
    sidebar.parentNode.appendChild(clonedSidebar);
  }

  console.log('Narrator UI: Injected with popup2.html design');

  // Set up event listeners for the injected UI
  setupNarratorEventListeners();
}

// Set up event listeners for the narrator UI
function setupNarratorEventListeners() {
  const narratorUi = document.getElementById('narrator-ui');
  if (!narratorUi) return;

  // Extract text button
  narratorUi.querySelector('#run').onclick = () => {
    const out = narratorUi.querySelector('#out');

    spanGroups = groupSpansByParent();
    if (spanGroups.length === 0) {
      out.textContent = "no text spans found";
      return;
    }

    totalSpanCount = spanGroups.length;
    extractedText = spanGroups.map(g => g.text).join(' ');
    lastPlayedAudioSize = 0;

    const charCount = extractedText.length;
    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    out.textContent = `spans: ${totalSpanCount} | words: ${wordCount} | chars: ${charCount}`;

    // Enable buttons
    narratorUi.querySelector('#copy').disabled = !extractedText;
    narratorUi.querySelector('#openTab').disabled = !extractedText;
    narratorUi.querySelector('#playFirst').disabled = totalSpanCount === 0;
    narratorUi.querySelector('#playAll').disabled = totalSpanCount === 0;

    // Store sequential playback state
    totalSpans = totalSpanCount;

    // Show navigation and load first span
    if (totalSpanCount > 0) {
      showNavigation();
      loadSpan(0);
      narratorUi.querySelector('#playCurrent').disabled = false;
    }
  };

  // Play All (sequential playback)
  narratorUi.querySelector('#playAll').onclick = async () => {
    const out = narratorUi.querySelector('#out');

    // Stop any current playback
    cleanupPlayback();

    // Extract span texts
    sequentialSpans = spanGroups.map(g => g.text);
    if (sequentialSpans.length === 0) {
      out.textContent = "no text spans found";
      return;
    }

    isPlaying = true;
    // Start from current span index (allows resuming if paused mid-article)
    const startIndex = currentSpanIndex > 0 ? currentSpanIndex - 1 : 0;
    const remainingSpans = sequentialSpans.slice(startIndex);

    // Update UI
    narratorUi.querySelector('#playAll').disabled = true;
    narratorUi.querySelector('#pausePlayback').disabled = false;
    narratorUi.querySelector('#stopPlayback').disabled = false;
    narratorUi.querySelector('#playFirst').disabled = true;
    narratorUi.querySelector('#playCurrent').disabled = true;
    out.textContent = `starting playback from span ${startIndex + 1}...`;

    // Start sequential playback with offset for correct numbering
    playSpansSequentially(remainingSpans, startIndex);
  };

  // Pause playback
  narratorUi.querySelector('#pausePlayback').onclick = async () => {
    if (isPlaying && currentPlayer) {
      // Pause
      await currentPlayer.pause();
      isPlaying = false;
      narratorUi.querySelector('#out').textContent = 'paused';
    } else if (currentPlayer) {
      // Resume
      await currentPlayer.resume();
      isPlaying = true;
      narratorUi.querySelector('#out').textContent = 'playing...';
    }
  };

  // Stop playback
  narratorUi.querySelector('#stopPlayback').onclick = () => {
    cleanupPlayback();
    narratorUi.querySelector('#out').textContent = 'stopped';
    narratorUi.querySelector('#playAll').disabled = false;
    narratorUi.querySelector('#pausePlayback').disabled = true;
    narratorUi.querySelector('#stopPlayback').disabled = true;
    narratorUi.querySelector('#playFirst').disabled = totalSpanCount === 0;
    narratorUi.querySelector('#playCurrent').disabled = false;
    currentSpanIndex = 0;
  };

  // Previous span
  narratorUi.querySelector('#prevSpan').onclick = () => {
    if (currentSpanIndex > 0) {
      loadSpan(currentSpanIndex - 1);
    }
  };

  // Next span
  narratorUi.querySelector('#nextSpan').onclick = () => {
    if (currentSpanIndex < totalSpanCount - 1) {
      loadSpan(currentSpanIndex + 1);
    }
  };

  // Jump to span (scrolls to it in the page)
  narratorUi.querySelector('#jumpToSpan').onclick = () => {
    const groups = groupSpansByParent();
    const index = currentSpanIndex;

    if (index < 0 || index >= groups.length) {
      return;
    }

    const group = groups[index];
    // Scroll to the first span in the group
    if (group.spans.length > 0) {
      group.spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    narratorUi.querySelector('#out').textContent = `jumped to span ${currentSpanIndex + 1}`;
  };

  // Copy to clipboard
  narratorUi.querySelector('#copy').onclick = async () => {
    if (!extractedText) return;

    try {
      await navigator.clipboard.writeText(extractedText);
      const out = narratorUi.querySelector('#out');
      const originalText = out.textContent;
      out.textContent = "copied to clipboard!";
      setTimeout(() => {
        out.textContent = originalText;
      }, 2000);
    } catch (err) {
      narratorUi.querySelector('#out').textContent = `copy failed: ${err.message}`;
    }
  };

  // Open in new tab
  narratorUi.querySelector('#openTab').onclick = () => {
    if (!extractedText) return;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Extracted Text</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      font-family: Georgia, serif;
      font-size: 18px;
      line-height: 1.6;
      color: #333;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <pre>${extractedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>
  `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Play first span (single span, not sequential)
  narratorUi.querySelector('#playFirst').onclick = async () => {
    const out = narratorUi.querySelector('#out');

    // Stop any current playback
    cleanupPlayback();

    loadSpan(0);
    const groups = groupSpansByParent();
    if (groups.length === 0) {
      out.textContent = "no text spans found";
      return;
    }

    isPlaying = true;
    out.textContent = `playing span 1/${groups.length}...`;

    try {
      await playSingleSpan(groups[0].text, 1);
      out.textContent = 'done';
      isPlaying = false;
    } catch (err) {
      out.textContent = `error: ${err.message}`;
      isPlaying = false;
    }
  };

  // Play current span (single span, not sequential)
  narratorUi.querySelector('#playCurrent').onclick = async () => {
    const out = narratorUi.querySelector('#out');
    const groups = groupSpansByParent();

    if (groups.length === 0 || currentSpanIndex < 0 || currentSpanIndex >= groups.length) {
      out.textContent = "no span to play";
      return;
    }

    // Stop any current playback
    cleanupPlayback();

    isPlaying = true;
    out.textContent = `playing span ${currentSpanIndex + 1}/${groups.length}...`;

    try {
      await playSingleSpan(groups[currentSpanIndex].text, currentSpanIndex + 1);
      out.textContent = 'done';
      isPlaying = false;
    } catch (err) {
      out.textContent = `error: ${err.message}`;
      isPlaying = false;
    }
  };

  // Calculate estimated full audio size
  narratorUi.querySelector('#estimate').onclick = () => {
    const currentSpanChars = parseInt(narratorUi.querySelector('#spanLength').textContent, 10);

    if (!lastPlayedAudioSize || !currentSpanChars || !extractedText) return;

    const totalChars = extractedText.length;
    const ratio = lastPlayedAudioSize / currentSpanChars;
    const estimatedBytes = totalChars * ratio;
    const estimatedKB = estimatedBytes / 1024;
    const estimatedMB = estimatedKB / 1024;

    const estimateInfoDiv = narratorUi.querySelector('#estimateInfo');
    narratorUi.querySelector('#ratioDisplay').textContent = ratio.toFixed(2);
    narratorUi.querySelector('#totalChars').textContent = totalChars.toLocaleString();

    let sizeText;
    if (estimatedMB >= 1) {
      sizeText = `${estimatedMB.toFixed(2)} MB`;
    } else {
      sizeText = `${estimatedKB.toFixed(2)} KB`;
    }
    sizeText += ` (${Math.round(estimatedBytes).toLocaleString()} bytes)`;

    narratorUi.querySelector('#estimatedSize').textContent = sizeText;
    estimateInfoDiv.classList.add('visible');
  };
}

// Use a MutationObserver to handle Twitter's dynamic content loading
const observer = new MutationObserver(() => {
  setupNarratorUI();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also run on initial load
setupNarratorUI();
