# Dev Tasks

## Checklist 1: Remove Estimate Audio
- [x] Remove `#estimate` button from `narrator-ui.html`
- [x] Remove `#estimateInfo` panel from `narrator-ui.html`
- [x] Remove estimate click handler from `content.js` (`narratorUi.querySelector('#estimate').onclick = ...`)
- [x] Remove `lastPlayedAudioSize` usage in estimate handler
- [x] Commit

## Checklist 2: Remove Play First / Play Current
- [x] Remove `#playFirst` and `#playCurrent` buttons from `narrator-ui.html`
- [x] Remove click handlers for both buttons from `content.js`
- [x] Remove disabled state toggling for these buttons in `cleanupPlayback()`, `playSpansSequentially()`, and other places
- [x] Commit

## Checklist 3: Remove Span Viewing UI
- [x] Remove `#spanInfo` panel from `narrator-ui.html`
- [x] Remove `#pagination` div from `narrator-ui.html`
- [x] Remove `#prevSpan` and `#nextSpan` buttons from `narrator-ui.html`
- [x] Remove `updateSpanInfo()` function from `content.js`
- [x] Remove `updatePaginationButtons()` function from `content.js`
- [x] Remove `loadSpan()` function from `content.js`
- [x] Remove `showNavigation()` function from `content.js`
- [x] Remove calls to these functions throughout `content.js`
- [x] Clean up related state: `currentSpanText`, `currentSpanIndex` used for UI display
- [x] Commit

## Checklist 4: Auto-Highlight Span During Playback
- [x] Remove `#jumpToSpan` button from `narrator-ui.html`
- [x] Remove `#jumpGroup` div from `narrator-ui.html`
- [x] Keep the jump logic (scrolling to span) but call it automatically in `playSingleSpan()`
- [x] Add 1-second highlight effect when span starts playing (e.g., flash background)
- [x] Commit

## Checklist 5: finish
- [x] just say "DONE"
