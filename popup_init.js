document.addEventListener('DOMContentLoaded', () => {
  let clickCount = 0;
  const logo = document.getElementById('logoIcon');
  const langLogsSection = document.getElementById('languageLogsSection');
  const debugSection = document.getElementById('debugInfoSection');
  const statusIcon = document.getElementById('statusIcon');

  // Update status icon when status changes
  const statusElement = document.getElementById('status');
  if (statusElement) {
    // Create an observer to watch for class changes on the status element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateStatusIcon(statusElement.className);
        }
      });
    });
    
    observer.observe(statusElement, { attributes: true });
    
    // Initial status icon update
    updateStatusIcon(statusElement.className);
  }
  
  function updateStatusIcon(statusClass) {
    statusIcon.className = 'status-icon';
    
    if (statusClass.includes('recording')) {
      statusIcon.classList.add('recording');
      statusIcon.classList.add('pulse');
      statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>';
    } else if (statusClass.includes('transcribing')) {
      statusIcon.classList.add('recording');
      statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>';
    } else {
      statusIcon.classList.add('not-meet-page');
      statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 0v12l8.8 3.2c.7-1.3 1.2-2.8 1.2-4.2 0-5.5-4.5-10-10-10z"/></svg>';
    }
  }

  if (logo && langLogsSection && debugSection) {
    logo.addEventListener('click', () => {
      clickCount++;
      if (clickCount === 5) {
        langLogsSection.style.display = 'block';
        debugSection.style.display = 'block';
        // clickCount = 0; // Optional: reset if you want to re-hide and click again
      }
    });
  }
}); 