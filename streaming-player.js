// Streaming WAV Player - plays audio as chunks arrive
class StreamingWavPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = 0;
    this.numChannels = 0;
    this.headerParsed = false;
    this.headerBuffer = new Uint8Array(44);
    this.headerBytesReceived = 0;
    this.nextStartTime = 0;
    this.minBufferSize = 16384;
    this.pcmData = new Uint8Array(0);
    this.totalBytesReceived = 0;
    this.onComplete = null;
    this.onError = null;
  }

  parseWavHeader(header) {
    const view = new DataView(header.buffer);

    const riff = String.fromCharCode.apply(null, Array.from(header.slice(0, 4)));
    const wave = String.fromCharCode.apply(null, Array.from(header.slice(8, 12)));

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      throw new Error('Invalid WAV file');
    }

    this.numChannels = view.getUint16(22, true);
    this.sampleRate = view.getUint32(24, true);

    this.headerParsed = true;
  }

  appendPcmData(newData) {
    const newBuffer = new Uint8Array(this.pcmData.length + newData.length);
    newBuffer.set(this.pcmData);
    newBuffer.set(newData, this.pcmData.length);
    this.pcmData = newBuffer;
  }

  async tryPlayBuffer() {
    if (!this.headerParsed || this.pcmData.length < this.minBufferSize) {
      return;
    }

    const bytesPerSample = this.numChannels * 2; // 16-bit = 2 bytes
    const samplesToPlay = Math.floor(this.pcmData.length / bytesPerSample);
    const bytesToPlay = samplesToPlay * bytesPerSample;

    if (bytesToPlay === 0) return;

    const dataToPlay = this.pcmData.slice(0, bytesToPlay);
    this.pcmData = this.pcmData.slice(bytesToPlay);

    const audioBuffer = this.audioContext.createBuffer(
      this.numChannels,
      samplesToPlay,
      this.sampleRate
    );

    const int16Data = new Int16Array(dataToPlay.buffer, dataToPlay.byteOffset, samplesToPlay * this.numChannels);

    for (let channel = 0; channel < this.numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < samplesToPlay; i++) {
        channelData[i] = int16Data[i * this.numChannels + channel] / 32768;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);

    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;

    if (this.pcmData.length >= this.minBufferSize) {
      setTimeout(() => this.tryPlayBuffer(), 10);
    }
  }

  addChunk(chunk) {
    this.totalBytesReceived += chunk.length;

    if (!this.headerParsed) {
      const headerBytesNeeded = 44 - this.headerBytesReceived;
      const bytesToCopy = Math.min(headerBytesNeeded, chunk.length);

      this.headerBuffer.set(
        chunk.slice(0, bytesToCopy),
        this.headerBytesReceived
      );

      this.headerBytesReceived += bytesToCopy;

      if (this.headerBytesReceived >= 44) {
        this.parseWavHeader(this.headerBuffer);

        if (chunk.length > bytesToCopy) {
          this.appendPcmData(chunk.slice(bytesToCopy));
        }
      }
    } else {
      this.appendPcmData(chunk);
    }

    this.tryPlayBuffer();
  }

  complete() {
    if (this.onComplete) {
      this.onComplete(this.totalBytesReceived);
    }
  }

  // Returns a promise that resolves when audio playback is actually finished
  waitForPlaybackEnd() {
    return new Promise(resolve => {
      const check = () => {
        if (this.audioContext.currentTime >= this.nextStartTime) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  stop() {
    if (this.audioContext) {
      this.audioContext.close();
    }
  }

  async pause() {
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend();
    }
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}
