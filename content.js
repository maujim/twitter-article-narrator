// Content Script - Lightweight bridge for article narrator
// Handles message passing and caching between UI and background

// Cache for extracted data (persists while tab is open, cleared on reload)
let cachedData = null;
let cachedGroups = null;

// Group spans by their common container ancestor
// Used by the UI for text extraction and navigation
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

// Message handler for cross-script communication
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
    if (group.spans.length > 0) {
      group.spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    sendResponse({ ok: true, index: index });
    return true;
  }

  // Count and extract all text (legacy, for compatibility)
  if (msg.type === "count") {
    const groups = groupSpansByParent();
    const rawSpans = document.querySelectorAll('span[data-text="true"]');

    const fullText = groups.map(g => g.text).join(' ');
    const firstGroupText = groups.length > 0 ? groups[0].text : '';

    cachedData = {
      count: groups.length,
      rawSpanCount: rawSpans.length,
      text: fullText,
      firstSpanText: firstGroupText
    };

    sendResponse(cachedData);
    return true;
  }

  // Unknown message type - don't respond
  return false;
});
