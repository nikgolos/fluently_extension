document.addEventListener('DOMContentLoaded', () => {
  const transcriptList = document.getElementById('transcriptList');
  const transcriptView = document.getElementById('transcriptView');
  const transcriptTitle = document.getElementById('transcriptTitle');
  const transcriptTime = document.getElementById('transcriptTime');
  const clearAllBtn = document.getElementById('clearAllBtn');
  
  // Add transcript stats elements
  const transcriptStats = document.createElement('div');
  transcriptStats.id = 'transcriptStats';
  transcriptStats.className = 'transcript-stats';
  transcriptStats.innerHTML = `
    <div class="stat-card">
      <div class="stat-title">English Score</div>
      <div class="stat-value" id="englishScoreValue">-</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">Fluency Score</div>
      <div class="stat-value" id="fluencyScoreValue">-</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">Grammar Score</div>
      <div class="stat-value" id="grammarScoreValue">-</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">Vocabulary Score</div>
      <div class="stat-value" id="vocabularyScoreValue">-</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">Your Speaking Time</div>
      <div class="stat-value" id="speakingTimeValue">-</div>
    </div>
  `;
  
  // Insert stats section after transcript time
  transcriptTime.after(transcriptStats);
  
  let currentTranscript = null;
  
  // Check for unfinished sessions
  function checkForUnfinishedSessions() {
    chrome.storage.local.get(['latest_session_id', 'latest_complete_session'], (result) => {
      if (result.latest_session_id && result.latest_session_id !== result.latest_complete_session) {
        // There might be an unfinished session
        const sessionKey = `transcript_segment_${result.latest_session_id}`;
        chrome.storage.local.get([sessionKey], (data) => {
          if (data[sessionKey] && !data[sessionKey].isComplete) {
            console.log('Found unfinished session:', result.latest_session_id);
            // Show a recovery message
            const recoveryNote = document.createElement('div');
            recoveryNote.className = 'recovery-note';
            recoveryNote.innerHTML = `
              <p>There appears to be an unfinished transcript session.</p>
              <button id="recoverSessionBtn">Recover Latest Session</button>
            `;
            document.querySelector('.toolbar').after(recoveryNote);
            
            // Handle recovery button
            document.getElementById('recoverSessionBtn').addEventListener('click', () => {
              const segment = data[sessionKey];
              // Create a completed transcript from this segment
              const transcript = {
                id: segment.sessionId,
                sessionId: segment.sessionId,
                timestamp: segment.timestamp,
                formattedDate: segment.formattedDate || new Date().toLocaleString(),
                meetingId: segment.meetingCode || 'unknown-meeting',
                text: segment.text,
                recovered: true
              };
              
              // Add to transcripts array
              chrome.storage.local.get(['transcripts'], (result) => {
                const transcripts = result.transcripts || [];
                transcripts.push(transcript);
                chrome.storage.local.set({ 
                  transcripts: transcripts,
                  'latest_complete_session': segment.sessionId
                }, () => {
                  recoveryNote.innerHTML = '<p>Session recovered successfully!</p>';
                  setTimeout(() => recoveryNote.remove(), 3000);
                  loadTranscripts();
                });
              });
            });
          }
        });
      }
    });
  }
  
  // Load all saved transcripts
  function loadTranscripts() {
    chrome.storage.local.get(['transcripts'], (result) => {
      const transcripts = result.transcripts || [];
      
      if (transcripts.length === 0) {
        transcriptList.innerHTML = `
          <div class="empty-state">
            Start a Google Meet call in English and speak at least 50 words to receive your first feedback.
          </div>
        `;
        return;
      }
      
      // Sort transcripts by date (newest first)
      transcripts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Clear the list
      transcriptList.innerHTML = '';
      
      // Add each transcript to the list
      transcripts.forEach(transcript => {
        const preview = transcript.text.substring(0, 100) + (transcript.text.length > 100 ? '...' : '');
        const meetingInfo = transcript.meetingId ? ` Meeting id: ${transcript.meetingId}` : '';
        const recoveredBadge = transcript.recovered ? '<span class="recovered-badge">Recovered</span>' : '';
        
        const transcriptItem = document.createElement('div');
        transcriptItem.className = 'transcript-item';
        transcriptItem.dataset.id = transcript.id;
        transcriptItem.innerHTML = `
          <div class="transcript-info">
            <div class="transcript-date">${transcript.formattedDate} ${recoveredBadge}</div>
            <div class="transcript-preview">${meetingInfo}</div>
          </div>
          <div class="english-level" id="englishLevel-${transcript.id}">-</div>
        `;
        
        // Load the English score from transcript_stats
        chrome.storage.local.get(['transcript_stats'], (result) => {
          const allStats = result.transcript_stats || {};
          const stats = allStats[transcript.id];
          
          if (stats && stats.api_englishScore) {
            const englishLevel = document.getElementById(`englishLevel-${transcript.id}`);
            if (englishLevel) {
              englishLevel.textContent = `${stats.api_englishScore}/100`;
              
              // Add level class based on score
              if (stats.api_englishScore >= 80) {
                englishLevel.classList.add('level-high');
              } else if (stats.api_englishScore >= 60) {
                englishLevel.classList.add('level-medium');
              } else {
                englishLevel.classList.add('level-low');
              }
            }
          }
        });
        
        transcriptItem.addEventListener('click', () => {
          // Store the current transcript
          currentTranscript = transcript;
          
          // Update the view
          // Remove the meeting ID from the title
          transcriptTitle.innerHTML = `Call from ${transcript.formattedDate}`;
          
          // Display meeting ID in the transcriptTime element
          if (transcript.meetingId) {
            transcriptTime.textContent = `Meeting: ${transcript.meetingId}`;
          } else {
            transcriptTime.textContent = ''; // Empty if no meeting ID
          }
          
          // Set the full feedback link to the post-meeting page
          const fullFeedbackLink = document.getElementById('fullFeedbackLink');
          if (fullFeedbackLink) {
            fullFeedbackLink.href = `post_meeting.html?id=${transcript.id}`;
          }
          
          // Show the view
          transcriptView.style.display = 'block';
          
          // Highlight the selected item
          document.querySelectorAll('.transcript-item').forEach(item => {
            item.style.borderLeftColor = item.dataset.id === transcript.id ? '#0f9d58' : '#4285f4';
          });
          
          // Load and display transcript stats
          loadTranscriptStats(transcript.id);
          
          // Scroll to the transcript view
          transcriptView.scrollIntoView({ behavior: 'smooth' });
        });
        
        transcriptList.appendChild(transcriptItem);
      });
      
      // Auto-select the first transcript
      if (transcripts.length > 0) {
        transcriptList.querySelector('.transcript-item').click();
      }
    });
  }
  
  // Load transcript statistics
  function loadTranscriptStats(transcriptId) {
    // Reset stats display
    document.getElementById('englishScoreValue').textContent = '-';
    document.getElementById('fluencyScoreValue').textContent = '-';
    document.getElementById('grammarScoreValue').textContent = '-';
    document.getElementById('vocabularyScoreValue').textContent = '-';
    document.getElementById('speakingTimeValue').textContent = '-';
    
    // Check if stats module is loaded
    if (typeof TranscriptStats === 'undefined') {
      // Load the script
      const script = document.createElement('script');
      script.src = 'transcript_stats.js';
      script.onload = () => {
        // Once script is loaded, get stats
        getAndDisplayStats(transcriptId);
      };
      document.head.appendChild(script);
    } else {
      // Get stats directly
      getAndDisplayStats(transcriptId);
    }
  }
  
  // Get and display transcript stats
  function getAndDisplayStats(transcriptId) {
    TranscriptStats.getTranscriptStats(transcriptId, (stats) => {
      if (stats) {
        console.log("Retrieved stored stats for transcript:", transcriptId, stats);
        
        // Update UI with the stats
        document.getElementById('englishScoreValue').textContent = stats.api_englishScore ? `${stats.api_englishScore}/100` : '-';
        
        // Apply color to Fluency Score based on value
        const fluencyElement = document.getElementById('fluencyScoreValue');
        if (stats.fluencyScore) {
          fluencyElement.textContent = `${stats.fluencyScore}%`;
          if (stats.fluencyScore >= 70) {
            fluencyElement.classList.add('score-good');
            fluencyElement.classList.remove('score-bad');
          } else {
            fluencyElement.classList.add('score-bad');
            fluencyElement.classList.remove('score-good');
          }
        } else {
          fluencyElement.textContent = '-';
          fluencyElement.classList.remove('score-good', 'score-bad');
        }
        
        // Apply color to Grammar Score based on value
        const grammarElement = document.getElementById('grammarScoreValue');
        if (stats.api_grammarScore) {
          grammarElement.textContent = `${stats.api_grammarScore}%`;
          if (stats.api_grammarScore >= 70) {
            grammarElement.classList.add('score-good');
            grammarElement.classList.remove('score-bad');
          } else {
            grammarElement.classList.add('score-bad');
            grammarElement.classList.remove('score-good');
          }
        } else {
          grammarElement.textContent = '-';
          grammarElement.classList.remove('score-good', 'score-bad');
        }
        
        // Apply color to Vocabulary Score based on value
        const vocabElement = document.getElementById('vocabularyScoreValue');
        if (stats.api_vocabularyScore) {
          vocabElement.textContent = `${stats.api_vocabularyScore}%`;
          if (stats.api_vocabularyScore >= 70) {
            vocabElement.classList.add('score-good');
            vocabElement.classList.remove('score-bad');
          } else {
            vocabElement.classList.add('score-bad');
            vocabElement.classList.remove('score-good');
          }
        } else {
          vocabElement.textContent = '-';
          vocabElement.classList.remove('score-good', 'score-bad');
        }
        
        document.getElementById('speakingTimeValue').textContent = stats.speaking_time || '-';
      } else {
        console.log("No stored stats found, calculating on the fly for:", currentTranscript?.id);
        // Calculate stats on the fly if not found
        if (currentTranscript) {
          const calculatedStats = TranscriptStats.calculateTranscriptStats(currentTranscript);
          
          // Basic stats are calculated on the fly
          document.getElementById('speakingTimeValue').textContent = calculatedStats.speaking_time || '-';
          
          // The API-based scores might not be available without API call
          document.getElementById('englishScoreValue').textContent = '-';
          
          // Apply color to Fluency Score if available
          const fluencyElement = document.getElementById('fluencyScoreValue');
          if (calculatedStats.fluency_score) {
            fluencyElement.textContent = `${calculatedStats.fluency_score}%`;
            if (calculatedStats.fluency_score >= 70) {
              fluencyElement.classList.add('score-good');
              fluencyElement.classList.remove('score-bad');
            } else {
              fluencyElement.classList.add('score-bad');
              fluencyElement.classList.remove('score-good');
            }
          } else {
            fluencyElement.textContent = '-';
            fluencyElement.classList.remove('score-good', 'score-bad');
          }
          
          document.getElementById('grammarScoreValue').textContent = '-';
          document.getElementById('vocabularyScoreValue').textContent = '-';
        }
      }
    });
  }
  
  // Clear all transcripts
  clearAllBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all transcripts? This cannot be undone.')) {
      chrome.storage.local.set({ 
        transcripts: [],
        transcript_stats: {} // Also clear stats
      }, () => {
        loadTranscripts();
        transcriptView.style.display = 'none';
      });
    }
  });
  
  // Check for unfinished sessions first
  checkForUnfinishedSessions();
  
  // Load transcripts when the page loads
  loadTranscripts();
}); 