// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  const feedbackButton = document.getElementById('feedbackButton');
  const feedbackText = document.getElementById('feedbackText');
  
  if (feedbackButton && feedbackText) {
    const onClick = function() {
      feedbackText.textContent = 'meet.english.checker@gmail.com';
      feedbackButton.style.cursor = 'default';
      feedbackButton.style.userSelect = 'text';
      feedbackButton.removeEventListener('click', onClick);
    };
    feedbackButton.addEventListener('click', onClick);
  }
}); 