document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const debugArea = document.getElementById('debugArea');
  const statusDiv = document.getElementById('status');
  let currentTranscript = '';
  let isMeetingPage = false;
  let isMeetingActive = false;

  function logDebug(message) {
    debugArea.textContent = message;
  }

  function updateStatus(statusMessage, isRecording = false) {
    statusDiv.textContent = statusMessage;
    if (isRecording) {
      statusDiv.className = 'status recording';
      startButton.disabled = true;
      stopButton.disabled = false;
    } else {
      statusDiv.className = 'status';
      startButton.disabled = !isMeetingPage;
      stopButton.disabled = true;
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
      
      // Check recording status and meeting status
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        // Ignore chrome.runtime.lastError
        if (chrome.runtime.lastError) {
          console.log('Initial status check error:', chrome.runtime.lastError.message);
          updateStatus('Google Meet detected - Click Start');
          return;
        }
        
        if (response) {
          isMeetingActive = response.isMeetingActive;
          
          if (!response.isMeetingActive) {
            updateStatus('Meeting has ended', false);
            logDebug('The meeting has ended. Please join a new meeting to start recording.');
            return;
          }
          
          if (response.isRecording) {
            updateStatus('Recording in progress', true);
          } else {
            updateStatus('Meeting in progress - Ready to record');
          }
        }
      });
    } else if (tabs[0] && tabs[0].url.includes('meet.google.com')) {
      updateStatus('Google Meet homepage detected');
      logDebug('Please join a meeting to start recording.\nURL should be: meet.google.com/xxx-xxxx-xxx');
    } else {
      updateStatus('Not a Google Meet page');
      logDebug('Please open a Google Meet meeting to use this extension.');
    }
  });

  startButton.addEventListener('click', async () => {
    try {
      await injectContentScript();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'startRecording' }, (response) => {
            if (chrome.runtime.lastError) {
              logDebug('Error: ' + chrome.runtime.lastError.message);
            } else if (response && response.status === 'started') {
              updateStatus('Recording in progress', true);
              logDebug('Recording started - Speak now');
              currentTranscript = ''; // Clear previous transcript
            } else if (response && response.status === 'error') {
              logDebug('Error: ' + response.error);
              // If meeting ended, update UI
              if (response.error.includes('meeting has ended')) {
                updateStatus('Meeting has ended', false);
                startButton.disabled = true;
              }
            }
          });
        }
      });
    } catch (error) {
      logDebug('Error: ' + error.message);
    }
  });

  stopButton.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }, (response) => {
          if (chrome.runtime.lastError) {
            logDebug('Error: ' + chrome.runtime.lastError.message);
          } else if (response && response.status === 'stopped') {
            updateStatus('Processing transcript...', false);
            logDebug('Recording stopped. Saving transcript...');
            
            // After a short delay, update status to ready
            setTimeout(() => {
              // Check if meeting is still active
              chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (statusResponse) => {
                if (statusResponse && !statusResponse.isMeetingActive) {
                  updateStatus('Meeting has ended');
                  startButton.disabled = true;
                } else {
                  updateStatus('Ready');
                }
              });
            }, 3000);
          }
        });
      }
    });
  });

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
      logDebug(message.text);
      
      // Update UI based on debug messages
      if (message.text.includes('Saving transcription')) {
        updateStatus('Saving transcript...');
      } else if (message.text.includes('CSV file saved')) {
        updateStatus('Transcript saved');
        logDebug('Transcript saved successfully!');
      } else if (message.text.includes('Meeting ended')) {
        updateStatus('Meeting has ended');
        startButton.disabled = true;
        isMeetingActive = false;
      }
    } else if (message.type === 'error') {
      logDebug('Error: ' + message.error);
    } else if (message.type === 'recordingStatus') {
      if (!message.isRecording && !isMeetingActive) {
        updateStatus('Meeting has ended');
        startButton.disabled = true;
      } else {
        updateStatus(message.isRecording ? 'Recording in progress' : 'Ready', message.isRecording);
      }
    }
  });
}); 