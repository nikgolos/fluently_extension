# Meeting Recorder & Transcriber Chrome Extension

A Chrome extension that records meetings and transcribes them using Whisper AI.

## Features
- Record audio from your microphone
- Automatic transcription using Whisper AI
- Save transcriptions as CSV files
- Simple and intuitive interface

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. Add your OpenAI API key in `background.js`

## Usage

1. Click the extension icon in your Chrome toolbar
2. Click "Start Recording" to begin recording audio
3. Click "Stop Recording" when finished
4. The extension will automatically transcribe the audio and save it as a CSV file

## Requirements

- Chrome browser
- OpenAI API key (for Whisper AI)
- Microphone access

## Notes

- Make sure to add your OpenAI API key in the `background.js` file
- The extension requires microphone permissions
- Transcriptions are saved as CSV files with timestamps 