console.log("Background script loaded");

let currentTranscript = '';
let isRecordingStopped = false;
let pendingInjections = {};
let currentSessionId = null;
let sessionIdProcessed = null;
let sessionSpecificFlags = {};

function sendDebugMessage(message) {
  console.log("DEBUG:", message);
  chrome.runtime.sendMessage({
    type: 'debug',
    text: message
  });
}

// Function to check if a URL is a Google Meet meeting URL
function isGoogleMeetMeetingUrl(url) {
  if (!url) return false;
  const meetingRegex = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
  return meetingRegex.test(url);
}

// Inject content script into the tab if it's a Meet meeting
function injectContentScriptIfNeeded(tabId, url) {
  if (!isGoogleMeetMeetingUrl(url)) return;
  
  // Don't inject if we have a pending injection for this tab
  if (pendingInjections[tabId]) return;
  
  console.log(`Injecting content script into tab ${tabId}`);
  pendingInjections[tabId] = true;
  
  // Execute the content script
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  })
  .then(() => {
    console.log(`Content script successfully injected into tab ${tabId}`);
    delete pendingInjections[tabId];
    
    // Manually trigger initialization after a delay
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'forceInitialize' })
        .catch(err => console.log("Couldn't send forceInitialize:", err));
    }, 1000);
  })
  .catch(error => {
    console.error(`Error injecting content script into tab ${tabId}:`, error);
    delete pendingInjections[tabId];
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background:", message);
  
  if (message.sessionId) {
    currentSessionId = message.sessionId;
  }
  
  // Forward all language detection related messages to popup
  if (message.type === 'warning' && message.text === 'Language is not English') {
    console.log("Forwarding language detection warning:", message);
    chrome.runtime.sendMessage(message);
  } else if (message.type === 'debug' && message.text && message.text.includes('[Language Detection]')) {
    console.log("Forwarding language detection log:", message);
    chrome.runtime.sendMessage(message);
  } else if (message.type === 'nonEnglishDetected') {
    console.log("Non-English language detected, transcript deleted:", message);
    // Forward this message to popup
    chrome.runtime.sendMessage(message);
    // Clear any pending transcript operations
    sessionIdProcessed = message.sessionId;
  }
  
  if (message.type === 'finalTranscript') {
    // Check if the session is marked as non-English
    if (message.isEnglish === false) {
      console.log("Not saving transcript because session is marked as non-English");
      return;
    }
    
    currentTranscript = message.text;
    sendDebugMessage('Received transcript update');
    
    // Only save when recording is explicitly stopped
    if (isRecordingStopped) {
      saveTranscriptToStorage(currentTranscript, sender, message.sessionId, message.meetingCode, message.isEnglish);
      isRecordingStopped = false; // Reset flag after saving
    }
  } else if (message.type === 'meetingEnded') {
    // Check if the session is marked as non-English
    if (message.isEnglish === false) {
      console.log("Not saving transcript because session is marked as non-English");
      return;
    }
    
    // This is a dedicated message for when a meeting ends, save immediately
    // Check if we've already processed this session to avoid duplicates
    if (sessionIdProcessed === message.sessionId) {
      console.log("Duplicate meetingEnded message received for session", message.sessionId, "- ignoring");
      return;
    }
    
    console.log("Meeting ended message received, saving transcript immediately");
    currentTranscript = message.text;
    saveTranscriptToStorage(currentTranscript, sender, message.sessionId, message.meetingCode, message.isEnglish);
  } else if (message.type === 'error') {
    sendDebugMessage('Error: ' + message.error);
  } else if (message.type === 'recordingStatus') {
    // If recording was turned off, save the transcript
    if (message.isRecording === false && currentTranscript) {
      // Check if the session is marked as non-English
      if (message.isEnglish === false) {
        console.log("Not saving transcript because session is marked as non-English");
        return;
      }
      
      isRecordingStopped = true;
      sendDebugMessage('Recording stopped, preparing to save transcript');
    }
  } else if (message.type === 'debug' && message.text.includes('Meeting ended') && currentTranscript) {
    // Auto-save transcript when meeting ends, but check for duplicates
    if (sessionIdProcessed === currentSessionId) {
      console.log("Ignoring duplicate meeting ended debug message for session", currentSessionId);
      return;
    }
    
    sendDebugMessage('Meeting ended detected via debug message, saving transcript');
    saveTranscriptToStorage(currentTranscript, sender, currentSessionId, message.meetingCode, message.isEnglish);
  } else if (message.type === 'openTranscriptsPage') {
    openTranscriptsPage();
  }
});

// Listen for tab updates to detect Google Meet pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // When the tab is done loading
  if (changeInfo.status === 'complete' && tab.url) {
    console.log("Tab updated:", tab.url);
    
    if (isGoogleMeetMeetingUrl(tab.url)) {
      console.log("Google Meet meeting detected in tab:", tabId);
      sendDebugMessage('Google Meet meeting detected in tab ' + tabId);
      
      // Inject content script or initialize if already injected
      injectContentScriptIfNeeded(tabId, tab.url);
    }
  }
  
  // Also check on URL changes (for SPAs)
  if (changeInfo.url && isGoogleMeetMeetingUrl(changeInfo.url)) {
    console.log("URL changed to Google Meet meeting in tab:", tabId);
    injectContentScriptIfNeeded(tabId, changeInfo.url);
  }
});

// Listen for tab close or navigation away from meeting
chrome.tabs.onRemoved.addListener((tabId) => {
  // Check for any in-progress session
  chrome.storage.local.get(['latest_session_id'], (result) => {
    if (result.latest_session_id) {
      // Try to load and save any unfinished transcript
      chrome.storage.local.get([`transcript_segment_${result.latest_session_id}`], (data) => {
        const segment = data[`transcript_segment_${result.latest_session_id}`];
        if (segment && !segment.isComplete) {
          console.log('Found unfinished transcript segment, saving as complete');
          saveUnfinishedSession(segment);
        }
      });
    }
  });
  
  // Clean up any pending injections
  delete pendingInjections[tabId];
});

// Function to handle saving unfinished transcripts when tab closes
function saveUnfinishedSession(segment) {
  if (!segment || !segment.text) return;
  
  // Skip if this session is marked as non-English
  if (segment.isEnglish === false) {
    console.log('Not saving unfinished transcript because session is marked as non-English');
    return;
  }
  
  // Mark as complete
  segment.isComplete = true;
  
  // Update the segment
  chrome.storage.local.set({
    [`transcript_segment_${segment.sessionId}`]: segment,
    'latest_complete_session': segment.sessionId
  }, () => {
    console.log('Unfinished transcript marked as complete');
    // Also create a permanent copy in the transcripts array
    saveTranscriptToStorage(segment.text, null, segment.sessionId, segment.meetingCode, segment.isEnglish);
  });
}

// Get meeting ID from current URL or sender info
function getMeetingIdFromUrl(sender) {
  // If we have sender info with a URL, use that
  if (sender && sender.url) {
    const url = sender.url;
    const meetRegex = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
    const match = url.match(meetRegex);
    if (match && match[1]) {
      return match[1]; // Return the meeting ID from the source tab
    }
  }
  
  // Otherwise, just use a timestamp as identifier
  return 'meet-' + new Date().toISOString().replace(/[:.-]/g, '');
}

// Function to fix timestamp overlaps by removing problematic pairs from transcript
function fixOverlappingTimestamps(text) {
  if (!text) return text;
  
  console.log("Fixing overlapping timestamps before saving transcript...");
  
  // First extract all timestamps with their positions
  const regex = /\[(E|S):(\d+\.\d+)s\]/g;
  const timestamps = [];
  let match;
  
  // Find all timestamps in order
  while ((match = regex.exec(text)) !== null) {
    timestamps.push({
      type: match[1], // "S" or "E"
      time: parseFloat(match[2]),
      position: match.index,
      length: match[0].length,
      fullMatch: match[0]
    });
  }
  
  console.log(`Found ${timestamps.length} timestamps`);
  
  // Look for E followed by S where S time < E time
  const overlaps = [];
  
  for (let i = 0; i < timestamps.length - 1; i++) {
    const current = timestamps[i];
    const next = timestamps[i+1];
    
    if (current.type === 'E' && next.type === 'S' && next.time < current.time) {
      console.log(`Found overlap: ${current.fullMatch} followed by ${next.fullMatch}`);
      overlaps.push({
        end: current,
        start: next
      });
    }
  }
  
  console.log(`Found ${overlaps.length} overlapping pairs to remove`);
  
  if (overlaps.length === 0) {
    return text;
  }
  
  // Sort overlaps by position in reverse order to not affect earlier positions when removing
  overlaps.sort((a, b) => b.end.position - a.end.position);
  
  // Create a new transcript with the problematic timestamps removed
  let cleanedText = text;
  
  // Remove each pair of overlapping timestamps
  for (const overlap of overlaps) {
    const endPos = overlap.end.position;
    const startPos = overlap.start.position;
    
    // Remove BOTH the end timestamp AND the start timestamp 
    // while preserving text between them
    cleanedText = cleanedText.substring(0, endPos) + 
                cleanedText.substring(endPos + overlap.end.length, startPos) +
                cleanedText.substring(startPos + overlap.start.length);
    
    console.log(`Removed overlapping timestamps: ${overlap.end.fullMatch} and ${overlap.start.fullMatch}`);
  }
  
  // Double-check for any remaining problematic patterns just to be sure
  // This is a safety check to catch cases where the first pass might have missed
  const checkRegex = /\[E:\d+\.\d+s\]\s*\[S:\d+\.\d+s\]/g;
  if (checkRegex.test(cleanedText)) {
    console.warn("Still found potential overlapping timestamps after cleaning, running second pass");
    
    // Just remove the pattern directly as a fallback
    cleanedText = cleanedText.replace(/\[E:\d+\.\d+s\]\s*\[S:\d+\.\d+s\]/g, ' ');
  }
  
  console.log("Original length:", text.length, "Cleaned length:", cleanedText.length);
  
  // Do a final check to make sure we didn't accidentally create incorrect timestamp pairs
  let startCount = (cleanedText.match(/\[S:\d+\.\d+s\]/g) || []).length;
  let endCount = (cleanedText.match(/\[E:\d+\.\d+s\]/g) || []).length;
  
  console.log(`Final timestamp counts - Start: ${startCount}, End: ${endCount}`);
  
  if (startCount !== endCount) {
    console.warn(`Mismatched timestamp counts after cleaning: ${startCount} starts, ${endCount} ends`);
  }
  
  return cleanedText;
}

function saveTranscriptToStorage(text, sender, sessionId, meetingCode, isEnglish) {
  // First, strictly check the isEnglish flag - if not explicitly true, don't save anything
  if (isEnglish !== true) {
    console.log('Not saving transcript because isEnglish flag is not explicitly true:', isEnglish);
    sendDebugMessage('Transcript not saved: not confirmed as English');
    return;
  }

  if (!text || text.trim() === '') {
    sendDebugMessage('No transcript to save');
    return;
  }
  
  // Prevent duplicate saving of the same transcript
  if (sessionId && sessionIdProcessed === sessionId) {
    console.log('This transcript has already been processed, skipping duplicate save');
    sendDebugMessage('Skipping duplicate transcript save');
    return;
  }
  
  // Mark this session as processed
  sessionIdProcessed = sessionId;
  
  try {
    // Clean up any overlapping timestamps before saving
    const cleanedText = fixOverlappingTimestamps(text);
    const wasFixed = cleanedText !== text;
    
    if (wasFixed) {
      console.log("Removed overlapping timestamps from transcript");
      sendDebugMessage('Fixed overlapping timestamps in transcript');
      text = cleanedText; // Use the cleaned version going forward
    }
    
    const timestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString();
    const meetId = meetingCode || getMeetingIdFromUrl(sender);
    
    // Create transcript object
    const transcriptEntry = {
      id: sessionId || Date.now().toString(),
      sessionId: sessionId || 'session-' + Date.now(),
      timestamp: timestamp,
      formattedDate: formattedDate,
      meetingId: meetId,
      text: text,
      timestampsFixed: wasFixed,
      isEnglish: isEnglish !== false // Default to true unless explicitly set to false
    };
    
    // Log what we're saving
    console.log('Saving transcript to storage:', transcriptEntry);
    console.log('Is English session:', transcriptEntry.isEnglish !== false);
    
    // Save to chrome.storage.local
    chrome.storage.local.get(['transcripts'], (result) => {
      const transcripts = result.transcripts || [];
      
      // Check if we might be saving a duplicate by comparing text (unlikely but possible)
      const isDuplicate = transcripts.some(t => 
        (t.sessionId === transcriptEntry.sessionId) || 
        (t.text === text && new Date(t.timestamp) > new Date(Date.now() - 1000 * 60))
      );
      
      if (isDuplicate) {
        console.log('Duplicate transcript detected, not saving again');
        sendDebugMessage('Duplicate transcript detected, not saving again');
        return;
      }
      
      transcripts.push(transcriptEntry);
      
      chrome.storage.local.set({ transcripts: transcripts }, () => {
        sendDebugMessage('Transcript saved to storage');
        
        // Calculate transcript stats in memory without creating temp tab
        try {
          if (typeof TranscriptStats !== 'undefined') {
            TranscriptStats.calculateTranscriptStats(transcriptEntry);
          } else {
            // We need to use a temporary tab for stats since importScripts doesn't work in service workers
            createTemporaryTabForStats(transcriptEntry);
          }
        } catch (statsError) {
          console.error('Error calculating stats in background:', statsError);
          // Fallback to the temp tab method
          createTemporaryTabForStats(transcriptEntry);
        }
        
        // Check if we've already opened a post-meeting page for this specific session
        const hasOpenedPageForThisSession = sessionSpecificFlags[transcriptEntry.sessionId || transcriptEntry.id];
        
        // Notify user that the transcript is ready to view, but only if we haven't
        // already opened a transcript page for this specific session and the session is in English
        if (!hasOpenedPageForThisSession && transcriptEntry.isEnglish === true) {
          console.log("Opening post-meeting stats page for session", transcriptEntry.sessionId);
          chrome.tabs.create({ url: `post_meeting.html?id=${transcriptEntry.id || transcriptEntry.sessionId}` });
          
          // Mark this specific session as having its page opened
          sessionSpecificFlags[transcriptEntry.sessionId || transcriptEntry.id] = true;
          
          // Reset the flag for this session after a certain period to allow new tabs for future sessions
          setTimeout(() => {
            delete sessionSpecificFlags[transcriptEntry.sessionId || transcriptEntry.id];
            console.log("Reset page opened flag for session", transcriptEntry.sessionId || transcriptEntry.id);
          }, 30000); // Reset after 30 seconds
        } else if (transcriptEntry.isEnglish !== true) {
          console.log("Not opening post-meeting stats page because session is not confirmed as English:", transcriptEntry.isEnglish);
        }
        
        // Clear current transcript after saving
        currentTranscript = '';
      });
    });
  } catch (error) {
    console.error('Error saving transcript:', error);
    sendDebugMessage('Error saving transcript: ' + error.message);
    
    // Attempt backup saving to localStorage in case chrome.storage fails
    try {
      const backupData = {
        timestamp: new Date().toISOString(),
        sessionId: sessionId || 'session-' + Date.now(),
        text: text
      };
      localStorage.setItem('transcript_backup_' + Date.now(), JSON.stringify(backupData));
      console.log('Backup transcript saved to localStorage');
    } catch (backupError) {
      console.error('Backup saving also failed:', backupError);
    }
  }
}

// Function to create a temporary tab for stats when needed
function createTemporaryTabForStats(transcriptEntry) {
  console.log("Creating temporary background tab for stats calculation");
  
  // Use a data URL instead of about:blank to avoid origin issues
  const dataUrl = 'data:text/html,<html><head><title>Stats</title></head><body></body></html>';
  
  chrome.tabs.create({ 
    url: dataUrl,
    active: false
  }, (tab) => {
    // Set a timeout to ensure the tab gets closed even if something fails
    const tabCloseTimeout = setTimeout(() => {
      console.log("Safety timeout: closing stats calculation tab", tab.id);
      try {
        chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error("Error closing tab in safety timeout:", e);
      }
    }, 10000); // 10 second safety timeout
    
    // Load transcript_stats.js in the tab
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['transcript_stats.js']
    }).then(() => {
      // Calculate stats
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: calculateStats,
        args: [transcriptEntry]
      }).then(() => {
        // Clear the safety timeout
        clearTimeout(tabCloseTimeout);
        
        // Close the temporary tab
        console.log("Stats calculation complete, closing temporary tab", tab.id);
        chrome.tabs.remove(tab.id).catch(e => {
          console.error("Error closing temporary tab:", e);
        });
      }).catch(error => {
        console.error("Error executing stats calculation:", error);
        // Make sure to clean up the tab
        clearTimeout(tabCloseTimeout);
        chrome.tabs.remove(tab.id).catch(e => console.error("Cleanup error:", e));
      });
    }).catch(error => {
      console.error("Error loading transcript_stats.js:", error);
      // Make sure to clean up the tab
      clearTimeout(tabCloseTimeout);
      chrome.tabs.remove(tab.id).catch(e => console.error("Cleanup error:", e));
    });
  });
}

// Function to calculate stats for a transcript in a temporary tab
function calculateStats(transcript) {
  if (window.TranscriptStats) {
    return window.TranscriptStats.calculateTranscriptStats(transcript);
  }
}

function openTranscriptsPage() {
  // For now, still use the transcripts.html page when explicitly opening transcripts
  chrome.tabs.create({ url: 'transcripts.html' });
  
  // TODO: In the future, create a page to show all meeting transcripts using the new design
}

// Listen for runtime install or update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    console.log("Extension installed or updated. Checking for active Google Meet tabs...");
    
    // Find all tabs with Google Meet meetings and inject content script
    chrome.tabs.query({url: "https://meet.google.com/*"}, (tabs) => {
      for (const tab of tabs) {
        if (isGoogleMeetMeetingUrl(tab.url)) {
          console.log(`Found active Google Meet tab: ${tab.id}. Injecting content script...`);
          injectContentScriptIfNeeded(tab.id, tab.url);
        }
      }
    });
  }
}); 