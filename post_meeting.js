document.addEventListener('DOMContentLoaded', () => {
  // Get elements
  const meetingTimeElement = document.getElementById('meetingTime');
  const meetingLengthElement = document.getElementById('meetingLength');
  const speakingTimeElement = document.getElementById('speakingTime');
  const totalWordsElement = document.getElementById('totalWords');
  const wpmElement = document.getElementById('wpm');
  const garbageWordsElement = document.getElementById('garbageWords');
  const garbageWordsListElement = document.getElementById('garbageWordsList');
  const garbagePercentageElement = document.getElementById('garbagePercentage');
  const shareButton = document.getElementById('shareButton');
  const returnButton = document.getElementById('returnButton');
  
  // Get transcriptId from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const transcriptId = urlParams.get('id');
  
  if (!transcriptId) {
    showError('No transcript ID provided');
    return;
  }
  
  // Load TranscriptStats script first, then proceed
  loadScript('transcript_stats.js', () => {
    // Load transcript data
    loadTranscriptData(transcriptId);
  });
  
  // Setup button handlers
  setupButtonHandlers();
  
  // Helper function to load a script
  function loadScript(scriptPath, callback) {
    const script = document.createElement('script');
    script.src = scriptPath;
    script.onload = callback;
    script.onerror = (error) => {
      console.error(`Error loading script ${scriptPath}:`, error);
      // Continue anyway, as we'll calculate stats manually if needed
      callback();
    };
    document.head.appendChild(script);
  }
  
  // Function to load transcript data
  function loadTranscriptData(id) {
    chrome.storage.local.get(['transcripts', 'transcript_stats'], (result) => {
      const transcripts = result.transcripts || [];
      const allStats = result.transcript_stats || {};
      
      console.log("Loaded transcripts:", transcripts);
      console.log("Loaded stats:", allStats);
      
      // Find the transcript
      const transcript = transcripts.find(t => t.id === id || t.sessionId === id);
      
      if (!transcript) {
        showError('Transcript not found');
        return;
      }
      
      console.log("Found transcript:", transcript);
      
      // Get stats for this transcript - try multiple IDs
      let stats = allStats[id] || {}; // Try URL parameter ID first
      
      // If no stats found, try transcript.id
      if (Object.keys(stats).length === 0 && transcript.id && transcript.id !== id) {
        stats = allStats[transcript.id] || {};
        console.log("Tried transcript.id for stats:", transcript.id, stats);
      }
      
      // If still no stats, try sessionId
      if (Object.keys(stats).length === 0 && transcript.sessionId && transcript.sessionId !== id) {
        stats = allStats[transcript.sessionId] || {};
        console.log("Tried transcript.sessionId for stats:", transcript.sessionId, stats);
      }
      
      console.log("Stats for transcript:", stats);
      
      // If TranscriptStats is loaded, we'll always calculate (or recalculate) garbage word stats
      if (typeof window.TranscriptStats !== 'undefined') {
        // If we already have some stats but need to calculate/recalculate garbage words
        if (Object.keys(stats).length > 0 && (!stats.garbage_words || Object.keys(stats.garbage_words).length === 0)) {
          console.log("Calculating garbage word stats for existing transcript stats");
          
          // Keep existing stats and add garbage words
          window.TranscriptStats.calculateGarbageWordStats(transcript.text)
            .then(garbageStats => {
              stats.garbage_words = garbageStats;
              
              // Save updated stats
              saveCalculatedStats(stats, transcript.id);
              
              // Display transcript info with updated stats
              displayTranscriptInfo(transcript, stats);
            })
            .catch(error => {
              console.error("Error calculating garbage word stats:", error);
              
              // Display with existing stats
              displayTranscriptInfo(transcript, stats);
            });
        } 
        // If we have no stats at all, calculate everything
        else if (Object.keys(stats).length === 0 && transcript.text) {
          console.log("No stats found, calculating all stats including garbage words");
          
          // Calculate all stats including garbage words
          window.TranscriptStats.calculateTranscriptStats(transcript)
            .then(calculatedStats => {
              console.log("Calculated stats:", calculatedStats);
              
              // Store these stats for future use
              saveCalculatedStats(calculatedStats, transcript.id);
              
              // Display transcript info
              displayTranscriptInfo(transcript, calculatedStats);
            })
            .catch(error => {
              console.error("Error calculating transcript stats:", error);
              
              // Fallback to basic stats
              const basicStats = calculateBasicStats(transcript);
              displayTranscriptInfo(transcript, basicStats);
            });
        }
        // Otherwise, use existing stats that already include garbage words
        else {
          displayTranscriptInfo(transcript, stats);
        }
      } else {
        console.warn("TranscriptStats module not loaded, calculating basic stats");
        stats = calculateBasicStats(transcript);
        console.log("Basic calculated stats:", stats);
        
        // Display transcript info
        displayTranscriptInfo(transcript, stats);
      }
      
      // Store transcript for sharing
      window.transcriptData = transcript;
    });
  }
  
  // Save calculated stats to storage
  function saveCalculatedStats(stats, transcriptId) {
    chrome.storage.local.get(['transcript_stats'], (result) => {
      const allStats = result.transcript_stats || {};
      
      // Add new stats with transcript ID as key
      allStats[transcriptId] = stats;
      
      // Save back to storage
      chrome.storage.local.set({ transcript_stats: allStats }, () => {
        console.log('Transcript stats saved:', stats);
      });
    });
  }
  
  // Calculate basic stats if TranscriptStats is not available
  function calculateBasicStats(transcript) {
    if (!transcript || !transcript.text) {
      return {
        total_words: 0,
        words_per_minute: 0,
        meeting_length: '00h 00m 00s',
        speaking_time: '00h 00m 00s',
        garbage_words: {
          totalGarbageWords: 0,
          topGarbageWords: {},
          garbagePercentage: 0
        }
      };
    }
    
    // Count words (rough estimate)
    const text = transcript.text.replace(/\[S:[^\]]+\]|\[E:[^\]]+\]/g, ''); // Remove timestamps
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length;
    
    // Estimate meeting length (from timestamp if available)
    let meetingLength = '00h 00m 00s';
    if (transcript.timestamp) {
      const meetingDate = new Date(transcript.timestamp);
      const now = new Date();
      const diffSeconds = Math.floor((now - meetingDate) / 1000);
      meetingLength = formatTimeDisplay(diffSeconds);
    }
    
    // Estimate speaking time based on word count (average 150 words per minute)
    const estimatedSpeakingTimeSeconds = Math.max(Math.round(totalWords / 150 * 60), 1);
    const speakingTime = formatTimeDisplay(estimatedSpeakingTimeSeconds);
    
    // Estimate words per minute
    const wpm = Math.round(totalWords / (estimatedSpeakingTimeSeconds / 60));
    
    // We can't calculate garbage words properly without the dictionary,
    // so we'll provide a placeholder with zero values
    const garbageWords = {
      totalGarbageWords: 0,
      topGarbageWords: {}
    };
    
    return {
      transcript_id: transcript.id,
      session_id: transcript.sessionId,
      meeting_id: transcript.meetingId,
      total_words: totalWords,
      words_per_minute: wpm,
      meeting_length: meetingLength,
      speaking_time: speakingTime,
      speaking_time_seconds: estimatedSpeakingTimeSeconds,
      timestamp: new Date().toISOString(),
      calculated_on_page: true,
      garbage_words: garbageWords
    };
  }
  
  // Format time in seconds to "XXh YYm ZZs" format
  function formatTimeDisplay(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }
  
  // Function to display transcript info and stats
  function displayTranscriptInfo(transcript, stats) {
    console.log("Displaying info for transcript:", transcript.id);
    console.log("Stats object:", stats);
    
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
    
    // Stats - correctly access properties and provide fallbacks
    if (stats && Object.keys(stats).length > 0) {
      // Meeting length - check for both direct and formatted fields
      meetingLengthElement.textContent = stats.meeting_length || stats.formattedMeetingLength || '00h 00m 00s';
      
      // Speaking time - check for both direct and formatted fields
      speakingTimeElement.textContent = stats.speaking_time || stats.formattedSpeakingTime || '00h 00m 00s';
      
      // Total words - check both naming conventions
      totalWordsElement.textContent = stats.total_words || stats.totalWords || '0';
      
      // Words per minute - check both naming conventions
      wpmElement.textContent = stats.words_per_minute || stats.wordsPerMinute || '0';
      
      // Display garbage words stats if available
      if (stats.garbage_words) {
        garbageWordsElement.textContent = stats.garbage_words.totalGarbageWords || '0';
        
        // Display garbage words percentage
        const percentage = stats.garbage_words.garbagePercentage || 0;
        garbagePercentageElement.textContent = `(${percentage}%)`;
        
        // Display top garbage words if available
        if (stats.garbage_words.topGarbageWords && Object.keys(stats.garbage_words.topGarbageWords).length > 0) {
          garbageWordsListElement.innerHTML = '';
          
          // Create list items for each top garbage word
          Object.entries(stats.garbage_words.topGarbageWords).forEach(([word, count]) => {
            const wordItem = document.createElement('div');
            wordItem.className = 'garbage-word-item';
            
            // Format the display based on category names
            let displayText = '';
            if (word === 'yes' || word === 'okey' || word === 'uhh' || word === 'right') {
              // This is a category name - capitalize the first letter
              displayText = `${word.charAt(0).toUpperCase() + word.slice(1)}: ${count}`;
            } else {
              // This is a regular word from the "others" category
              displayText = `${word}: ${count}`;
            }
            
            wordItem.textContent = displayText;
            garbageWordsListElement.appendChild(wordItem);
          });
        } else {
          garbageWordsListElement.innerHTML = '<div class="garbage-word-item">No frequent garbage words</div>';
        }
      } else {
        garbageWordsElement.textContent = '0';
        garbagePercentageElement.textContent = '(0%)';
        garbageWordsListElement.innerHTML = '';
      }
      
      console.log("Displayed stats:", {
        meetingLength: meetingLengthElement.textContent,
        speakingTime: speakingTimeElement.textContent,
        totalWords: totalWordsElement.textContent,
        wpm: wpmElement.textContent,
        garbageWords: garbageWordsElement.textContent,
        garbagePercentage: garbagePercentageElement.textContent
      });
    } else {
      console.warn("No stats found for transcript:", transcript.id);
      meetingLengthElement.textContent = '00h 00m 00s';
      speakingTimeElement.textContent = '00h 00m 00s';
      totalWordsElement.textContent = '0';
      wpmElement.textContent = '0';
      garbageWordsElement.textContent = '0';
      garbagePercentageElement.textContent = '(0%)';
      garbageWordsListElement.innerHTML = '';
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
      
      // Get garbage words info for sharing if available
      let garbageWordsText = '';
      if (garbageWordsElement.textContent !== '0') {
        garbageWordsText = `\nGarbage Words: ${garbageWordsElement.textContent} ${garbagePercentageElement.textContent}`;
        
        // Add individual garbage words if available
        const garbageItems = garbageWordsListElement.querySelectorAll('.garbage-word-item');
        if (garbageItems.length > 0) {
          Array.from(garbageItems).forEach(item => {
            garbageWordsText += `\n    ${item.textContent}`;
          });
        }
      }
      
      // Create share text with stats
      const shareText = `
Meeting Stats from ${date} at ${time}
Meeting Duration: ${meetingLengthElement.textContent}
Speaking Time: ${speakingTimeElement.textContent}
Total Words: ${totalWordsElement.textContent}
Words Per Minute: ${wpmElement.textContent}${garbageWordsText}

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