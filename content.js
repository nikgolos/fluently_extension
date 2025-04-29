let recognition;
let isRecording = false;
let lastTranscript = '';
let retryCount = 0;
const MAX_RETRIES = 3;
let autoStarted = false;
let hasReportedFinalTranscript = false;
let meetingEndCheckInterval = null;
let startTime = null;

// Function to check if we're on a Google Meet meeting page with correct URL pattern
function isGoogleMeetPage() {
  // Check for actual meeting URL pattern (meet.google.com/xxx-xxxx-xxx)
  const meetingRegex = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
  return meetingRegex.test(window.location.href);
}

// Function to check if meeting is active (not ended)
function isMeetingActive() {
  // Check if we're on a meeting page first
  if (!isGoogleMeetPage()) return false;
  
  // Check for elements that indicate the meeting has ended
  // Look for "rejoin" button or specific "meeting ended" elements
  const meetingEndedIndicators = [
    document.querySelector('.lAqQo'), // Meeting ended screen
    document.querySelector('[aria-label="Rejoin"]'), // Rejoin button
    document.querySelector('[aria-label="Return to home screen"]'), // Return button after meeting
    document.querySelector('.NzPR9b') // Meeting ended message container
  ];
  
  // If any of these elements exist, the meeting has ended
  const meetingEnded = meetingEndedIndicators.some(element => element !== null);
  
  if (meetingEnded && isRecording) {
    console.log("Meeting has ended, stopping recording");
    stopRecording();
    return false;
  }
  
  return !meetingEnded;
}

// Start meeting end detection
function startMeetingEndDetection() {
  if (meetingEndCheckInterval) {
    clearInterval(meetingEndCheckInterval);
  }
  
  meetingEndCheckInterval = setInterval(() => {
    if (!isMeetingActive() && isRecording) {
      console.log("Meeting end detected, stopping recording");
      stopRecording();
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Meeting ended, recording stopped'
      });
    }
  }, 5000); // Check every 5 seconds
}

// Initialize and auto-start on Google Meet
function initialize() {
  if (isGoogleMeetPage() && isMeetingActive() && !autoStarted) {
    console.log("Google Meet meeting detected, waiting to auto-start recording...");
    // Wait a bit to make sure the meeting is fully loaded
    setTimeout(() => {
      if (isMeetingActive()) {
        startRecording();
        autoStarted = true;
        startMeetingEndDetection();
      }
    }, 5000); // 5 second delay for meeting to fully load
  }
}

// Run initialization
initialize();

// Listen for URL changes (for single-page applications like Google Meet)
let lastUrl = window.location.href;
new MutationObserver(() => {
  if (lastUrl !== window.location.href) {
    lastUrl = window.location.href;
    console.log("URL changed to:", window.location.href);
    // Reset autoStarted flag if we navigate away from a meeting
    if (!isGoogleMeetPage()) {
      autoStarted = false;
      if (meetingEndCheckInterval) {
        clearInterval(meetingEndCheckInterval);
        meetingEndCheckInterval = null;
      }
    }
    // Initialize if we navigate to a meeting
    initialize();
  }
}).observe(document, {subtree: true, childList: true});

// Also monitor DOM changes that might indicate a meeting has ended without URL change
new MutationObserver(() => {
  // Only check if we're recording and on a meeting page
  if (isRecording && isGoogleMeetPage()) {
    isMeetingActive();
  }
}).observe(document.body, {childList: true, subtree: true});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in content script:", message);
  
  if (message.action === 'startRecording') {
    if (isGoogleMeetPage() && isMeetingActive()) {
      startRecording();
      startMeetingEndDetection();
      sendResponse({ status: 'started' });
    } else if (isGoogleMeetPage() && !isMeetingActive()) {
      sendResponse({ 
        status: 'error', 
        error: 'The meeting has ended. Please join an active meeting.' 
      });
    } else {
      sendResponse({ 
        status: 'error', 
        error: 'Not in a Google Meet meeting. Please join a meeting first.' 
      });
    }
  } else if (message.action === 'stopRecording') {
    stopRecording();
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'getStatus') {
    const isActive = isMeetingActive();
    sendResponse({ 
      isRecording: isRecording,
      isGoogleMeet: isGoogleMeetPage(),
      isMeetingActive: isActive,
      autoStarted: autoStarted
    });
  }
  return true;
});

function cleanupRecognition() {
  if (recognition) {
    try {
      recognition.stop();
      recognition.abort();
    } catch (e) {
      console.log('Cleanup error:', e);
    }
    recognition = null;
  }
  isRecording = false;
}

function startRecording() {
  try {
    // Check if meeting is active first
    if (!isMeetingActive()) {
      throw new Error('Cannot start recording: the meeting has ended');
    }
    
    console.log("Starting recording...");
    // First, clean up any existing recognition instance
    cleanupRecognition();
    
    // Reset flags
    hasReportedFinalTranscript = false;
    lastTranscript = '';
    
    // Set start time
    startTime = new Date();

    // Check if browser supports Web Speech API
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      throw new Error('Speech recognition not supported in this browser');
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log("Recognition started successfully");
      isRecording = true;
      retryCount = 0; // Reset retry count on successful start
      updateRecordingStatus();
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Recording started - Speak now'
      });
    };

    recognition.onresult = (event) => {
      // Log raw results for debugging
      console.log('Speech recognition results:', event.results);
      
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Add timestamp to each segment of final transcript
      if (finalTranscript) {
        const now = new Date();
        const timeSinceStart = ((now - startTime) / 1000).toFixed(1);
        const timestamp = `[${timeSinceStart}s] `;
        
        lastTranscript = lastTranscript + ' ' + timestamp + finalTranscript;
        chrome.runtime.sendMessage({
          type: 'transcriptUpdate',
          text: lastTranscript,
          isFinal: true
        });
      } else if (interimTranscript) {
        chrome.runtime.sendMessage({
          type: 'transcriptUpdate',
          text: interimTranscript,
          isFinal: false
        });
      }
    };

    recognition.onsoundstart = () => {
      console.log("Sound detected");
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Sound detected'
      });
    };

    recognition.onsoundend = () => {
      console.log("Sound ended");
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Sound ended'
      });
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      
      // Handle specific errors
      if (event.error === 'aborted' || event.error === 'not-allowed') {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'debug',
              text: `Restarting recognition after error (attempt ${retryCount}/${MAX_RETRIES})`
            });
            startRecording();
          }, 1000);
        } else {
          isRecording = false;
          chrome.runtime.sendMessage({
            type: 'error',
            error: `Speech recognition failed after ${MAX_RETRIES} retries. Please refresh the page.`
          });
          updateRecordingStatus();
        }
      } else {
        // For other errors, try to restart recognition
        setTimeout(() => {
          if (isRecording) {
            chrome.runtime.sendMessage({
              type: 'debug',
              text: 'Attempting to restart recognition after error'
            });
            recognition.start();
          }
        }, 1000);
      }
    };

    recognition.onend = () => {
      console.log('Recognition ended');
      // If we're still supposed to be recording, restart
      if (isRecording) {
        console.log('Restarting recognition...');
        try {
          recognition.start();
        } catch (e) {
          console.error('Error restarting recognition:', e);
        }
      } else {
        // We're intentionally stopping, send the final transcript
        console.log('Recording stopped');
        
        if (lastTranscript && !hasReportedFinalTranscript) {
          hasReportedFinalTranscript = true;
          
          console.log('Reporting final transcript:', lastTranscript);
          chrome.runtime.sendMessage({
            type: 'finalTranscript',
            text: lastTranscript.trim()
          });
        }
      }
    };

    recognition.start();
  } catch (error) {
    console.error('Error starting recording:', error);
    chrome.runtime.sendMessage({
      type: 'error',
      error: error.message
    });
  }
}

function stopRecording() {
  console.log("Stopping recording...");
  
  // Report the final transcript
  if (lastTranscript && !hasReportedFinalTranscript) {
    console.log('Reporting final transcript:', lastTranscript);
    chrome.runtime.sendMessage({
      type: 'finalTranscript',
      text: lastTranscript.trim()
    });
    hasReportedFinalTranscript = true;
  }
  
  // Cleanup
  cleanupRecognition();
  updateRecordingStatus();
  
  // Send debug message
  chrome.runtime.sendMessage({
    type: 'debug',
    text: 'Recording stopped'
  });
}

function updateRecordingStatus() {
  chrome.runtime.sendMessage({
    type: 'recordingStatus',
    isRecording: isRecording
  });
}

// Clean up on unload
window.addEventListener('beforeunload', () => {
  if (meetingEndCheckInterval) {
    clearInterval(meetingEndCheckInterval);
  }
  stopRecording();
}); 