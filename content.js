// Narrator UI - Injected interface for article narration
// This module handles the in-page UI, text extraction, and audio playback

// State
let extractedText = "";
let currentSpanIndex = 0;
let currentSpanText = "";
let totalSpanCount = 0;
let totalWordCount = 0;
let spanGroups = [];
let uiInjected = false;
let apiUrl = localStorage.getItem('ttsApiUrl') || 'http://localhost:8000';
let voice = localStorage.getItem('ttsVoice') || 'alba';

// Logging state
const MAX_LOG_ENTRIES = 10;
let logEntries = [];
let logEntryTemplate = null; // Template for cloning log entry styles

// Log a status message to the #out element
function logStatus(message) {
  const outEl = document.getElementById('out');
  if (!outEl) return;

  // Append to log array
  logEntries.push(message);

  // Trim to max entries
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
  }

  // Update DOM with all entries using the cloned template
  if (logEntryTemplate) {
    outEl.innerHTML = logEntries.map(entryText => {
      // Clone the template structure
      const clonedEntry = logEntryTemplate.cloneNode(true);
      // Find the inner span and update its text
      const innerSpan = clonedEntry.querySelector('span');
      if (innerSpan) {
        innerSpan.textContent = entryText;
      } else {
        // Fallback if no span found
        clonedEntry.textContent = entryText;
      }
      return clonedEntry.outerHTML;
    }).join('');
  } else {
    // Fallback to simple div structure if template not available
    outEl.innerHTML = logEntries.map(entry => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = entry;
      return div.outerHTML;
    }).join('');
  }

  // Auto-scroll to bottom
  outEl.scrollTop = outEl.scrollHeight;
}

// Sequential playback state
let currentPlayer = null;
let isPlaying = false;
let sequentialSpans = [];
let totalSpans = 0;
let currentChunkListener = null;

// Update progress bar UI
function updateProgressUI() {
  const progressText = document.getElementById('progressText');
  const progressBarFill = document.getElementById('progressBarFill');
  const playBtn = document.getElementById('playAll');

  if (!progressText || !progressBarFill) return;

  if (totalWordCount === 0) {
    progressText.textContent = 'No content';
    progressBarFill.style.width = '0%';
    if (playBtn) playBtn.disabled = true;
    return;
  }

  // Calculate current word position by counting words in completed spans
  const displayIndex = Math.min(currentSpanIndex, totalSpans);
  const isCurrentlyPlaying = isPlaying && currentPlayer;
  const spansCompleted = isCurrentlyPlaying ? displayIndex + 1 : displayIndex;

  let wordsCompleted = 0;
  for (let i = 0; i < spansCompleted && i < spanGroups.length; i++) {
    const text = spanGroups[i]?.text || '';
    wordsCompleted += text.split(/\s+/).filter(w => w.length > 0).length;
  }
  wordsCompleted = Math.min(wordsCompleted, totalWordCount);

  const percentage = totalWordCount > 0 ? Math.round((wordsCompleted / totalWordCount) * 100) : 0;

  if (wordsCompleted === 0) {
    progressText.textContent = `Not started • ${totalWordCount} words`;
    if (playBtn) {
      playBtn.disabled = false;
      updateButtonText(playBtn, 'Play');
    }
  } else if (wordsCompleted >= totalWordCount && !isCurrentlyPlaying) {
    progressText.textContent = `Complete • ${totalWordCount} words`;
    if (playBtn) {
      updateButtonText(playBtn, 'Play');
    }
  } else {
    progressText.textContent = `${wordsCompleted} of ${totalWordCount} words (${percentage}%)`;
    // Always show "Play" when not playing - no resume state
    if (playBtn && !isPlaying) {
      updateButtonText(playBtn, 'Play');
    }
  }

  progressBarFill.style.width = `${percentage}%`;
}

// Group spans by their common container ancestor with support for Pocket article structure
function groupSpansByParent() {
  // Try to find the main content container first
  const contentRoot = document.querySelector('div.public-DraftEditor-content > div[data-contents="true"]');

  if (!contentRoot) {
    // Fallback to old behavior if Pocket structure not found
    return groupSpansByParentLegacy();
  }

  const groups = [];
  const unknownElements = new Set();

  // Process each child of the content root
  for (const child of contentRoot.children) {
    // Skip separators
    if (child.tagName === 'SECTION') {
      const separator = child.querySelector('div[role="separator"]');
      if (separator) continue;
    }

    let spans = [];

    switch (child.tagName) {
      case 'OL':
      case 'UL':
        // Handle lists - iterate each <li> and combine all spans within
        const listItems = child.querySelectorAll(':scope > li');
        for (const li of listItems) {
          const liSpans = Array.from(li.querySelectorAll('span[data-text="true"]'));
          spans.push(...liSpans);
        }
        break;

      case 'DIV':
        // Check for longform-unstyled class
        if (child.classList.contains('longform-unstyled')) {
          spans = Array.from(child.querySelectorAll('span[data-text="true"]'));
        }
        // Check for dir='ltr' (headings)
        else if (child.getAttribute('dir') === 'ltr') {
          spans = Array.from(child.querySelectorAll('span[data-text="true"]'));
        }
        else {
          // Log unknown div type
          const className = child.className || '(no class)';
          unknownElements.add(`div.${className}`);
        }
        break;

      case 'BLOCKQUOTE':
        spans = Array.from(child.querySelectorAll('span[data-text="true"]'));
        break;

      default:
        // Log unknown element type
        unknownElements.add(`${child.tagName.toLowerCase()}`);
        break;
    }

    // Add group if we found spans
    if (spans.length > 0) {
      const combinedText = spans.map(s => s.textContent).join('');
      groups.push({
        parent: child,
        spans: spans,
        text: combinedText,
        spanCount: spans.length
      });
    }
  }

  // Log unknown elements if any
  if (unknownElements.size > 0) {
    console.log('Narrator: Unknown element types encountered:', Array.from(unknownElements).join(', '));
  }

  return groups;
}

// Legacy span grouping for non-Pocket pages
function groupSpansByParentLegacy() {
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

  const player = new StreamingWavPlayer();
  currentPlayer = player;

  // Update progress UI to show we're playing this span
  updateProgressUI();

  // Log span playback start (1-indexed for display)
  logStatus(`playing span ${spanIndex + 1} of ${totalSpans}`);
  logStatus('connecting to TTS...');

  return new Promise((resolve, reject) => {
    // Highlight and scroll to span when audio actually starts playing
    player.onFirstPlay = () => {
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
    };

    player.onComplete = (totalBytes) => {
      const sizeKB = (totalBytes / 1024).toFixed(2);
      logStatus(`audio size: ${sizeKB} KB (${totalBytes} bytes)`);

      // Wait for audio playback to actually finish before resolving
      player.waitForPlaybackEnd().then(() => {
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
        const firstAudioSecs = ((player.firstAudioChunkTime - startTime) / 1000).toFixed(2);
        logStatus(`done (${firstAudioSecs}s to first audio, ${totalTime}s total)`);

        currentPlayer = null;
        resolve();
      });
    };

    player.onError = (error) => {
      currentPlayer = null;
      reject(error);
    };

    let firstAudioTime = startTime;

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

      // Update progress after each span
      currentSpanIndex = startOffset + i + 1;
      updateProgressUI();
    }

    if (isPlaying && currentSpanIndex >= totalSpans) {
      isPlaying = false;
      if (narratorUi) {
        logStatus('playback complete');
        narratorUi.querySelector('#playAll').disabled = false;
        narratorUi.querySelector('#pausePlayback').disabled = true;
        narratorUi.querySelector('#stopPlayback').disabled = true;
        updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');
        updateProgressUI();
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
      updateProgressUI();
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
    totalWordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    logStatus(`Text extracted: ${totalSpanCount} spans | ${totalWordCount} words | ${charCount} chars`);

    totalSpans = totalSpanCount;

    // Reset to beginning and update UI
    currentSpanIndex = 0;
    updateProgressUI();

    const copyBtn = narratorUi.querySelector('#copy');
    const openTabBtn = narratorUi.querySelector('#openTab');

    if (copyBtn) copyBtn.disabled = !extractedText;
    if (openTabBtn) openTabBtn.disabled = !extractedText;
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

  // Save settings button - now a cloned button
  const saveSettingsBtn = narratorUi.querySelector('#saveSettings');
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = () => {
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
  }

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

  // Toggle debug log button
  narratorUi.querySelector('#toggleDebugLog').onclick = () => {
    const outEl = narratorUi.querySelector('#out');
    const separator = narratorUi.querySelector('#debugLogSeparator');
    const toggleBtn = narratorUi.querySelector('#toggleDebugLog');
    if (outEl.style.display === 'none') {
      outEl.style.display = 'block';
      separator.style.display = 'block';
      updateButtonText(toggleBtn, 'Close Debug Log');
    } else {
      outEl.style.display = 'none';
      separator.style.display = 'none';
      updateButtonText(toggleBtn, 'Open Debug Log');
    }
  };

  // Auto-extract on load
  extractText();

  // Play (sequential playback) - always starts from beginning
  narratorUi.querySelector('#playAll').onclick = async () => {
    cleanupPlayback();

    sequentialSpans = spanGroups.map(g => g.text);
    if (sequentialSpans.length === 0) {
      logStatus("no text spans found");
      return;
    }

    isPlaying = true;
    currentSpanIndex = 0; // Always start from beginning

    narratorUi.querySelector('#playAll').disabled = true;
    narratorUi.querySelector('#pausePlayback').disabled = false;
    narratorUi.querySelector('#stopPlayback').disabled = false;
    updateButtonText(narratorUi.querySelector('#pausePlayback'), 'Pause');

    logStatus(`Starting playback (API: ${apiUrl}, Voice: ${voice})`);

    playSpansSequentially(sequentialSpans, 0);
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
    updateProgressUI();
  };

  // Copy to clipboard
  const copyBtn = narratorUi.querySelector('#copy');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (!extractedText) return;

      try {
        await navigator.clipboard.writeText(extractedText);
        logStatus("copied to clipboard!");
      } catch (err) {
        logStatus(`copy failed: ${err.message}`);
      }
    };
  }

  // Open in new tab
  const openTabBtn = narratorUi.querySelector('#openTab');
  if (openTabBtn) {
    openTabBtn.onclick = () => {
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

// Check if the sidebar has space to display the UI
function isSidebarAvailable() {
  const sidebar = document.querySelector('aside[aria-label="Relevant people"]') ||
                  document.querySelector('aside');
  if (!sidebar) return false;

  const rect = sidebar.getBoundingClientRect();
  // Sidebar has space if it has meaningful width
  return rect.width > 50;
}

// Find and hide/show the narrator UI's parent container
function getNarratorContainer() {
  const narratorUi = document.getElementById('narrator-ui');
  if (!narratorUi) return null;
  // The UI is inside a cloned parent container
  const narratorAside = narratorUi.closest('aside');
  if (narratorAside && narratorAside.parentElement) {
    return narratorAside.parentElement;
  }
  return null;
}

function hideNarratorUI() {
  const container = getNarratorContainer();
  if (container) {
    container.style.display = 'none';
    console.log('Narrator UI: Hidden (sidebar not available)');
  }
}

function showNarratorUI() {
  const container = getNarratorContainer();
  if (container) {
    container.style.display = '';
    console.log('Narrator UI: Shown (sidebar available)');
  }
}

function setupVisibilityObserver() {
  // Check visibility periodically
  const checkInterval = setInterval(() => {
    const narratorUi = document.getElementById('narrator-ui');
    if (!narratorUi) return;

    if (!isSidebarAvailable()) {
      // Sidebar not available - hide the container
      hideNarratorUI();
    } else {
      // Sidebar available - make sure container is shown
      showNarratorUI();
    }
  }, 1000);

  // Also listen for window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const narratorUi = document.getElementById('narrator-ui');
      if (!narratorUi) return;

      if (isSidebarAvailable()) {
        showNarratorUI();
      } else {
        hideNarratorUI();
      }
    }, 300);
  });
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

      // Find and clone separator elements (look for div with role="separator" or border styling)
      let separatorTemplate = null;
      const potentialSeparators = clonedAside.querySelectorAll('[role="separator"]');
      if (potentialSeparators.length > 0) {
        separatorTemplate = potentialSeparators[0].cloneNode(true);
        console.log('Narrator UI: Cloned separator from [role="separator"]');
      } else {
        // Fallback: look for divs with border-bottom
        const allDivs = clonedAside.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          if (style.borderBottom && style.borderBottom !== 'none') {
            separatorTemplate = div.cloneNode(true);
            console.log('Narrator UI: Cloned separator from div with border');
            break;
          }
        }
      }

      // Find and clone the @username styled element structure for log entries
      // We look for a span that starts with "@", then get its parent div and grandparent div
      const allSpans = clonedAside.querySelectorAll('span');
      for (const span of allSpans) {
        if (span.textContent && span.textContent.trim().startsWith('@')) {
          const parentDiv = span.parentElement;
          const grandparentDiv = parentDiv ? parentDiv.parentElement : null;
          if (grandparentDiv) {
            // Clone the structure: grandparentDiv > parentDiv > span
            logEntryTemplate = grandparentDiv.cloneNode(true);
            console.log('Narrator UI: Cloned log entry template from @username styled element');
            break;
          }
        }
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

      // Add progress bar after header
      const progressSection = document.createElement('div');
      progressSection.id = 'progressSection';
      progressSection.style.padding = '12px';
      const progressText = document.createElement('div');
      progressText.id = 'progressText';
      progressText.style.fontSize = '12px';
      progressText.style.color = 'rgb(91, 112, 131)';
      progressText.style.marginBottom = '4px';
      progressText.style.textAlign = 'left';
      progressText.textContent = 'Not started';
      const progressBarTrack = document.createElement('div');
      progressBarTrack.id = 'progressBarTrack';
      progressBarTrack.style.width = '100%';
      progressBarTrack.style.height = '4px';
      progressBarTrack.style.backgroundColor = 'rgb(61, 81, 100)';
      progressBarTrack.style.borderRadius = '2px';
      progressBarTrack.style.overflow = 'hidden';
      const progressBarFill = document.createElement('div');
      progressBarFill.id = 'progressBarFill';
      progressBarFill.style.width = '0%';
      progressBarFill.style.height = '100%';
      progressBarFill.style.backgroundColor = 'rgb(29, 155, 240)';
      progressBarFill.style.transition = 'width 0.3s ease';
      progressBarTrack.appendChild(progressBarFill);
      progressSection.appendChild(progressText);
      progressSection.appendChild(progressBarTrack);
      narratorAside.appendChild(progressSection);

      // Create the list and add our UI
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.setAttribute('role', 'listitem');

      const narratorUi = document.createElement('div');
      narratorUi.appendChild(template.content.cloneNode(true));

      // Add separators to their containers
      if (separatorTemplate) {
        const separator1 = narratorUi.querySelector('#separator1');
        const debugLogSep = narratorUi.querySelector('#debugLogSeparator');
        if (separator1) separator1.appendChild(separatorTemplate.cloneNode(true));
        if (debugLogSep) debugLogSep.appendChild(separatorTemplate.cloneNode(true));
      }

      // REPLACE BUTTONS: Clone the Follow button for our controls
      if (followButton) {
        // Clone for Open settings button
        const openSettingsContainer = narratorUi.querySelector('#openSettingsButton');
        if (openSettingsContainer) {
          const openSettingsBtn = followButton.cloneNode(true);
          openSettingsBtn.id = 'toggleSettings';
          updateButtonText(openSettingsBtn, 'Open settings');
          openSettingsContainer.appendChild(openSettingsBtn);
        }

        // Clone for Save settings button
        const saveSettingsContainer = narratorUi.querySelector('#saveSettingsButton');
        if (saveSettingsContainer) {
          const saveSettingsBtn = followButton.cloneNode(true);
          saveSettingsBtn.id = 'saveSettings';
          saveSettingsBtn.style.flex = '1';
          updateButtonText(saveSettingsBtn, 'Save settings');
          saveSettingsContainer.appendChild(saveSettingsBtn);
        }

        // Clone for Debug log toggle button
        const debugLogContainer = narratorUi.querySelector('#debugLogButton');
        if (debugLogContainer) {
          const debugLogBtn = followButton.cloneNode(true);
          debugLogBtn.id = 'toggleDebugLog';
          debugLogBtn.style.flex = '1';
          updateButtonText(debugLogBtn, 'Open Debug Log');
          debugLogContainer.appendChild(debugLogBtn);
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
          playAllBtn.style.flex = '1';
          updateButtonText(playAllBtn, 'Play');

          pauseBtn.id = 'pausePlayback';
          pauseBtn.disabled = true;
          pauseBtn.style.flex = '1';
          updateButtonText(pauseBtn, 'Pause');

          stopBtn.id = 'stopPlayback';
          stopBtn.disabled = true;
          stopBtn.style.flex = '1';
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

// Setup visibility observer for responsive behavior
setupVisibilityObserver();
