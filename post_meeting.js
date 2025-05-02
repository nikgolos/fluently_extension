document.addEventListener('DOMContentLoaded', () => {
  // Get elements
  const meetingTimeElement = document.getElementById('meetingTime');
  const meetingLengthElement = document.getElementById('meetingLength');
  const speakingTimeElement = document.getElementById('speakingTime');
  const totalWordsElement = document.getElementById('totalWords');
  const wpmElement = document.getElementById('wpm');
  const shareButton = document.getElementById('shareButton');
  const returnButton = document.getElementById('returnButton');
  
  // Get transcriptId from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const transcriptId = urlParams.get('id');
  
  if (!transcriptId) {
    showError('No transcript ID provided');
    return;
  }
  
  // Load transcript data
  loadTranscriptData(transcriptId);
  
  // Setup button handlers
  setupButtonHandlers();
  
  // Function to load transcript data
  function loadTranscriptData(id) {
    chrome.storage.local.get(['transcripts', 'transcript_stats'], (result) => {
      const transcripts = result.transcripts || [];
      const allStats = result.transcript_stats || {};
      
      // Find the transcript
      const transcript = transcripts.find(t => t.id === id || t.sessionId === id);
      
      if (!transcript) {
        showError('Transcript not found');
        return;
      }
      
      // Get stats for this transcript
      const stats = allStats[id] || {};
      
      // Display transcript info
      displayTranscriptInfo(transcript, stats);
      
      // Store transcript for sharing
      window.transcriptData = transcript;
    });
  }
  
  // Function to display transcript info and stats
  function displayTranscriptInfo(transcript, stats) {
    // Format the date nicely
    const date = new Date(transcript.timestamp);
    const formattedDate = date.toLocaleDateString(undefined, {
      month: 'long', 
      day: 'numeric', 
      year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
    
    // Show date and time in small text below header
    meetingTimeElement.textContent = `${formattedDate} · ${formattedTime}`;
    
    // Stats
    if (stats) {
      meetingLengthElement.textContent = stats.formattedMeetingLength || '00h 00m 00s';
      speakingTimeElement.textContent = stats.formattedSpeakingTime || '00h 00m 00s';
      totalWordsElement.textContent = stats.totalWords || '0';
      wpmElement.textContent = stats.wordsPerMinute || '0';
    }
    
    // Add animation to stat cards
    animateStats();
  }
  
  // Function to animate the stats cards when they appear
  function animateStats() {
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach((card, index) => {
      setTimeout(() => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        
        setTimeout(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        }, 50);
      }, index * 100);
    });
  }
  
  // Function to handle errors
  function showError(message) {
    meetingTimeElement.textContent = `Error: ${message}`;
    
    // Hide stat cards
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
      card.style.display = 'none';
    });
  }
  
  // Set up button event handlers
  function setupButtonHandlers() {
    // Share button
    shareButton.addEventListener('click', () => {
      if (!window.transcriptData) return;
      
      // Prepare formatted stats for sharing
      const date = new Date(window.transcriptData.timestamp).toLocaleDateString();
      const time = new Date(window.transcriptData.timestamp).toLocaleTimeString();
      
      // Create share text with stats
      const shareText = `
Meeting Stats from ${date} at ${time}
Meeting Duration: ${meetingLengthElement.textContent}
Speaking Time: ${speakingTimeElement.textContent}
Total Words: ${totalWordsElement.textContent}
Words Per Minute: ${wpmElement.textContent}

Shared from Fluently Meeting Transcriber
`;
      
      // Try to use the Web Share API if available
      if (navigator.share) {
        navigator.share({
          title: `Meeting Stats: ${date}`,
          text: shareText
        }).catch(err => {
          // Fallback to clipboard if share fails
          copyToClipboard(shareText);
        });
      } else {
        // Fallback to clipboard
        copyToClipboard(shareText);
      }
    });
    
    // Return to Google Meet button
    returnButton.addEventListener('click', () => {
      // Redirect to Google Meet
      window.location.href = 'https://meet.google.com/';
    });
  }
  
  // Function to copy text to clipboard
  function copyToClipboard(text) {
    // Create a temporary textarea to copy the text
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    // Show feedback
    const originalText = shareButton.textContent;
    const originalIcon = shareButton.querySelector('svg').outerHTML;
    shareButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      Copied!
    `;
    
    setTimeout(() => {
      shareButton.innerHTML = `${originalIcon} ${originalText}`;
    }, 2000);
  }
}); 