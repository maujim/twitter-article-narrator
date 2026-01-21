// Narrator UI - Injected interface for article narration
// This module handles the in-page UI, text extraction, and audio playback

// State
let extractedText = "";
let currentSpanIndex = 0;
let currentSpanText = "";
let totalSpanCount = 0;
let spanGroups = [];
let uiInjected = false;
let apiUrl = localStorage.getItem('ttsApiUrl') || 'http://localhost:8000';
let voice = localStorage.getItem('ttsVoice') || 'alba';

// Logging state
const MAX_LOG_ENTRIES = 10;
const ENABLE_TIMESTAMPS = true;
let logEntries = [];

// Log a status message to the #out element
function logStatus(message) {
  const outEl = document.getElementById('out');
  if (!outEl) return;

  // Add timestamp if enabled
  let entry = message;
  if (ENABLE_TIMESTAMPS) {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0]; // HH:MM:SS
    entry = `[${timestamp}] ${message}`;
  }

  // Append to log array
  logEntries.push(entry);

  // Trim to max entries
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
  }

  // Update DOM with all entries
  outEl.innerHTML = logEntries.map(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = entry;
    return div.outerHTML;
  }).join('');

  // Auto-scroll to bottom
  outEl.scrollTop = outEl.scrollHeight;
}

// Sequential playback state
let currentPlayer = null;
let isPlaying = false;
let sequentialSpans = [];
let totalSpans = 0;
let currentChunkListener = null;

// Group spans by their common container ancestor
function groupSpansByParent() {
  const selector = 'span[data-text="true"]';
  const spans = Array.from(document.querySelectorAll(selector));

  const parentMap = new Map();

  for (const span of spans) {
    let container = span.parentElement;
    while (container && container.tagName === 'SPAN') {
      container = container.parentElement;
    }
    if (!container) continue;

    if (!parentMap.has(container)) {
      parentMap.set(container, []);
    }
    parentMap.get(container).push(span);
  }

  const allContainers = Array.from(parentMap.keys());
  allContainers.sort((a, b) => {
    const aFirst = parentMap.get(a)[0];
    const bFirst = parentMap.get(b)[0];
    const position = aFirst.compareDocumentPosition(bFirst);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  const groups = [];
  for (const container of allContainers) {
    const containerSpans = parentMap.get(container);
    containerSpans.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const combinedText = containerSpans.map(s => s.textContent).join('');

    groups.push({
      parent: container,
      spans: containerSpans,
      text: combinedText,
      spanCount: containerSpans.length
    });
  }

  return groups;
}

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
async function playSingleSpan(text, spanIndex) {
  const startTime = performance.now();
  const outEl = document.getElementById('out');
  const groups = groupSpansByParent();

  currentSpanIndex = spanIndex;

  // Auto-scroll to and highlight the current span
  if (spanIndex >= 0 && spanIndex < groups.length) {
    const group = groups[spanIndex];
    if (group.spans.length > 0) {
      const firstSpan = group.spans[0];
      firstSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add 1-second highlight effect
      group.spans.forEach(span => {
        span.style.transition = 'background-color 0.3s ease';
        span.style.backgroundColor = '#3b82f6'; // blue highlight
      });

      setTimeout(() => {
        group.spans.forEach(span => {
          span.style.backgroundColor = '';
        });
      }, 1000);
    }
  }

  // Log span playback start (1-indexed for display)
  logStatus(`playing span ${spanIndex + 1} of ${totalSpans}`);
  logStatus('connecting to TTS...');

  const player = new StreamingWavPlayer();
  currentPlayer = player;

  return new Promise((resolve, reject) => {
    player.onComplete = (totalBytes) => {
      const sizeKB = (totalBytes / 1024).toFixed(2);
      logStatus(`audio size: ${sizeKB} KB (${totalBytes} bytes)`);

      // Wait for audio playback to actually finish before resolving
      player.waitForPlaybackEnd().then(() => {
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
        const firstAudioSecs = ((firstAudioTime - startTime) / 1000).toFixed(2);
        logStatus(`done (${firstAudioSecs}s to first audio, ${totalTime}s total)`);

        currentPlayer = null;
        resolve();
      });
    };

    player.onError = (error) => {
      currentPlayer = null;
      reject(error);
    };

    const chunkListener = (msg) => {
      if (msg.type === 'ttsChunk') {
        if (msg.done) {
          player.complete();
        } else if (msg.value) {
          player.addChunk(new Uint8Array(msg.value));
          if (!player.firstAudioChunkTime) {
            player.firstAudioChunkTime = performance.now();
            const timeToFirst = ((player.firstAudioChunkTime - firstAudioTime) / 1000).toFixed(2);
            logStatus(`first audio in ${timeToFirst}s`);
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(chunkListener);
    currentChunkListener = chunkListener;

    const originalOnComplete = player.onComplete;
    player.onComplete = (totalBytes) => {
      chrome.runtime.onMessage.removeListener(chunkListener);
      currentChunkListener = null;
      if (originalOnComplete) originalOnComplete(totalBytes);
    };

    let firstAudioTime = startTime;

    chrome.runtime.sendMessage(
      { type: "fetchTTS", text: text, apiUrl: apiUrl, voice: voice },
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
        logStatus('generating audio...');
        firstAudioTime = performance.now();
      }
    );
  });
}

// Play all spans sequentially with proper UI updates
async function playSpansSequentially(spans, startOffset = 0) {
  const narratorUi = document.getElementById('narrator-ui');
  try {
    for (let i = 0; i < spans.length; i++) {
      if (!isPlaying) break;
      await playSingleSpan(spans[i], startOffset + i);
    }

    if (isPlaying && currentSpanIndex === totalSpans) {
      isPlaying = false;
      if (narratorUi) {
        logStatus('playback complete');
        narratorUi.querySelector('#playAll').disabled = false;
        narratorUi.querySelector('#pausePlayback').disabled = true;
        narratorUi.querySelector('#stopPlayback').disabled = true;
        updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');
      }
    }
    currentPlayer = null;
  } catch (error) {
    console.error('Sequential playback error:', error);
    cleanupPlayback();
    if (narratorUi) {
      logStatus(`error: ${error.message}`);
      narratorUi.querySelector('#playAll').disabled = false;
      narratorUi.querySelector('#pausePlayback').disabled = true;
      narratorUi.querySelector('#stopPlayback').disabled = true;
      updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');
    }
  }
}

// Set up event listeners for the narrator UI
function setupNarratorEventListeners() {
  const narratorUi = document.getElementById('narrator-ui');
  if (!narratorUi) return;

  // Extract text function
  const extractText = () => {
    spanGroups = groupSpansByParent();
    if (spanGroups.length === 0) {
      logStatus("no text spans found");
      return;
    }

    totalSpanCount = spanGroups.length;
    extractedText = spanGroups.map(g => g.text).join(' ');

    const charCount = extractedText.length;
    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    logStatus(`Text extracted`);
    logStatus(`spans: ${totalSpanCount} | words: ${wordCount} | chars: ${charCount}`);

    narratorUi.querySelector('#copy').disabled = !extractedText;
    narratorUi.querySelector('#openTab').disabled = !extractedText;
    narratorUi.querySelector('#playAll').disabled = totalSpanCount === 0;

    totalSpans = totalSpanCount;
  };

  // Initialize API URL input from saved value
  const apiUrlInput = narratorUi.querySelector('#apiUrl');
  if (apiUrlInput) {
    apiUrlInput.value = apiUrl;
  }

  // Initialize voice select from saved value
  const voiceSelect = narratorUi.querySelector('#voice');
  if (voiceSelect) {
    voiceSelect.value = voice;
  }

  // Save settings button
  narratorUi.querySelector('#saveSettings').onclick = () => {
    const newUrl = apiUrlInput.value.trim();
    if (newUrl) {
      apiUrl = newUrl;
      localStorage.setItem('ttsApiUrl', apiUrl);
    }
    const newVoice = voiceSelect.value;
    if (newVoice) {
      voice = newVoice;
      localStorage.setItem('ttsVoice', voice);
    }
    logStatus('settings saved');
  };

  // Toggle settings button
  narratorUi.querySelector('#toggleSettings').onclick = () => {
    const settingsSection = narratorUi.querySelector('#settingsSection');
    const toggleBtn = narratorUi.querySelector('#toggleSettings');
    if (settingsSection.style.display === 'none') {
      settingsSection.style.display = 'block';
      updateButtonText(toggleBtn, 'Close settings');
    } else {
      settingsSection.style.display = 'none';
      updateButtonText(toggleBtn, 'Open settings');
    }
  };

  // Auto-extract on load
  extractText();

  // Play All (sequential playback)
  narratorUi.querySelector('#playAll').onclick = async () => {
    cleanupPlayback();

    sequentialSpans = spanGroups.map(g => g.text);
    if (sequentialSpans.length === 0) {
      logStatus("no text spans found");
      return;
    }

    isPlaying = true;
    const startIndex = currentSpanIndex > 0 ? currentSpanIndex - 1 : 0;
    const remainingSpans = sequentialSpans.slice(startIndex);

    narratorUi.querySelector('#playAll').disabled = true;
    narratorUi.querySelector('#pausePlayback').disabled = false;
    narratorUi.querySelector('#stopPlayback').disabled = false;

    logStatus(`API: ${apiUrl}`);
    logStatus(`Voice: ${voice}`);
    logStatus(`starting playback from span ${startIndex + 1}...`);

    playSpansSequentially(remainingSpans, startIndex);
  };

  // Pause playback
  narratorUi.querySelector('#pausePlayback').onclick = async () => {
    if (isPlaying && currentPlayer) {
      await currentPlayer.pause();
      isPlaying = false;
      updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Resume');
      logStatus('paused');
    } else if (currentPlayer) {
      await currentPlayer.resume();
      isPlaying = true;
      updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');
      logStatus('resumed');
    }
  };

  // Stop playback
  narratorUi.querySelector('#stopPlayback').onclick = () => {
    cleanupPlayback();
    logStatus('stopped');
    narratorUi.querySelector('#playAll').disabled = false;
    narratorUi.querySelector('#pausePlayback').disabled = true;
    narratorUi.querySelector('#stopPlayback').disabled = true;
    updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');
    currentSpanIndex = 0;
  };

  // Copy to clipboard
  narratorUi.querySelector('#copy').onclick = async () => {
    if (!extractedText) return;

    try {
      await navigator.clipboard.writeText(extractedText);
      logStatus("copied to clipboard!");
    } catch (err) {
      logStatus(`copy failed: ${err.message}`);
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
}

// Helper: Update button text content (handles nested span structure)
function updateButtonText(button, text) {
  // Try to find span with text content and update it
  const textSpan = button.querySelector('span[class*="r-dnmrzs"]');
  if (textSpan) {
    textSpan.textContent = text;
  } else {
    // Fallback: try to find any span with text
    const spans = button.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent && !span.querySelector('span')) {
        span.textContent = text;
        break;
      }
    }
  }
  // Update aria-label as well
  button.setAttribute('aria-label', text);
}

// Inject narrator UI into the Twitter sidebar
function setupNarratorUI() {
  const hasArticleText = document.querySelector('span[data-text="true"]');
  if (!hasArticleText) return;

  // Check if already injected
  if (uiInjected || document.getElementById('narrator-ui')) {
    return;
  }
  if (document.querySelector('aside[aria-label="Article Narrator"]')) {
    uiInjected = true;
    return;
  }

  // Find the aside element
  const sidebar = document.querySelector('aside[aria-label="Relevant people"]') ||
                  document.querySelector('aside');

  if (!sidebar) return;

  // Get the parent container
  const parentContainer = sidebar.parentElement;
  if (!parentContainer) return;

  // Mark injection as in progress
  uiInjected = true;

  // Load the UI template
  fetch(chrome.runtime.getURL('narrator-ui.html'))
    .then(response => response.text())
    .then(html => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const template = doc.querySelector('#narrator-ui-template');
      if (!template) return;

      // Clone the entire parent container
      const clonedParent = parentContainer.cloneNode(true);

      // Find the duplicate aside inside the cloned parent
      const clonedAside = clonedParent.querySelector('aside');
      if (!clonedAside) return;

      // ISOLATE TARGET: Find the Follow button once from the cloned aside
      const firstUl = clonedAside.querySelector(':scope > ul');
      let followButton = null;
      if (firstUl) {
        const buttons = firstUl.querySelectorAll('button');
        for (const btn of buttons) {
          const ariaLabel = btn.getAttribute('aria-label') || '';
          if (ariaLabel.includes('Follow')) {
            followButton = btn;
            break;
          }
        }
      }

      if (!followButton) {
        console.warn('Narrator UI: Could not find Follow button to clone');
      }

      // Create our custom narrator aside
      const narratorAside = document.createElement('aside');
      narratorAside.id = 'narrator-ui';
      narratorAside.setAttribute('aria-label', 'Article Narrator');

      // Copy the header structure from the original aside
      // Simple approach: clone aside → find first child div → recurse to find first span → replace text
      const firstChildDiv = clonedAside.querySelector(':scope > div');
      if (firstChildDiv) {
        const newHeader = firstChildDiv.cloneNode(true);

        // Recursively find the first span and replace its text
        function findFirstSpan(element) {
          if (element.tagName === 'SPAN') {
            return element;
          }
          for (const child of element.children) {
            const found = findFirstSpan(child);
            if (found) return found;
          }
          return null;
        }

        const firstSpan = findFirstSpan(newHeader);
        if (firstSpan) {
          firstSpan.textContent = 'Article Narrator';
        } else {
          newHeader.textContent = 'Article Narrator';
        }
        narratorAside.appendChild(newHeader);
      } else {
        console.warn('Narrator UI: Could not find header div to clone');
      }

      // Create the list and add our UI
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.setAttribute('role', 'listitem');

      const narratorUi = document.createElement('div');
      narratorUi.appendChild(template.content.cloneNode(true));

      // REPLACE BUTTONS: Clone the Follow button for our controls
      if (followButton) {
        // Clone for Copy and Open buttons
        const copyOpenContainer = narratorUi.querySelector('#copyOpenButtons');
        if (copyOpenContainer) {
          const copyBtn = followButton.cloneNode(true);
          copyBtn.id = 'copy';
          copyBtn.disabled = true;
          updateButtonText(copyBtn, 'Copy Text');

          const openTabBtn = followButton.cloneNode(true);
          openTabBtn.id = 'openTab';
          openTabBtn.disabled = true;
          updateButtonText(openTabBtn, 'Open in Tab');

          copyOpenContainer.appendChild(copyBtn);
          copyOpenContainer.appendChild(openTabBtn);
        }

        // Clone for Open settings button
        const openSettingsContainer = narratorUi.querySelector('#openSettingsButton');
        if (openSettingsContainer) {
          const openSettingsBtn = followButton.cloneNode(true);
          openSettingsBtn.id = 'toggleSettings';
          updateButtonText(openSettingsBtn, 'Open settings');
          openSettingsContainer.appendChild(openSettingsBtn);
        }

        // Clone for playback buttons
        const buttonContainer = narratorUi.querySelector('#playbackButtons');
        if (buttonContainer) {
          // Clone 3 times for Play All, Pause, Stop
          const playAllBtn = followButton.cloneNode(true);
          const pauseBtn = followButton.cloneNode(true);
          const stopBtn = followButton.cloneNode(true);

          playAllBtn.id = 'playAll';
          playAllBtn.disabled = true;
          updateButtonText(playAllBtn, 'Play All');

          pauseBtn.id = 'pausePlayback';
          pauseBtn.disabled = true;
          updateButtonText(pauseBtn, 'Pause');

          stopBtn.id = 'stopPlayback';
          stopBtn.disabled = true;
          updateButtonText(stopBtn, 'Stop');

          buttonContainer.appendChild(playAllBtn);
          buttonContainer.appendChild(pauseBtn);
          buttonContainer.appendChild(stopBtn);

          console.log('Narrator UI: Buttons cloned from Follow button');
        }
      }

      li.appendChild(narratorUi);
      ul.appendChild(li);
      narratorAside.appendChild(ul);

      // Replace the duplicate aside with our narrator aside
      clonedAside.replaceWith(narratorAside);

      // Insert the cloned parent as a sibling
      if (parentContainer.nextSibling) {
        parentContainer.parentNode.insertBefore(clonedParent, parentContainer.nextSibling);
      } else {
        parentContainer.parentNode.appendChild(clonedParent);
      }

      console.log('Narrator UI: Injected');

      setupNarratorEventListeners();
    })
    .catch(err => {
      console.error('Failed to load narrator UI template:', err);
      uiInjected = false; // Reset flag on failure
    });
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
