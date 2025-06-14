document.addEventListener('DOMContentLoaded', () => {
  const viewTranscriptsButton = document.getElementById('viewTranscriptsButton');
  const debugArea = document.getElementById('debugArea');
  const languageLogsArea = document.getElementById('languageLogsArea');
  const statusDiv = document.getElementById('status');
  let currentTranscript = '';
  let isMeetingPage = false;
  let isMeetingActive = false;
  let isParticipating = false;
  let autoDetectionEnabled = true;
  let languageLogs = [];

  function logDebug(message) {
    debugArea.textContent = message;
  }

  function addLanguageLog(message) {
    // Add timestamp to log
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const formattedLog = `[${timestamp}] ${message}`;
    
    // Check if this exact message was logged in the last second (to prevent duplicates)
    const recentLogs = languageLogs.slice(-5);
    for (const log of recentLogs) {
      // Check if we have a very similar recent log (ignore timestamp)
      const existingMessage = log.substring(log.indexOf(']') + 2);
      if (existingMessage === message) {
        // Skip this duplicate message
        return;
      }
    }
    
    // Add to our logs array (max 20 entries)
    languageLogs.push(formattedLog);
    if (languageLogs.length > 20) {
      languageLogs.shift(); // Remove oldest log
    }
    
    // Update UI
    updateLanguageLogs();
  }

  function updateLanguageLogs() {
    languageLogsArea.innerHTML = '';
    
    languageLogs.forEach(log => {
      const logEntry = document.createElement('div');
      logEntry.className = 'log-entry';
      logEntry.textContent = log;
      languageLogsArea.appendChild(logEntry);
    });
    
    // Scroll to bottom to show latest logs
    languageLogsArea.scrollTop = languageLogsArea.scrollHeight;
  }

  function updateStatus(statusMessage, isRecording = false) {
    statusDiv.textContent = statusMessage;
    if (isRecording) {
      statusDiv.className = 'status recording';
    } else {
      statusDiv.className = 'status';
    }
  }

  // Function to check if a URL is a Google Meet meeting URL
  function isGoogleMeetMeetingUrl(url) {
    if (!url) return false;
    const meetingRegex = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
    return meetingRegex.test(url);
  }

  function injectContentScript() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          // Check if this is a Google Meet meeting page
          isMeetingPage = isGoogleMeetMeetingUrl(tabs[0].url);
          
          if (isMeetingPage) {
            chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js']
            })
            .then(() => resolve())
            .catch(error => {
              console.error('Error injecting content script:', error);
              reject(error);
            });
          } else {
            updateStatus('Not in a meeting');
            reject(new Error('Not in a Google Meet meeting. Please join a meeting with URL pattern meet.google.com/xxx-xxxx-xxx.'));
          }
        } else {
          reject(new Error('No active tab found'));
        }
      });
    });
  }

  // Check if we're on a Google Meet meeting page when popup opens
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && isGoogleMeetMeetingUrl(tabs[0].url)) {
      isMeetingPage = true;
      isMeetingActive = true; // Set meeting as active when we detect a valid URL
      
      // First try to force initialize the content script to ensure it's properly loaded
      chrome.tabs.sendMessage(tabs[0].id, { action: 'forceInitialize' })
        .then(response => {
          if (response && response.initialized) {
            logDebug('Meeting detection initialized successfully');
            checkStatus(tabs[0].id);
          }
        })
        .catch(error => {
          console.log('Error initializing content script:', error);
          // Fallback to injecting the script
          injectContentScript()
            .then(() => {
              // Give the script time to initialize
              setTimeout(() => {
                checkStatus(tabs[0].id);
              }, 1000);
            })
            .catch(error => {
              logDebug('Extension needs permission to access Google Meet. Please reload the meeting page.');
            });
        });
    } else if (tabs[0] && tabs[0].url.includes('meet.google.com')) {
      updateStatus('Google Meet homepage detected');
      logDebug('Please join a meeting to start recording.\nURL should be: meet.google.com/xxx-xxxx-xxx');
    } else {
      updateStatus('Not a Google Meet page');
      logDebug('Please open a Google Meet meeting to use this extension.');
    }
  });

  // Function to check status
  function checkStatus(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'getStatus' }, (response) => {
      // Handle case where content script isn't loaded yet
      if (chrome.runtime.lastError) {
        console.log('Status check error:', chrome.runtime.lastError.message);
        updateStatus('Google Meet detected - Click Start');
        logDebug('Waiting for the extension to connect to the meeting...');
        
        // Try to inject again after a short delay
        setTimeout(() => {
          injectContentScript()
            .then(() => {
              logDebug('Content script injected. Auto-recording should start momentarily...');
            })
            .catch(error => {
              logDebug('Error: ' + error.message);
            });
        }, 1000);
        return;
      }
      
      if (response) {
        isMeetingActive = response.isMeetingActive;
        isParticipating = response.isParticipating;
        
        if (!response.isMeetingActive) {
          updateStatus('Meeting has ended', false);
          logDebug('The meeting has ended. If you had a recording, the transcript will be saved automatically.');
          return;
        }
        
        if (response.isRecording) {
          updateStatus('Recording in progress', true);
          if (response.autoStarted) {
            logDebug('Recording started automatically when you joined the meeting.');
          }
        } else if (response.isParticipating) {
          updateStatus('Not an English Google Meet call', false);
          logDebug('You are in an active meeting. Recording will start automatically in a few seconds or you can click Start.');
          
          // If we detect participation but recording hasn't started, try to force start
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'forceInitialize' });
          }, 2000);
        } else {
          updateStatus('Waiting to join meeting');
          logDebug('You are on a meeting page but not yet actively participating. Recording will start automatically when you join.');
        }
      }
    });
  }
  
  // View transcripts button handler
  viewTranscriptsButton.addEventListener('click', () => {
    // Try direct approach first
    chrome.tabs.create({ url: 'transcripts.html' });
    
    // Also send message to background script as a fallback
    chrome.runtime.sendMessage({ type: 'openTranscriptsPage' });
  });

  // Open Google Meet button handler
  const openGoogleMeetButton = document.getElementById('openGoogleMeetButton');
  if (openGoogleMeetButton) {
    openGoogleMeetButton.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://meet.google.com/landing' });
    });
  }

  // Listen for messages from the content script and background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in popup:", message);
    
    if (message.type === 'transcriptUpdate') {
      if (message.isFinal) {
        currentTranscript = message.text;
        logDebug('Current transcript: ' + currentTranscript);
      } else {
        logDebug('Interim transcript: ' + message.text);
      }
    } else if (message.type === 'debug') {
      // Display all debug messages in debug area
      logDebug(message.text);
      
      // Check if it's a language detection log and handle it separately
      if (message.text && message.text.includes('[Language Detection]')) {
        // Extract just the content part after the prefix
        let logContent = message.text;
        if (logContent.includes('[Language Detection]')) {
          logContent = logContent.split('[Language Detection]')[1].trim();
        }
        addLanguageLog(logContent);
      }
      
      // Update UI based on debug messages
      if (message.text.includes('Saving transcription') || message.text.includes('saving transcript')) {
        updateStatus('Saving transcript...');
      } else if (message.text.includes('Transcript saved')) {
        updateStatus('Transcript saved');
        logDebug('Transcript saved successfully!');
      } else if (message.text.includes('Meeting ended')) {
        updateStatus('Meeting has ended', false);
        isMeetingActive = false;
        isParticipating = false;
        logDebug('Meeting has ended. Transcript will be saved automatically.');
      } else if (message.text.includes('Meeting detected - Recording started automatically')) {
        updateStatus('Recording in progress', true);
        logDebug('Meeting detected - Recording started automatically!');
      } else if (message.text.includes('Duplicate transcript detected')) {
        logDebug('Note: This transcript was already saved previously.');
      } else if (message.text.includes('transcript deleted because non-English language was detected')) {
        updateStatus('Recording stopped - Non-English detected', false);
        logDebug('Recording stopped and transcript deleted because language is not English.');
        // Make the language logs area flash to draw attention
        highlightLanguageLogs();
      }
    } else if (message.type === 'error') {
      logDebug('Error: ' + message.error);
    } else if (message.type === 'recordingStatus') {
      if (!message.isRecording && !isMeetingActive) {
        updateStatus('Meeting has ended');
      } else {
        updateStatus(message.isRecording ? 'Recording in progress' : 'Ready', message.isRecording);
      }
    } else if (message.type === 'warning' && message.text === 'Language is not English') {
      addLanguageLog(`Warning: Language is not English - Recording stopped and transcript deleted`);
      // Highlight the log area to draw attention
      highlightLanguageLogs();
    } else if (message.type === 'nonEnglishDetected') {
      updateStatus('Non-English detected - Recording stopped', false);
      
      // Parse the expiration time to show when recording will be available again
      const expirationTime = message.expirationTime ? new Date(message.expirationTime) : null;
      const expirationMessage = expirationTime ? 
        ` Recording blocked until ${expirationTime.toLocaleTimeString()}` : '';
      
      addLanguageLog(`Non-English language detected - Recording has been stopped and transcript deleted.${expirationMessage}`);
      
      // Highlight the log area to draw attention
      highlightLanguageLogs();
    }
  });
  
  // Function to highlight the language logs area to draw attention
  function highlightLanguageLogs() {
    // Save the original background color
    const originalColor = languageLogsArea.style.backgroundColor;
    
    // Flash the background color a few times
    languageLogsArea.style.backgroundColor = '#ffcccc';
    
    setTimeout(() => {
      languageLogsArea.style.backgroundColor = originalColor;
      
      setTimeout(() => {
        languageLogsArea.style.backgroundColor = '#ffcccc';
        
        setTimeout(() => {
          languageLogsArea.style.backgroundColor = originalColor;
        }, 500);
      }, 500);
    }, 500);
  }
}); 