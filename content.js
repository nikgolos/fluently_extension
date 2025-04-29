let recognition;
let isRecording = false;
let lastTranscript = '';
let retryCount = 0;
const MAX_RETRIES = 3;
let autoStarted = false;
let hasReportedFinalTranscript = false;
let meetingEndCheckInterval = null;
let meetingDetectionInterval = null;
let startTime = null;
let sessionId = null;
let autoSaveInterval = null;
let lastSavedLength = 0;

// Function to generate a unique session ID
function generateSessionId() {
  return 'meet-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

// Function to get current meeting code from URL
function getMeetingCode() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
  const match = url.match(meetRegex);
  return match && match[1] ? match[1] : 'unknown-meeting';
}

// Function to save transcript segments to chrome.storage
function saveTranscriptSegment(force = false) {
  if (!isRecording || !lastTranscript) return;
  
  // Only save if we have new content or force is true
  if (lastTranscript.length <= lastSavedLength && !force) return;
  
  const now = new Date();
  console.log(`Saving transcript segment (${lastTranscript.length} chars, last saved: ${lastSavedLength} chars)`);
  
  const segment = {
    sessionId: sessionId,
    meetingCode: getMeetingCode(),
    timestamp: now.toISOString(),
    formattedTime: now.toLocaleTimeString(),
    text: lastTranscript,
    isComplete: false
  };
  
  // Update last saved length
  lastSavedLength = lastTranscript.length;
  
  const data = {};
  data[`transcript_segment_${sessionId}`] = segment;
  data['latest_session_id'] = sessionId;
  
  // Save to chrome.storage
  chrome.storage.local.set(data, () => {
    console.log('Transcript segment saved to chrome.storage');
  });
}

// Function to start auto-saving segments
function startAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  
  console.log("Starting auto-save every 5 seconds...");
  
  // Save immediately first
  saveTranscriptSegment(true);
  
  autoSaveInterval = setInterval(() => {
    saveTranscriptSegment();
  }, 5000); // Save every 5 seconds
}

// Function to stop auto-saving
function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
  
  // Final save with force
  saveTranscriptSegment(true);
}

// Function to check if we're on a Google Meet meeting page with correct URL pattern
function isGoogleMeetPage() {
  // Check for actual meeting URL pattern (meet.google.com/xxx-xxxx-xxx)
  const meetingRegex = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
  return meetingRegex.test(window.location.href);
}

// Function to check if user is actually in an active meeting
function isParticipatingInMeeting() {
  if (!isGoogleMeetPage()) return false;
  
  // Check for elements that indicate user is in a meeting
  // These are Google Meet UI elements that appear when you're in an active call
  const activeMeetingIndicators = [
    // Microphone buttons
    document.querySelector('[aria-label="Turn off microphone (⌘+d)"]'),
    document.querySelector('[aria-label="Turn on microphone (⌘+d)"]'),
    document.querySelector('[aria-label="Mute (⌘+d)"]'),
    document.querySelector('[aria-label="Unmute (⌘+d)"]'),
    // Camera buttons
    document.querySelector('[aria-label="Turn off camera (⌘+e)"]'),
    document.querySelector('[aria-label="Turn on camera (⌘+e)"]'),
    document.querySelector('[aria-label="Turn camera on (⌘+e)"]'),
    document.querySelector('[aria-label="Turn camera off (⌘+e)"]'),
    // Leave call buttons
    document.querySelector('.VfPpkd-kBDsod[aria-label*="Leave call"]'),
    document.querySelector('.uArJ5e[aria-label*="Leave call"]'),
    document.querySelector('[aria-label="Leave call"]'),
    document.querySelector('[aria-label="Leave meeting"]'),
    // Captions button
    document.querySelector('[aria-label="Turn on captions"]'),
    document.querySelector('[aria-label="Turn off captions"]'),
    // Meeting controls container
    document.querySelector('.Tmb7Fd'),
    // Video tiles container
    document.querySelector('[data-allocation-index]'),
    document.querySelector('.Jrb8ue'), // Meeting bottom bar
    document.querySelector('[data-self-name]'), // Your own video tile
    // Present now button/menu
    document.querySelector('[aria-label="Present now"]'),
    // More options menu
    document.querySelector('[aria-label="More options"]'),
    // Meeting timer
    document.querySelector('.NzPR9b'),
    // Participants panel buttons
    document.querySelector('[aria-label="Show everyone"]'),
    document.querySelector('[aria-label="Chat with everyone"]'),
    // Other common meeting UI elements
    document.querySelector('.R5ccN'), // Bottom toolbar
    document.querySelector('.zWfAib') // Video grid container
  ];
  
  // If any of these elements exist, the user is in an active meeting
  return activeMeetingIndicators.some(element => element !== null);
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
    document.querySelector('.NzPR9b'), // Meeting ended message container
    document.querySelector('[aria-label*="left the meeting"]'), // Left meeting notification
    document.querySelector('[jsname="r4nke"]'), // Meeting ended container
    document.querySelector('[jsname="VnjFcf"]') // Post-meeting screen
  ];
  
  // Log which indicators we found for debugging
  const foundIndicators = meetingEndedIndicators
    .map((el, index) => el ? index : -1)
    .filter(i => i >= 0);
  
  if (foundIndicators.length > 0) {
    console.log(`Meeting end indicators found: ${foundIndicators.join(', ')}`);
  }
  
  // If any of these elements exist, the meeting has ended
  const meetingEnded = meetingEndedIndicators.some(element => element !== null);
  
  if (meetingEnded && isRecording) {
    console.log("Meeting has ended, stopping recording");
    stopRecording();
    
    // Explicitly signal to save the transcript
    if (lastTranscript && !hasReportedFinalTranscript) {
      saveTranscriptOnMeetingEnd();
    }
    
    return false;
  }
  
  return !meetingEnded;
}

// Function to explicitly save transcript when meeting ends
function saveTranscriptOnMeetingEnd() {
  console.log('Meeting ended, explicitly saving transcript:', lastTranscript);
  hasReportedFinalTranscript = true;
  
  // Mark the current segment as complete
  const segment = {
    sessionId: sessionId,
    meetingCode: getMeetingCode(),
    timestamp: new Date().toISOString(),
    formattedTime: new Date().toLocaleTimeString(),
    text: lastTranscript,
    isComplete: true
  };
  
  // Save the final state
  const data = {};
  data[`transcript_segment_${sessionId}`] = segment;
  data['latest_session_id'] = sessionId;
  data['latest_complete_session'] = sessionId;
  
  chrome.storage.local.set(data);
  
  // Also try to send via messages
  chrome.runtime.sendMessage({
    type: 'meetingEnded',
    sessionId: sessionId,
    text: lastTranscript.trim()
  });
  
  // Also send a regular finalTranscript message as a backup
  chrome.runtime.sendMessage({
    type: 'finalTranscript',
    sessionId: sessionId,
    text: lastTranscript.trim()
  });
}

// Initialize and auto-start on Google Meet
function initialize() {
  if (isGoogleMeetPage()) {
    console.log("Google Meet page detected, starting monitoring...");
    startMeetingDetection();
    
    // Initial check if already in a meeting - force immediate check
    setTimeout(() => {
      checkAndStartRecording();
    }, 2000); // Check after 2 seconds to allow UI to fully load
  }
}

// New function to explicitly check meeting status and start recording if needed
function checkAndStartRecording() {
  const isActive = isMeetingActive();
  const isParticipating = isParticipatingInMeeting();
  
  console.log("Explicit meeting check: Active:", isActive, "Participating:", isParticipating, "Recording:", isRecording, "AutoStarted:", autoStarted);
  
  if (isActive && isParticipating && !isRecording && !autoStarted) {
    console.log("User confirmed in active meeting! Starting recording...");
    startRecording();
    autoStarted = true;
    startMeetingEndDetection();
    
    chrome.runtime.sendMessage({
      type: 'debug',
      text: 'Meeting participation confirmed - Starting recording'
    });
  } else if (!isParticipating) {
    console.log("User not participating yet. Will continue monitoring...");
    
    // Try again after a delay if we're on a meeting page but not participating yet
    if (isGoogleMeetPage() && !autoStarted) {
      setTimeout(checkAndStartRecording, 3000);
    }
  }
}

// Start continuous meeting detection
function startMeetingDetection() {
  if (meetingDetectionInterval) {
    clearInterval(meetingDetectionInterval);
  }
  
  console.log("Starting meeting participation detection...");
  
  // Do an immediate check first
  checkAndStartRecording();
  
  meetingDetectionInterval = setInterval(() => {
    const isOnMeetPage = isGoogleMeetPage();
    const isActive = isMeetingActive();
    const isParticipating = isParticipatingInMeeting();
    
    console.log("Meeting detection: Page:", isOnMeetPage, "Active:", isActive, "Participating:", isParticipating);
    
    // If we're on a Meet page, the meeting is active, we're participating, and not already recording
    if (isOnMeetPage && isActive && isParticipating && !isRecording && !autoStarted) {
      console.log("User detected in active meeting! Starting recording automatically...");
      startRecording();
      autoStarted = true;
      startMeetingEndDetection();
      
      // Notify user that recording has started automatically
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Meeting detected - Recording started automatically'
      });
    }
    
    // If we're not in an active meeting anymore but recording is still on, stop it
    if ((!isParticipating || !isActive) && isRecording) {
      console.log("User no longer in active meeting. Stopping recording...");
      stopRecording();
    }
  }, 3000); // Check every 3 seconds instead of 5
}

// Start meeting end detection
function startMeetingEndDetection() {
  if (meetingEndCheckInterval) {
    clearInterval(meetingEndCheckInterval);
  }
  
  console.log("Starting meeting end detection...");
  
  meetingEndCheckInterval = setInterval(() => {
    const isActive = isMeetingActive();
    console.log(`Meeting end check: active=${isActive}, recording=${isRecording}`);
    
    if (!isActive && isRecording) {
      console.log("Meeting end detected, stopping recording");
      stopRecording();
      
      // Explicitly save transcript
      if (lastTranscript && !hasReportedFinalTranscript) {
        saveTranscriptOnMeetingEnd();
      }
      
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Meeting ended, recording stopped and transcript saved'
      });
    }
  }, 3000); // Check every 3 seconds instead of 5
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
      if (meetingDetectionInterval) {
        clearInterval(meetingDetectionInterval);
        meetingDetectionInterval = null;
      }
    }
    // Initialize if we navigate to a meeting
    initialize();
  }
}).observe(document, {subtree: true, childList: true});

// Also monitor DOM changes that might indicate a meeting has started or ended
new MutationObserver(() => {
  // Only check if we're on a Google Meet page
  if (isGoogleMeetPage()) {
    const isParticipating = isParticipatingInMeeting();
    const isActive = isMeetingActive();
    
    // If we're participating and not recording, start recording
    if (isParticipating && isActive && !isRecording && !autoStarted) {
      console.log("Meeting participation detected via DOM change!");
      startRecording();
      autoStarted = true;
      startMeetingEndDetection();
    }
    
    // If meeting ended while recording, stop recording and save transcript
    if (!isActive && isRecording) {
      console.log("Meeting end detected via DOM change!");
      stopRecording();
      
      // Explicitly save transcript
      if (lastTranscript && !hasReportedFinalTranscript) {
        saveTranscriptOnMeetingEnd();
      }
    }
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
    const isParticipating = isParticipatingInMeeting();
    sendResponse({ 
      isRecording: isRecording,
      isGoogleMeet: isGoogleMeetPage(),
      isMeetingActive: isActive,
      isParticipating: isParticipating,
      autoStarted: autoStarted
    });
  } else if (message.action === 'forceInitialize') {
    console.log("Forcing initialization of meeting detection...");
    
    // Reset flags to ensure we can start fresh
    autoStarted = false;
    
    // Start monitoring and check immediately
    initialize();
    
    // Respond with current status
    const isActive = isMeetingActive();
    const isParticipating = isParticipatingInMeeting();
    sendResponse({
      isGoogleMeet: isGoogleMeetPage(),
      isMeetingActive: isActive,
      isParticipating: isParticipating,
      initialized: true
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
    
    // Reset flags and initialize
    hasReportedFinalTranscript = false;
    lastTranscript = '';
    lastSavedLength = 0;
    
    // Generate a new session ID for this recording
    sessionId = generateSessionId();
    console.log(`New recording session started with ID: ${sessionId}`);
    
    // Set start time
    startTime = new Date();
    
    // Start auto-saving
    startAutoSave();

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
          sessionId: sessionId,
          text: lastTranscript,
          isFinal: true
        });
        
        // Save on significant transcript updates
        saveTranscriptSegment();
      } else if (interimTranscript) {
        chrome.runtime.sendMessage({
          type: 'transcriptUpdate',
          sessionId: sessionId,
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
            sessionId: sessionId,
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
  
  // Stop auto-save
  stopAutoSave();
  
  // Report the final transcript
  if (lastTranscript && !hasReportedFinalTranscript) {
    console.log('Reporting final transcript:', lastTranscript);
    chrome.runtime.sendMessage({
      type: 'finalTranscript',
      sessionId: sessionId,
      text: lastTranscript.trim()
    });
    hasReportedFinalTranscript = true;
    
    // Also save as complete session
    saveTranscriptOnMeetingEnd();
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
window.addEventListener('beforeunload', (event) => {
  console.log("Window beforeunload event triggered");
  
  // Stop intervals
  if (meetingEndCheckInterval) {
    clearInterval(meetingEndCheckInterval);
  }
  if (meetingDetectionInterval) {
    clearInterval(meetingDetectionInterval);
  }
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
  }
  
  // Make sure to save transcript when window is closed
  if (isRecording && lastTranscript && !hasReportedFinalTranscript) {
    console.log("Window closing while recording, saving transcript");
    saveTranscriptOnMeetingEnd();
  }
  
  stopRecording();
});

// Also listen for page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isRecording) {
    console.log("Page hidden while recording, checking if meeting ended");
    
    // Force a check of meeting status
    const isActive = isMeetingActive();
    if (!isActive && lastTranscript && !hasReportedFinalTranscript) {
      console.log("Meeting not active and page hidden, saving transcript");
      saveTranscriptOnMeetingEnd();
    }
  }
}); 