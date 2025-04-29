console.log("Background script loaded");

let currentTranscript = '';
let isRecordingStopped = false;

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

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background:", message);
  
  if (message.type === 'finalTranscript') {
    currentTranscript = message.text;
    sendDebugMessage('Received transcript update');
    
    // Only save when recording is explicitly stopped
    if (isRecordingStopped) {
      saveTranscriptToStorage(currentTranscript);
      isRecordingStopped = false; // Reset flag after saving
    }
  } else if (message.type === 'error') {
    sendDebugMessage('Error: ' + message.error);
  } else if (message.type === 'recordingStatus') {
    // If recording was turned off, save the transcript
    if (message.isRecording === false && currentTranscript) {
      isRecordingStopped = true;
      sendDebugMessage('Recording stopped, preparing to save transcript');
    }
  } else if (message.type === 'debug' && message.text.includes('Meeting ended') && currentTranscript) {
    // Auto-save transcript when meeting ends
    sendDebugMessage('Meeting ended, saving transcript');
    isRecordingStopped = true;
    setTimeout(() => {
      if (currentTranscript && isRecordingStopped) {
        saveTranscriptToStorage(currentTranscript);
        isRecordingStopped = false;
      }
    }, 1000);
  } else if (message.type === 'openTranscriptsPage') {
    openTranscriptsPage();
  }
});

// Listen for tab updates to detect Google Meet pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log("Tab updated:", tab.url);
    
    if (isGoogleMeetMeetingUrl(tab.url)) {
      console.log("Google Meet meeting detected in tab:", tabId);
      sendDebugMessage('Google Meet meeting detected in tab ' + tabId);
      
      // Wait a moment for the page to fully initialize
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'startRecording' })
          .catch(err => {
            console.error("Error starting recording:", err);
          });
      }, 3000);
    }
  }
});

// Listen for tab close or navigation away from meeting
chrome.tabs.onRemoved.addListener((tabId) => {
  // If we have a transcript and tab is closed, save it
  if (currentTranscript) {
    sendDebugMessage('Tab closed, saving transcript');
    saveTranscriptToStorage(currentTranscript);
  }
});

function saveTranscriptToStorage(text) {
  if (!text || text.trim() === '') {
    sendDebugMessage('No transcript to save');
    return;
  }
  
  try {
    const timestamp = new Date().toISOString();
    const formattedDate = new Date().toLocaleString();
    
    // Create transcript object
    const transcriptEntry = {
      id: Date.now().toString(),
      timestamp: timestamp,
      formattedDate: formattedDate,
      text: text
    };
    
    // Save to chrome.storage.local
    chrome.storage.local.get(['transcripts'], (result) => {
      const transcripts = result.transcripts || [];
      transcripts.push(transcriptEntry);
      
      chrome.storage.local.set({ transcripts: transcripts }, () => {
        sendDebugMessage('Transcript saved to storage');
        
        // Notify user that the transcript is ready to view
        chrome.tabs.create({ url: 'transcripts.html' });
        
        // Clear current transcript after saving
        currentTranscript = '';
      });
    });
  } catch (error) {
    console.error('Error saving transcript:', error);
    sendDebugMessage('Error saving transcript: ' + error.message);
  }
}

function openTranscriptsPage() {
  chrome.tabs.create({ url: 'transcripts.html' });
} 