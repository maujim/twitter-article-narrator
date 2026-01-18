# article narrator

chrome extension that scrolls through articles while text-to-speech plays.

## install

1. download all files (manifest.json, background.js, content.js, popup.html, popup.js) into a folder
2. open chrome and go to `chrome://extensions/`
3. toggle "developer mode" in top right
4. click "load unpacked" and select your folder

## how it works

1. click the extension icon and hit "start"
2. the extension finds all `<span data-text="true">` tags on the page
3. buffers them into ~100 word chunks
4. sends chunks to your TTS server at `http://localhost:8000/tts`
5. maintains 2 concurrent requests so there's no gap between audio chunks
6. scrolls through the article as audio plays
7. plays the last span of each batch when that batch finishes

## api contract

your server at `http://localhost:8000/tts` should:
- accept multipart form-data POST
- expect fields like `text_0`, `text_1`, etc (one span per field)
- return a .wav file as the response body

example would be combining all the text and generating one audio file for the batch.

## controls

- **start**: begin narration
- **pause**: toggle pause/resume
- **stop**: stop and reset

stats show spans found, currently buffered, in-flight requests, and spans played.

## debug

if things break:
- check your server is running on localhost:8000
- check the error box in the popup for specific failures
- spans must have `data-text="true"` attribute to be picked up
