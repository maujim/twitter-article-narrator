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

  if (outEl) {
    outEl.textContent = `connecting to TTS...`;
  }

  const player = new StreamingWavPlayer();
  currentPlayer = player;

  return new Promise((resolve, reject) => {
    player.onComplete = (totalBytes) => {
      const audioInfoDiv = document.getElementById("audioInfo");
      const wavSizeSpan = document.getElementById("wavSize");
      if (audioInfoDiv && wavSizeSpan) {
        const sizeKB = (totalBytes / 1024).toFixed(2);
        wavSizeSpan.textContent = `${sizeKB} KB (${totalBytes} bytes)`;
        audioInfoDiv.classList.add("visible");
      }

      // Wait for audio playback to actually finish before resolving
      player.waitForPlaybackEnd().then(() => {
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
        const firstAudioSecs = ((firstAudioTime - startTime) / 1000).toFixed(2);
        if (outEl) {
          outEl.textContent = `done (${firstAudioSecs}s to first audio, ${totalTime}s total)`;
        }

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
            if (outEl) {
              outEl.textContent = `playing (first audio in ${timeToFirst}s)...`;
            }
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
        if (outEl) {
          outEl.textContent = `generating audio...`;
        }
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
        narratorUi.querySelector('#out').textContent = 'playback complete';
        narratorUi.querySelector('#playAll').disabled = false;
        narratorUi.querySelector('#pausePlayback').disabled = true;
        narratorUi.querySelector('#stopPlayback').disabled = true;
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
    }
  }
}

// Set up event listeners for the narrator UI
function setupNarratorEventListeners() {
  const narratorUi = document.getElementById('narrator-ui');
  if (!narratorUi) return;

  // Extract text function
  const extractText = () => {
    const out = narratorUi.querySelector('#out');

    spanGroups = groupSpansByParent();
    if (spanGroups.length === 0) {
      out.textContent = "no text spans found";
      return;
    }

    totalSpanCount = spanGroups.length;
    extractedText = spanGroups.map(g => g.text).join(' ');

    const charCount = extractedText.length;
    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    out.textContent = `spans: ${totalSpanCount} | words: ${wordCount} | chars: ${charCount}`;

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
    const out = narratorUi.querySelector('#out');
    const originalText = out.textContent;
    out.textContent = 'settings saved';
    setTimeout(() => {
      out.textContent = originalText;
    }, 1500);
  };

  // Auto-extract on load
  extractText();

  // Extract text button
  narratorUi.querySelector('#run').onclick = extractText;

  // Play All (sequential playback)
  narratorUi.querySelector('#playAll').onclick = async () => {
    const out = narratorUi.querySelector('#out');

    cleanupPlayback();

    sequentialSpans = spanGroups.map(g => g.text);
    if (sequentialSpans.length === 0) {
      out.textContent = "no text spans found";
      return;
    }

    isPlaying = true;
    const startIndex = currentSpanIndex > 0 ? currentSpanIndex - 1 : 0;
    const remainingSpans = sequentialSpans.slice(startIndex);

    narratorUi.querySelector('#playAll').disabled = true;
    narratorUi.querySelector('#pausePlayback').disabled = false;
    narratorUi.querySelector('#stopPlayback').disabled = false;
    out.textContent = `starting playback from span ${startIndex + 1}...`;

    playSpansSequentially(remainingSpans, startIndex);
  };

  // Pause playback
  narratorUi.querySelector('#pausePlayback').onclick = async () => {
    if (isPlaying && currentPlayer) {
      await currentPlayer.pause();
      isPlaying = false;
      narratorUi.querySelector('#out').textContent = 'paused';
    } else if (currentPlayer) {
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
    currentSpanIndex = 0;
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

      // Create our custom narrator aside
      const narratorAside = document.createElement('aside');
      narratorAside.id = 'narrator-ui';
      narratorAside.setAttribute('aria-label', 'Article Narrator');

      // Copy the header structure from the original aside
      const headerDiv = clonedAside.querySelector('div[dir="ltr"]');
      if (headerDiv) {
        const newHeader = headerDiv.cloneNode(false);
        newHeader.textContent = 'Article Narrator';
        narratorAside.appendChild(newHeader);
      }

      // Create the list and add our UI
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.setAttribute('role', 'listitem');

      const narratorUi = document.createElement('div');
      narratorUi.appendChild(template.content.cloneNode(true));

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
