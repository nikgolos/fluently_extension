let hasReportedFinalTranscript = false;
let isRecording = false;
let lastTranscript = '';
let sessionId = null;
let recognition = null;
let startTime = null;
let retryCount = 0;
const MAX_RETRIES = 3;
let autoStarted = false;
let meetingDetectionInterval = null;
let meetingEndCheckInterval = null;
let autoSaveInterval = null;
let lastSavedLength = 0;
// For language detection
let wordCount = 0;
let hasCheckedLanguage = false;
const LANGUAGE_DETECTION_WORD_THRESHOLD = 50;
const LANGUAGE_DETECTION_SAMPLE_SIZE = 50;
const LANGUAGE_DETECTION_CONFIDENCE_THRESHOLD = 59;
// Flag to mark if current call is non-English
let isCurrentCallEnglish = true;
// Flag to mark if current session is English
let isEnglish = null;
let currentMeetingCode = null;
const NON_ENGLISH_BLOCK_EXPIRATION_MS = 60 * 60 * 1000; // 1 hour in milliseconds

// Function to generate a unique session ID
function generateSessionId() {
  return 'meet-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

// Function to get current meeting code from URL
function getMeetingCode() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
  const match = url.match(meetRegex);
  const meetingCode = match && match[1] ? match[1] : 'unknown-meeting';
  
  // Update current meeting code if it's different
  if (currentMeetingCode !== meetingCode) {
    currentMeetingCode = meetingCode;
    // Reset the English flag for a new meeting
    isCurrentCallEnglish = true;
    console.log(`New meeting detected: ${meetingCode}, language checks reset`);
  }
  
  return meetingCode;
}

// Function to count words in transcript (excluding timestamps)
function countWordsInTranscript(text) {
  if (!text) return 0;
  
  // Remove timestamp markers
  const timestampRegex = /\[\s*[SE]:\s*\d+(?:\.\d+)?s\s*\]/g;
  const cleanedText = text.replace(timestampRegex, ' ');
  
  // Normalize spaces and split by space
  const words = cleanedText.replace(/\s+/g, ' ').trim().split(' ');
  return words.filter(word => word.length > 0).length;
}

// Function to get the last N words from transcript
function getLastNWords(text, n) {
  const words = text.split(/\s+/).filter(word => word.length > 0);
  // Get last n words
  return words.slice(-n).join(' ');
}

// Function to get or set userID for content script
async function getOrSetUserID_content() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userID'], (result) => {
            let currentUserID = result.userID;
            if (currentUserID) {
                // console.log('Found userID in storage (content.js):', currentUserID);
                resolve(currentUserID);
            } else {
                const timestamp = Date.now();
                const randomNumber = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                currentUserID = `${timestamp}-${randomNumber}`;
                chrome.storage.local.set({ userID: currentUserID }, () => {
                    // console.log('Generated and saved new userID (content.js):', currentUserID);
                    resolve(currentUserID);
                });
            }
        });
    });
}

// Function to check if language is English
async function checkLanguageIsEnglish(text) {
  if (!text) return true;
  
  const logMessage = `Checking language for text: \"${text.substring(0, 30)}${text.length > 30 ? '...' : ''}\"`;
  console.log("[Language Detection]", logMessage);
  sendLanguageDetectionLog(logMessage);
  
  console.log("[Language Detection] Text length:", text.length, "characters");
  sendLanguageDetectionLog(`Text length: ${text.length} characters`);
  
  const trimmedText = text.substring(0, 250); // Respect the 250 char limit
  const userID = await getOrSetUserID_content();
  const payload = { text: trimmedText, userID: userID };
  const requestBody = JSON.stringify(payload);
  
  try {
    console.log("[Language Detection] Sending API request to https://fluently-extension-backend-c1f2cc68e5b2.herokuapp.com/detect_language");
    console.log("[Language Detection] Request body:", requestBody);
    sendLanguageDetectionLog("Sending API request...");
    sendLanguageDetectionLog(`Request body: ${requestBody}`);
    
    const response = await fetch('https://fluently-extension-backend-c1f2cc68e5b2.herokuapp.com/detect_language', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });
    
    console.log("[Language Detection] Response status:", response.status);
    sendLanguageDetectionLog(`Response status: ${response.status}`);
    
    if (!response.ok) {
      const responseText = await response.text();
      const errorMsg = `Language detection API error: ${response.status}, Response: ${responseText}`;
      console.error("[Language Detection]", errorMsg);
      sendLanguageDetectionLog(errorMsg);
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    console.log("[Language Detection] API response:", data);
    console.log("[Language Detection] Confidence score:", data.confidence);
    console.log("[Language Detection] Cached result:", data.cached ? "Yes" : "No");
    
    sendLanguageDetectionLog(`Response: Confidence=${data.confidence}, Cached=${data.cached}`);
    
    const isDetectedEnglish = data.confidence >= LANGUAGE_DETECTION_CONFIDENCE_THRESHOLD;
    
    if (!isDetectedEnglish) {
      const warningMsg = `RESULT: Language is not English (score: ${data.confidence})`;
      console.log("[Language Detection]", warningMsg);
      sendLanguageDetectionLog(warningMsg);
      
      // Set the English flag to false for this session
      isEnglish = false;
      
      // Send warning message to UI
      chrome.runtime.sendMessage({
        type: 'warning',
        text: 'Language is not English'
      });
      
      // Delete the transcript and prevent further saving
      deleteTranscriptAndPreventSaving();
      
      return false;
    } else {
      const resultMsg = `RESULT: Language is English (score: ${data.confidence})`;
      console.log("[Language Detection]", resultMsg);
      sendLanguageDetectionLog(resultMsg);
      
      // Explicitly set the English flag to true for this session
      isEnglish = true;
    }
    
    return isDetectedEnglish;
  } catch (error) {
    const errorMsg = `ERROR: ${error.message}`;
    console.error("[Language Detection]", errorMsg);
    sendLanguageDetectionLog(errorMsg);
    
    // Report failure to the UI
    chrome.runtime.sendMessage({
      type: 'warning',
      text: 'Language detection failed'
    });
    
    // Mark check as failed instead of assuming English - don't need to log this twice
    return "FAILED"; // Return a non-boolean value to indicate failure
  }
}

// Function to send language detection logs to popup
function sendLanguageDetectionLog(message) {
  chrome.runtime.sendMessage({
    type: 'debug',
    text: `[Language Detection] ${message}`
  });
}

// Function to save transcript segments to chrome.storage
function saveTranscriptSegment(force = false) {
  // Check if this session is marked as non-English, if so, don't save anything
  if (isEnglish === false) {
    console.log("[Language Detection] Not saving transcript segment because session is marked as non-English");
    return;
  }

  if (!isRecording || !lastTranscript) return;
  
  // Only save if we have new content or force is true
  if (lastTranscript.length <= lastSavedLength && !force) return;
  
  const now = new Date();
  console.log(`Saving transcript segment (${lastTranscript.length} chars, last saved: ${lastSavedLength} chars)`);
  
  // Check word count for tracking
  const currentWordCount = countWordsInTranscript(lastTranscript);
  console.log("[Language Detection] Current word count:", currentWordCount, "Has checked language:", hasCheckedLanguage);
  sendLanguageDetectionLog(`Current word count: ${currentWordCount}`);
  
  // Update word count for next check
  wordCount = currentWordCount;
  
  // Don't save if this session is marked as non-English (double check)
  if (isEnglish === false) {
    console.log("[Language Detection] Not saving transcript segment because session is marked as non-English");
    return;
  }
  
  const segment = {
    sessionId: sessionId,
    meetingCode: getMeetingCode(),
    timestamp: now.toISOString(),
    formattedTime: now.toLocaleTimeString(),
    text: lastTranscript,
    isComplete: false,
    isEnglish: isEnglish
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
    
    // Explicitly signal to save the transcript - but only if not already done
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
  
  // Skip if we've already reported the final transcript
  if (hasReportedFinalTranscript) {
    console.log('Final transcript already reported, skipping duplicate save');
    return;
  }
  
  // If language hasn't been checked yet, force a check now before proceeding
  if (!hasCheckedLanguage && lastTranscript.length > 0) {
    console.log("[Language Detection] Meeting ended without language check in saveTranscriptOnMeetingEnd - performing check now");
    sendLanguageDetectionLog("Meeting ended - performing language check now");
    
    // Get text for language detection
    const textToCheck = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
    
    // Mark as checked to prevent loops
    hasCheckedLanguage = true;
    
    // Perform synchronous check to block further processing
    checkLanguageIsEnglish(textToCheck).then(result => {
      // After language check completes, proceed with the function
      saveTranscriptOnMeetingEnd();
    });
    
    // Return early to wait for the language check to complete
    return;
  }
  
  // If this session is not English, delete all data about it
  if (isEnglish === false) {
    console.log("[Language Detection] Meeting ended with non-English session - deleting all session data");
    
    // Delete the current transcript
    lastTranscript = '';
    
    // Mark as reported to prevent automatic save
    hasReportedFinalTranscript = true;
    
    // Delete any stored segment for this session
    chrome.storage.local.remove([`transcript_segment_${sessionId}`], () => {
      console.log(`Deleted transcript segment for non-English session ${sessionId}`);
    });
    
    // Notify that session data was deleted
    chrome.runtime.sendMessage({
      type: 'debug',
      text: 'Meeting ended: Non-English session data deleted'
    });
    
    return;
  }
  
  // Use reportFinalTranscript to handle the English flag check and reporting
  reportFinalTranscript();
  
  // Mark the current segment as complete if it's an English session
  if (isEnglish === true) {
    const segment = {
      sessionId: sessionId,
      meetingCode: getMeetingCode(),
      timestamp: new Date().toISOString(),
      formattedTime: new Date().toLocaleTimeString(),
      text: lastTranscript,
      isComplete: true,
      isEnglish: true
    };
    
    // Save the final state
    const data = {};
    data[`transcript_segment_${sessionId}`] = segment;
    data['latest_session_id'] = sessionId;
    data['latest_complete_session'] = sessionId;
    
    chrome.storage.local.set(data);
  }
}

// Initialize and auto-start on Google Meet
function initialize() {
  console.log("Initializing content script...");
  
  // Get current meeting code
  const meetingCode = getMeetingCode();
  
  // Check if this meeting is already marked as non-English
  chrome.storage.local.get([`non_english_meeting_${meetingCode}`], (result) => {
    const nonEnglishData = result[`non_english_meeting_${meetingCode}`];
    
    if (nonEnglishData) {
      console.log(`Found non-English data for meeting ${meetingCode}:`, nonEnglishData);
      
      // Check if the block has expired
      const expirationTime = new Date(nonEnglishData.expirationTime);
      const currentTime = new Date();
      
      if (currentTime > expirationTime) {
        // The block has expired
        console.log(`Non-English block for meeting ${meetingCode} has expired. Expired at: ${expirationTime.toLocaleTimeString()}, current time: ${currentTime.toLocaleTimeString()}`);
        
        // Reset the flag
        isCurrentCallEnglish = true;
        
        // Remove the expired record
        chrome.storage.local.remove([`non_english_meeting_${meetingCode}`], () => {
          console.log(`Removed expired non-English flag for meeting ${meetingCode}`);
        });
        
        // Start detection normally
        startMeetingDetection();
      } else {
        // The block is still active
        console.log(`Meeting ${meetingCode} is still blocked as non-English until ${expirationTime.toLocaleTimeString()}`);
        isCurrentCallEnglish = false;
        
        const minutesRemaining = Math.round((expirationTime - currentTime) / (60 * 1000));
        
        chrome.runtime.sendMessage({
          type: 'debug',
          text: `This meeting was previously detected as non-English. Recording is disabled for ${minutesRemaining} more minutes (until ${expirationTime.toLocaleTimeString()}).`
        });
      }
    } else {
      console.log(`Meeting ${meetingCode} not found in non-English list, proceeding normally`);
      // Start detection for meeting participation
      startMeetingDetection();
    }
  });
}

// New function to explicitly check meeting status and start recording if needed
function checkAndStartRecording() {
  if (!isGoogleMeetPage()) {
    console.log("Not a Google Meet page, won't start recording");
    return false;
  }
  
  // Update the meeting code and check if it's a new meeting
  getMeetingCode();
  
  // Check if the current call is marked as non-English
  if (!isCurrentCallEnglish) {
    console.log("Won't auto-start recording: this call was detected as non-English");
    chrome.runtime.sendMessage({
      type: 'debug',
      text: 'Auto-recording disabled: this call was detected as non-English'
    });
    return false;
  }
  
  if (!isParticipatingInMeeting()) {
    console.log("Not actively participating in meeting, won't start recording");
    return false;
  }
  
  if (isRecording) {
    console.log("Already recording, won't start again");
    return false;
  }
  
  console.log("Meeting participation detected - Starting recording automatically");
  autoStarted = true;
  
  // Send notification that recording is starting automatically
  chrome.runtime.sendMessage({
    type: 'debug',
    text: 'Meeting detected - Recording started automatically'
  });
  
  // Start recording
  startRecording();
  
  // Note: startMeetingEndDetection will be called after language detection
  
  return true;
}

// Start continuous meeting detection
function startMeetingDetection() {
  // Clear any existing meeting detection interval
  if (meetingDetectionInterval) {
    clearInterval(meetingDetectionInterval);
    meetingDetectionInterval = null;
  }
  
  // Initial check
  const initialMeetingCode = getMeetingCode();
  console.log(`Starting meeting detection for meeting: ${initialMeetingCode}`);
  
  // Immediately check if we're in a meeting and should start recording
  if (isGoogleMeetPage() && isParticipatingInMeeting() && !isRecording && isCurrentCallEnglish) {
    checkAndStartRecording();
  }
  
  // Set up interval to check for meeting participation
  console.log("Setting up meeting detection interval...");
  meetingDetectionInterval = setInterval(() => {
    const meetingCode = getMeetingCode(); // This updates currentMeetingCode and may reset isCurrentCallEnglish
    
    if (!isGoogleMeetPage()) {
      console.log("Not on a Google Meet page, skipping detection");
      return;
    }
    
    // Skip detection if this call is marked as non-English
    if (!isCurrentCallEnglish) {
      console.log(`Meeting ${meetingCode} is marked as non-English, skipping detection`);
      return;
    }
    
    if (isParticipatingInMeeting() && !isRecording) {
      console.log("Meeting participation detected!");
      checkAndStartRecording();
    }
  }, 5000); // Check every 5 seconds
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
      
      // Explicitly save transcript - but only if not already done
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
      // Note: startMeetingEndDetection will be called after language detection
    }
    
    // If meeting ended while recording, stop recording and save transcript
    if (!isActive && isRecording) {
      console.log("Meeting end detected via DOM change!");
      stopRecording();
      
      // Explicitly save transcript - but only if not already done
      if (lastTranscript && !hasReportedFinalTranscript) {
        // If language hasn't been checked yet, force a check now before proceeding
        if (!hasCheckedLanguage && lastTranscript.length > 0) {
          console.log("[Language Detection] Meeting ended via DOM change without language check - performing check now");
          sendLanguageDetectionLog("Meeting ended via DOM change - performing language check now");
          
          // Get text for language detection
          const textToCheck = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
          
          // Mark as checked to prevent loops
          hasCheckedLanguage = true;
          
          // Perform synchronous check to block further processing
          checkLanguageIsEnglish(textToCheck).then(() => {
            // After language check completes, continue with the normal flow
            // The isEnglish flag will be set by the checkLanguageIsEnglish function
            
            // If this session is not English, delete all data about it
            if (isEnglish === false) {
              console.log("[Language Detection] Meeting ended via DOM change with non-English session - deleting all session data");
              
              // Delete the current transcript
              lastTranscript = '';
              
              // Mark as reported to prevent automatic save
              hasReportedFinalTranscript = true;
              
              // Delete any stored segment for this session
              chrome.storage.local.remove([`transcript_segment_${sessionId}`], () => {
                console.log(`Deleted transcript segment for non-English session ${sessionId}`);
              });
              
              // Notify that session data was deleted
              chrome.runtime.sendMessage({
                type: 'debug',
                text: 'Meeting ended (DOM change): Non-English session data deleted'
              });
            } else {
              // Only save if it's an English session or language not yet determined
              saveTranscriptOnMeetingEnd();
            }
          });
          
          return; // Return early to wait for language check
        }
        
        // If this session is not English, delete all data about it
        if (isEnglish === false) {
          console.log("[Language Detection] Meeting ended via DOM change with non-English session - deleting all session data");
          
          // Delete the current transcript
          lastTranscript = '';
          
          // Mark as reported to prevent automatic save
          hasReportedFinalTranscript = true;
          
          // Delete any stored segment for this session
          chrome.storage.local.remove([`transcript_segment_${sessionId}`], () => {
            console.log(`Deleted transcript segment for non-English session ${sessionId}`);
          });
          
          // Notify that session data was deleted
          chrome.runtime.sendMessage({
            type: 'debug',
            text: 'Meeting ended (DOM change): Non-English session data deleted'
          });
        } else {
          // Only save if it's an English session or language not yet determined
          saveTranscriptOnMeetingEnd();
        }
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
      // Note: startMeetingEndDetection will be called after language detection
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
    } catch (e) {
      // Ignore errors when stopping already stopped recognition
    }
    recognition = null;
  }
  
  // Also clean up the audio stream if it exists
  if (window.recognitionStream) {
    try {
      window.recognitionStream.getAudioTracks().forEach(track => track.stop());
      window.recognitionStream = null;
    } catch (e) {
      console.warn("Error cleaning up audio stream:", e);
    }
  }
  
  // Clean up audio context and VAD processor
  if (window.vadProcessor) {
    try {
      window.vadProcessor.disconnect();
      window.vadProcessor = null;
    } catch (e) {
      console.warn("Error cleaning up VAD processor:", e);
    }
  }
  
  if (window.vadAudioContext) {
    try {
      window.vadAudioContext.close();
      window.vadAudioContext = null;
    } catch (e) {
      console.warn("Error closing audio context:", e);
    }
  }
  
  isRecording = false;
  updateRecordingStatus();
}

function startRecording() {
  try {
    // Check if meeting is active first
    if (!isMeetingActive()) {
      throw new Error('Cannot start recording: the meeting has ended');
    }
    
    // Get current meeting code
    getMeetingCode(); // This will update currentMeetingCode and isCurrentCallEnglish if needed
    
    // Check if the current call is marked as non-English
    if (!isCurrentCallEnglish) {
      console.log("Cannot start recording: this call was detected as non-English");
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Cannot start recording: this call was detected as non-English'
      });
      return;
    }
    
    console.log("Starting recording...");
    // First, clean up any existing recognition instance
    cleanupRecognition();
    
    // Reset flags and initialize
    hasReportedFinalTranscript = false;
    lastTranscript = '';
    lastSavedLength = 0;
    
    // Reset language detection flag
    hasCheckedLanguage = false;
    wordCount = 0;
    
    // Reset the English flag for the new session - set to null (not yet determined)
    isEnglish = null;
    
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
    
    // Add custom property to track speech start time
    recognition.speechStartTime = null;
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    // Set up enhanced audio processing to better transcribe all speakers on the call
    setupEnhancedAudioProcessing().then(() => {
      recognition.onstart = () => {
        console.log("Recognition started successfully");
        isRecording = true;
        retryCount = 0; // Reset retry count on successful start
        updateRecordingStatus();
        chrome.runtime.sendMessage({
          type: 'debug',
          text: 'Recording started'
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

        // Process final transcript
        if (finalTranscript) {
          const now = new Date();
          const endTimeSinceStart = ((now - startTime) / 1000).toFixed(1);
          
          // Use the recorded speech start time if available, otherwise estimate it
          let startTimeSinceStart;
          if (recognition.speechStartTime) {
            startTimeSinceStart = ((recognition.speechStartTime - startTime) / 1000).toFixed(1);
          } else {
            // Fallback: estimate based on transcript length
            const approximateDurationInSeconds = finalTranscript.length / 5;
            startTimeSinceStart = Math.max(0, (endTimeSinceStart - approximateDurationInSeconds).toFixed(1));
          }
          
          // Format with start and end timecodes - using same format as main handler
          const formattedTranscript = `[S:${startTimeSinceStart}s] ${finalTranscript} [E:${endTimeSinceStart}s]`;
          
          lastTranscript = lastTranscript + ' ' + formattedTranscript;
          chrome.runtime.sendMessage({
            type: 'transcriptUpdate',
            sessionId: sessionId,
            text: lastTranscript,
            isFinal: true
          });
          
          // Reset speech start time for the next segment
          recognition.speechStartTime = null;
          
          // Save on significant transcript updates
          saveTranscriptSegment();
          
          // Check if we have enough words for language detection and haven't checked yet
          const currentWordCount = countWordsInTranscript(lastTranscript);
          console.log(`[Language Detection] Current word count: ${currentWordCount}, threshold: ${LANGUAGE_DETECTION_WORD_THRESHOLD}, hasCheckedLanguage: ${hasCheckedLanguage}`);
          
          if (currentWordCount >= LANGUAGE_DETECTION_WORD_THRESHOLD && !hasCheckedLanguage) {
            console.log(`[Language Detection] Word threshold reached (${LANGUAGE_DETECTION_WORD_THRESHOLD} words). Proceeding with language check...`);
            sendLanguageDetectionLog(`Word threshold reached (${LANGUAGE_DETECTION_WORD_THRESHOLD} words)`);
            
            hasCheckedLanguage = true;
            
            // Get last N words for language detection
            const lastWords = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
            console.log(`[Language Detection] Extracted last ${LANGUAGE_DETECTION_SAMPLE_SIZE} words:`, lastWords);
            sendLanguageDetectionLog(`Analyzing last ${LANGUAGE_DETECTION_SAMPLE_SIZE} words...`);
            
            // Check if language is English
            checkLanguageIsEnglish(lastWords).then(result => {
              if (result === "FAILED") {
                console.log("[Language Detection] Check failed. Unable to determine language.");
                // The error message is already logged in checkLanguageIsEnglish
                
                // Assume English on failure for backward compatibility
                isEnglish = true;
                
                // Start meeting end detection after language check
                startMeetingEndDetection();
              } else {
                console.log("[Language Detection] Check completed. Is English:", result);
                sendLanguageDetectionLog(`Check completed. Is English: ${result}`);
                
                // Set the English flag based on the result
                isEnglish = result;
                
                // If not English, stop recording and clean up
                if (!result) {
                  console.log("[Language Detection] Language is not English, stopping recording");
                  stopRecording();
                  
                  // Delete the transcript and prevent further saving
                  deleteTranscriptAndPreventSaving();
                  
                  // Send warning message to UI
                  chrome.runtime.sendMessage({
                    type: 'warning',
                    text: 'Recording stopped: Language is not English'
                  });
                } else {
                  // Start meeting end detection only if language is English
                  console.log("[Language Detection] Language is English, starting meeting end detection");
                  startMeetingEndDetection();
                }
              }
            }).catch(error => {
              console.error("[Language Detection] Error in language check:", error);
              // Don't duplicate logs - errors are already handled in checkLanguageIsEnglish
              
              // Assume English on error for backward compatibility
              isEnglish = true;
              
              // Start meeting end detection after language check attempt
              startMeetingEndDetection();
            });
          }
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
        // Record speech start time
        if (!recognition.speechStartTime) {
          recognition.speechStartTime = new Date();
        }
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
              type: 'meetingEnded',
              sessionId: sessionId,
              text: lastTranscript.trim(),
              isEnglish: isEnglish === true ? true : false
            });
          }
        }
      };

      // Start recognition after all event handlers are set up
      try {
        recognition.start();
        console.log("Recognition started");
      } catch (e) {
        console.error('Error starting recognition:', e);
        chrome.runtime.sendMessage({
          type: 'error',
          error: 'Failed to start speech recognition: ' + e.message
        });
        
        // Try standard recognition as fallback
        startStandardRecognition();
      }
    }).catch(error => {
      console.error('Error during enhanced audio setup:', error);
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Falling back to standard recognition: ' + error.message
      });
      
      // Try standard recognition as fallback
      startStandardRecognition();
    });

  } catch (e) {
    console.error('Error in startRecording:', e);
    chrome.runtime.sendMessage({
      type: 'error',
      error: 'Failed to start recording: ' + e.message
    });
  }
}

function stopRecording() {
  console.log("Stopping recording...");
  
  // Clean up recognition
  cleanupRecognition();
  
  // Reset recording state
  isRecording = false;
  
  // Stop auto-save
  stopAutoSave();
  
  // Report the final transcript only if not already reported
  if (lastTranscript && !hasReportedFinalTranscript) {
    // Use our new reportFinalTranscript function
    reportFinalTranscript();
  }
  
  updateRecordingStatus();
  
  // Notify popup
  chrome.runtime.sendMessage({
    type: 'debug',
    text: 'Recording stopped'
  });
}

function updateRecordingStatus() {
  chrome.runtime.sendMessage({
    type: 'recordingStatus',
    isRecording: isRecording,
    isEnglish: isEnglish
  });
  
  // Visual indicator removed as requested
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
    
    // If language hasn't been checked yet, force a check now before proceeding
    if (!hasCheckedLanguage && lastTranscript.length > 0) {
      console.log("[Language Detection] Window closing without language check - performing check now");
      
      // Get text for language detection
      const textToCheck = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
      
      // Mark as checked to prevent loops
      hasCheckedLanguage = true;
      
      // Perform a synchronous language check (this is a special case for beforeunload)
      try {
        // This is a synchronous request which is normally bad practice,
        // but we need it for the beforeunload event
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://fluently-extension-backend-c1f2cc68e5b2.herokuapp.com/detect_language', false); // false makes it synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ text: textToCheck }));
        
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          const isDetectedEnglish = response.confidence >= LANGUAGE_DETECTION_CONFIDENCE_THRESHOLD;
          
          // Set the flag based on the result
          isEnglish = isDetectedEnglish;
          
          console.log("[Language Detection] Window closing language check result:", isEnglish);
        }
      } catch (e) {
        console.error("[Language Detection] Error in synchronous language check:", e);
        // Don't change the isEnglish flag in case of error
      }
    }
    
    // If this session is not English, delete all data about it
    if (isEnglish === false) {
      console.log("[Language Detection] Window closing with non-English session - deleting all session data");
      
      // Delete the current transcript
      lastTranscript = '';
      
      // Delete any stored segment for this session
      chrome.storage.local.remove([`transcript_segment_${sessionId}`], () => {
        console.log(`Deleted transcript segment for non-English session ${sessionId}`);
      });
      
      // Don't save anything for non-English sessions
      hasReportedFinalTranscript = true;
    } else {
      // Only save if it's an English session or language not yet determined
      saveTranscriptOnMeetingEnd();
    }
  }
  
  stopRecording();
});

// Also listen for page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isRecording) {
    console.log("Page hidden while recording");
    // No action needed here - we'll handle meeting tab closure in the beforeunload event
  }
});

// Set up handler for when the tab/window is being closed
window.addEventListener('beforeunload', () => {
  // This will only trigger if the tab/window is actually closing, not just switching tabs
  if (isRecording && lastTranscript && !hasReportedFinalTranscript) {
    console.log("Meeting tab being closed while recording, saving transcript");
    
    // Set flag for pending post-meeting page
    const pendingPostMeetingPage = true;
    
    // Store this information in local storage
    chrome.storage.local.set({
      'pendingPostMeetingPage': pendingPostMeetingPage,
      'pendingSessionId': sessionId
    });
    
    // Save meeting data
    saveTranscriptOnMeetingEnd();
  }
});

// Add this function above the startRecording function
async function setupEnhancedAudioProcessing() {
  try {
    // Create enhanced audio constraints with strong echo cancellation and optimizations
    // for capturing other speakers on calls
    const audioConstraints = {
      // Core audio processing features
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      
      // Additional advanced configurations for better speaker isolation
      advanced: [{
        // Echo cancellation is the most important setting for hearing other speakers
        echoCancellation: true,
        
        // Noise suppression helps filter background noise from speech
        noiseSuppression: true,
        
        // Auto gain control helps with varying volume levels
        autoGainControl: true,
        
        // Try to minimize latency for real-time transcription
        latency: 0,
        
        // Higher sample rate for better clarity
        sampleRate: 48000,
        
        // Attempt to use dual-channel mode if available
        // This can help with spatial separation of speakers
        channelCount: 2,
        
        // Some browsers allow setting mic gain programmatically
        volume: 1.0,
        
        // Specify audio processing to optimize for voice
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
        googAudioMirroring: false
      }]
    };

    // Get access to the user's microphone with enhanced settings
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
    
    // Log detailed information about the audio configuration
    logAudioStreamInfo(stream);
    
    // Create an audio context for potential VAD processing
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    
    // Create a processor node for Voice Activity Detection using AudioWorkletNode
    try {
      // Load and register the worklet processor
      await audioContext.audioWorklet.addModule(chrome.runtime.getURL('vad-processor.js'));
      
      // Create the AudioWorkletNode
      const vadNode = new AudioWorkletNode(audioContext, 'vad-processor');
      
      // Set up the message handler to receive voice activity detection results
      vadNode.port.onmessage = (event) => {
        const { hasVoice } = event.data;
        
        // If speech recognition is active, use this information
        if (recognition && hasVoice && !recognition.speechStartTime) {
          console.log("VAD: Voice activity detected");
          recognition.speechStartTime = new Date();
        }
      };
      
      // Connect the nodes
      source.connect(vadNode);
      
      // Store for cleanup
      window.vadProcessor = vadNode;
      window.vadAudioContext = audioContext;
    } catch (error) {
      console.warn("AudioWorklet not supported, VAD disabled:", error);
    }
    
    // Try to apply the enhanced audio configuration directly to the SpeechRecognition object
    // This is browser-dependent but helps when available
    if (recognition) {
      // Method 1: Direct media stream assignment (supported in some browsers)
      if (typeof recognition.mediaStream !== 'undefined') {
        recognition.mediaStream = stream;
        console.log("Applied mediaStream directly to recognition object");
      }
      
      // Method 2: Apply audio constraints if supported
      if (typeof recognition.audioConfig !== 'undefined') {
        recognition.audioConfig = audioConstraints;
        console.log("Applied audio constraints directly to recognition.audioConfig");
      }
      
      // Method 3: Try to set properties directly on the recognition object
      try {
        // These are non-standard but might be implemented in some browsers
        if (typeof recognition.acoustic !== 'undefined') {
          recognition.acoustic = {
            echoCancellation: true,
            enhancedVoiceDetection: true,
            voiceIsolation: true
          };
          console.log("Applied acoustic optimizations");
        }
        
        // Set some browsers might support a direct audio processing flag
        if (window.SpeechRecognition && recognition instanceof window.SpeechRecognition) {
          recognition.enhancedAudio = true;
          console.log("Set enhancedAudio flag on recognition object");
        }
      } catch (e) {
        // Ignore any errors from these experimental approaches
        console.log("Couldn't set enhanced audio flags:", e);
      }
    }
    
    // Store the stream for cleanup later
    window.recognitionStream = stream;
    
    return true;
  } catch (error) {
    console.warn("Could not apply enhanced audio settings:", error);
    // Continue without the enhanced settings
    return false;
  }
}

// Function to log detailed information about the audio stream configuration
function logAudioStreamInfo(stream) {
  try {
    console.log("--- Enhanced Audio Configuration Details ---");
    
    // Get the audio tracks from the stream
    const audioTracks = stream.getAudioTracks();
    console.log(`Number of audio tracks: ${audioTracks.length}`);
    
    // Summary for user notification
    let userMessage = '';
    let echoCancellationEnabled = false;
    
    // Log details for each track
    audioTracks.forEach((track, index) => {
      console.log(`Audio Track ${index + 1}:`);
      console.log(`- Label: ${track.label}`);
      console.log(`- Enabled: ${track.enabled}`);
      console.log(`- Muted: ${track.muted}`);
      console.log(`- ReadyState: ${track.readyState}`);
      
      // Get the constraints that were applied
      const settings = track.getSettings();
      console.log("Applied Settings:");
      console.log(`- Echo Cancellation: ${settings.echoCancellation}`);
      console.log(`- Noise Suppression: ${settings.noiseSuppression}`);
      console.log(`- Auto Gain Control: ${settings.autoGainControl}`);
      
      // Track settings for user notification
      if (settings.echoCancellation) {
        echoCancellationEnabled = true;
      }
      
      // Additional settings if available
      if (settings.latency) console.log(`- Latency: ${settings.latency}ms`);
      if (settings.sampleRate) console.log(`- Sample Rate: ${settings.sampleRate}Hz`);
      if (settings.sampleSize) console.log(`- Sample Size: ${settings.sampleSize}bits`);
      if (settings.channelCount) console.log(`- Channel Count: ${settings.channelCount}`);
      
      // Check for constraints that were requested but couldn't be applied
      const constraints = track.getConstraints();
      if (constraints && constraints.advanced) {
        console.log("Requested constraints:", constraints);
      }
    });
    
    console.log("---------------------------------------");
    
    // Create user-friendly message
    if (echoCancellationEnabled) {
      userMessage = 'Enhanced audio with echo cancellation enabled - should better pick up other speakers';
    } else {
      userMessage = 'Basic audio configuration - echo cancellation status unknown';
    }
    
    // Send user-friendly message to the extension's debug log
    chrome.runtime.sendMessage({
      type: 'debug',
      text: userMessage
    });
    
    // Also log to console
    console.log(userMessage);
    
    return echoCancellationEnabled;
  } catch (e) {
    console.warn("Error logging audio stream info:", e);
    
    // Send fallback message in case of error
    chrome.runtime.sendMessage({
      type: 'debug',
      text: 'Audio configured with requested echo cancellation (status unknown)'
    });
    
    return false;
  }
}

// Add this helper function to fall back to standard recognition if enhanced setup fails
function startStandardRecognition() {
  try {
    // Add custom property to track speech start time
    recognition.speechStartTime = null;
    
    // Set up standard event handlers
    recognition.onstart = () => {
      console.log("Standard recognition started successfully");
      isRecording = true;
      retryCount = 0;
      updateRecordingStatus();
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Standard recording started'
      });
    };
    
    // Add sound start/end handlers to track speech timing
    recognition.onsoundstart = () => {
      console.log("Sound detected in standard recognition");
      // Record speech start time
      if (!recognition.speechStartTime) {
        recognition.speechStartTime = new Date();
      }
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Sound detected'
      });
    };

    recognition.onsoundend = () => {
      console.log("Sound ended in standard recognition");
      chrome.runtime.sendMessage({
        type: 'debug',
        text: 'Sound ended'
      });
    };

    recognition.onresult = (event) => {
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

      // Process final transcript
      if (finalTranscript) {
        const now = new Date();
        const endTimeSinceStart = ((now - startTime) / 1000).toFixed(1);
        
        // Use the recorded speech start time if available, otherwise estimate it
        let startTimeSinceStart;
        if (recognition.speechStartTime) {
          startTimeSinceStart = ((recognition.speechStartTime - startTime) / 1000).toFixed(1);
        } else {
          // Fallback: estimate based on transcript length
          const approximateDurationInSeconds = finalTranscript.length / 5;
          startTimeSinceStart = Math.max(0, (endTimeSinceStart - approximateDurationInSeconds).toFixed(1));
        }
        
        // Format with start and end timecodes - using same format as main handler
        const formattedTranscript = `[S:${startTimeSinceStart}s] ${finalTranscript} [E:${endTimeSinceStart}s]`;
        
        lastTranscript = lastTranscript + ' ' + formattedTranscript;
        chrome.runtime.sendMessage({
          type: 'transcriptUpdate',
          sessionId: sessionId,
          text: lastTranscript,
          isFinal: true
        });
        
        // Reset speech start time for the next segment
        recognition.speechStartTime = null;
        
        // Save on significant transcript updates
        saveTranscriptSegment();
        
        // Check if we have enough words for language detection and haven't checked yet
        const currentWordCount = countWordsInTranscript(lastTranscript);
        console.log(`[Language Detection] Current word count: ${currentWordCount}, threshold: ${LANGUAGE_DETECTION_WORD_THRESHOLD}, hasCheckedLanguage: ${hasCheckedLanguage}`);
        
        if (currentWordCount >= LANGUAGE_DETECTION_WORD_THRESHOLD && !hasCheckedLanguage) {
          console.log(`[Language Detection] Word threshold reached (${LANGUAGE_DETECTION_WORD_THRESHOLD} words). Proceeding with language check...`);
          sendLanguageDetectionLog(`Word threshold reached (${LANGUAGE_DETECTION_WORD_THRESHOLD} words)`);
          
          hasCheckedLanguage = true;
          
          // Get last N words for language detection
          const lastWords = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
          console.log(`[Language Detection] Extracted last ${LANGUAGE_DETECTION_SAMPLE_SIZE} words:`, lastWords);
          sendLanguageDetectionLog(`Analyzing last ${LANGUAGE_DETECTION_SAMPLE_SIZE} words...`);
          
          // Check if language is English
          checkLanguageIsEnglish(lastWords).then(result => {
            if (result === "FAILED") {
              console.log("[Language Detection] Check failed. Unable to determine language.");
              // The error message is already logged in checkLanguageIsEnglish
              
              // Assume English on failure for backward compatibility
              isEnglish = true;
              
              // Start meeting end detection after language check
              startMeetingEndDetection();
            } else {
              console.log("[Language Detection] Check completed. Is English:", result);
              sendLanguageDetectionLog(`Check completed. Is English: ${result}`);
              
              // Set the English flag based on the result
              isEnglish = result;
              
              // If not English, stop recording and clean up
              if (!result) {
                console.log("[Language Detection] Language is not English, stopping recording");
                stopRecording();
                
                // Delete the transcript and prevent further saving
                deleteTranscriptAndPreventSaving();
                
                // Send warning message to UI
                chrome.runtime.sendMessage({
                  type: 'warning',
                  text: 'Recording stopped: Language is not English'
                });
              } else {
                // Start meeting end detection only if language is English
                console.log("[Language Detection] Language is English, starting meeting end detection");
                startMeetingEndDetection();
              }
            }
          }).catch(error => {
            console.error("[Language Detection] Error in language check:", error);
            // Don't duplicate logs - errors are already handled in checkLanguageIsEnglish
            
            // Assume English on error for backward compatibility
            isEnglish = true;
            
            // Start meeting end detection after language check attempt
            startMeetingEndDetection();
          });
        }
      } else if (interimTranscript) {
        chrome.runtime.sendMessage({
          type: 'transcriptUpdate',
          sessionId: sessionId,
          text: interimTranscript,
          isFinal: false
        });
      }
    };
    
    // Start recognition directly without enhanced audio
    recognition.start();
    console.log("Standard recognition started");
  } catch (error) {
    console.error('Error starting standard recognition:', error);
    chrome.runtime.sendMessage({
      type: 'error',
      error: error.message
    });
  }
}

// Function to stop recording and clear the transcript when non-English is detected
function stopRecordingAndClearTranscript() {
  // Use the new function to handle deletion and prevention of saving
  deleteTranscriptAndPreventSaving();
}

// Function to delete transcript and prevent saving when non-English is detected
function deleteTranscriptAndPreventSaving() {
  console.log("[Language Detection] Deleting transcript and preventing saving for non-English session");
  sendLanguageDetectionLog("Non-English detected! Deleting transcript and preventing saving");
  
  // Delete the current transcript
  lastTranscript = '';
  
  // Mark as non-English
  isEnglish = false;
  
  // Mark as reported to prevent automatic save
  hasReportedFinalTranscript = true;
  
  // Delete any stored segment for this session
  chrome.storage.local.remove([`transcript_segment_${sessionId}`], () => {
    console.log(`Deleted transcript segment for non-English session ${sessionId}`);
  });
  
  // Store this meeting code as non-English for future reference
  const meetingCode = getMeetingCode();
  if (meetingCode && meetingCode !== 'unknown-meeting') {
    // Set expiration time (1 hour from now)
    const expirationTime = new Date(Date.now() + NON_ENGLISH_BLOCK_EXPIRATION_MS);
    
    const nonEnglishData = {
      meetingCode: meetingCode,
      timestamp: new Date().toISOString(),
      expirationTime: expirationTime.toISOString()
    };
    
    // Save to storage
    const data = {};
    data[`non_english_meeting_${meetingCode}`] = nonEnglishData;
    chrome.storage.local.set(data, () => {
      console.log(`Marked meeting ${meetingCode} as non-English until ${expirationTime.toLocaleTimeString()}`);
    });
    
    // Update current call flag
    isCurrentCallEnglish = false;
    
    // Notify popup
    chrome.runtime.sendMessage({
      type: 'debug',
      text: `Recording stopped and transcript deleted because non-English language was detected. Recording will be blocked for this meeting URL for 1 hour (until ${expirationTime.toLocaleTimeString()}).`
    });
    
    // Also send a specific message type for non-English detection
    chrome.runtime.sendMessage({
      type: 'nonEnglishDetected',
      sessionId: sessionId,
      meetingCode: meetingCode,
      expirationTime: expirationTime.toISOString()
    });
  }
}

// Function to report the final transcript
function reportFinalTranscript() {
  if (!lastTranscript || hasReportedFinalTranscript) return;
  
  // If language hasn't been checked yet, force a check now before proceeding
  if (!hasCheckedLanguage && lastTranscript.length > 0) {
    console.log("[Language Detection] Meeting ended without language check - performing check now");
    sendLanguageDetectionLog("Meeting ended - performing language check now");
    
    // Get text for language detection
    const textToCheck = getLastNWords(lastTranscript, LANGUAGE_DETECTION_SAMPLE_SIZE);
    
    // Mark as checked to prevent loops
    hasCheckedLanguage = true;
    
    // Perform synchronous check to block further processing until we know the language
    return checkLanguageIsEnglish(textToCheck).then(result => {
      if (result === false) {
        // Language is not English, don't proceed with saving
        console.log("[Language Detection] Final check determined language is not English - deleting transcript");
        return;
      } else {
        // Language is English or check failed (we'll assume English in that case)
        // Continue with normal processing
        return reportFinalTranscript();
      }
    });
  }
  
  // Skip if this session is marked as non-English
  if (isEnglish === false) {
    console.log("[Language Detection] Not reporting final transcript because session is marked as non-English");
    return;
  }
  
  console.log('Reporting final transcript:', lastTranscript);
  
  // Mark as reported to prevent duplicate calls
  hasReportedFinalTranscript = true;
  
  // Send the transcript to background.js
  chrome.runtime.sendMessage({
    type: 'meetingEnded',
    sessionId: sessionId,
    text: lastTranscript.trim(),
    isEnglish: isEnglish === true ? true : false
  });
}

