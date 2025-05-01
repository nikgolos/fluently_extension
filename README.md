# Google Meet Transcriber Chrome Extension

A Chrome extension that automatically transcribes Google Meet meetings using Web Speech API.

## Features
- Automatically detects when you join a Google Meet meeting
- Automatically starts transcribing when a meeting is detected
- Records and transcribes speech in real-time
- Auto-saves transcriptions at regular intervals
- View and manage saved transcriptions
- Simple and intuitive interface

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Usage

1. Join any Google Meet meeting
2. The extension will automatically detect the meeting and start transcribing
3. You can also manually control recording from the extension popup
4. View saved transcripts by clicking "View Saved Transcripts" in the popup

## Requirements

- Chrome browser
- Microphone access permission
- Google Meet access

## How It Works

This extension:
- Detects when you're in an active Google Meet meeting
- Uses the Web Speech API to transcribe speech in real-time
- Automatically saves transcripts at regular intervals
- Detects when meetings end and finalizes transcripts
- Provides an interface to view and manage your saved transcripts

## Project Structure

- `manifest.json` - Extension configuration
- `popup.html/js` - Extension popup interface
- `content.js` - Handles meeting detection and transcription
- `background.js` - Manages background processes and storage
- `transcripts.html/js` - Transcript viewing interface

## Privacy Note

All transcription happens locally in your browser using the Web Speech API. Your meeting audio and transcripts are stored locally and are not sent to any external servers. 