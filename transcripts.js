document.addEventListener('DOMContentLoaded', () => {
  const transcriptList = document.getElementById('transcriptList');
  const transcriptView = document.getElementById('transcriptView');
  const transcriptTitle = document.getElementById('transcriptTitle');
  const transcriptTime = document.getElementById('transcriptTime');
  const transcriptContent = document.getElementById('transcriptContent');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
  
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
            No transcripts saved yet. Start recording a Google Meet to create transcripts.
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
        const meetingInfo = transcript.meetingId ? ` - Meeting: ${transcript.meetingId}` : '';
        const recoveredBadge = transcript.recovered ? '<span class="recovered-badge">Recovered</span>' : '';
        
        const transcriptItem = document.createElement('div');
        transcriptItem.className = 'transcript-item';
        transcriptItem.dataset.id = transcript.id;
        transcriptItem.innerHTML = `
          <div class="transcript-date">${transcript.formattedDate}${meetingInfo} ${recoveredBadge}</div>
          <div class="transcript-preview">${preview}</div>
        `;
        
        transcriptItem.addEventListener('click', () => {
          // Store the current transcript
          currentTranscript = transcript;
          
          // Update the view
          const meetingLabel = transcript.meetingId ? `<span class="meeting-id">Meeting: ${transcript.meetingId}</span>` : '';
          transcriptTitle.innerHTML = `Transcript from ${transcript.formattedDate} ${meetingLabel}`;
          transcriptTime.textContent = `Recorded at ${new Date(transcript.timestamp).toLocaleTimeString()}`;
          transcriptContent.textContent = transcript.text;
          
          // Show the view
          transcriptView.style.display = 'block';
          
          // Enable the download button
          downloadCurrentBtn.disabled = false;
          
          // Highlight the selected item
          document.querySelectorAll('.transcript-item').forEach(item => {
            item.style.borderLeftColor = item.dataset.id === transcript.id ? '#0f9d58' : '#4285f4';
          });
          
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
  
  // Clear all transcripts
  clearAllBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all transcripts? This cannot be undone.')) {
      chrome.storage.local.set({ transcripts: [] }, () => {
        loadTranscripts();
        transcriptView.style.display = 'none';
        downloadCurrentBtn.disabled = true;
      });
    }
  });
  
  // Download current transcript
  downloadCurrentBtn.addEventListener('click', () => {
    if (!currentTranscript) return;
    
    // Create a timestamp for the filename
    const timestamp = new Date(currentTranscript.timestamp)
      .toISOString()
      .replace(/[:.]/g, '-');
    
    // Create CSV content
    const csvContent = `Timestamp,Meeting ID,Transcript\n${currentTranscript.timestamp},"${currentTranscript.meetingId || ''}","${currentTranscript.text.replace(/"/g, '""')}"`;
    
    // Create download link
    const encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `transcript_${timestamp}.csv`);
    document.body.appendChild(link);
    
    // Trigger download
    link.click();
    
    // Clean up
    document.body.removeChild(link);
  });
  
  // Check for unfinished sessions first
  checkForUnfinishedSessions();
  
  // Load transcripts when the page loads
  loadTranscripts();
}); 