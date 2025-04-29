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
      saveToCSV(currentTranscript);
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
        saveToCSV(currentTranscript);
        isRecordingStopped = false;
      }
    }, 1000);
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
    saveToCSV(currentTranscript);
  }
});

function saveToCSV(text) {
  if (!text || text.trim() === '') {
    sendDebugMessage('No transcript to save');
    return;
  }
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `transcript_${timestamp}.csv`;
    
    // Create CSV content
    const csvContent = `Timestamp,Transcript\n${timestamp},"${text.replace(/"/g, '""')}"`;
    
    // Convert to base64
    const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
    
    // Create download URL
    const dataUrl = `data:text/csv;base64,${base64Content}`;
    
    sendDebugMessage('Saving transcription to CSV...');
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });
    sendDebugMessage('CSV file saved successfully!');
    
    // Clear transcript after saving
    currentTranscript = '';
  } catch (error) {
    console.error('Error saving CSV:', error);
    sendDebugMessage('Error saving CSV: ' + error.message);
  }
} 