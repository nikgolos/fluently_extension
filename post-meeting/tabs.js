// Wait for the DOM to fully load before accessing elements
document.addEventListener('DOMContentLoaded', function() {
  // Get all tab elements
  const generalTab = document.querySelector('.general-tab');
  const grammarTab = document.querySelector('.grammar-tab');
  const vocabularyTab = document.querySelector('.vocabulary-tab');
  const fluencyTab = document.querySelector('.fluency-tab');
  
  // Get all content sections
  const generalTabBody = document.querySelector('.general-tab-body');
  const grammarTabBody = document.querySelector('.grammar-tab-body');
  const vocabularyTabBody = document.querySelector('.vocabulary-tab-body');
  const fluencyTabBody = document.querySelector('.fluency-tab-body');
  
  if (!generalTab || !grammarTab || !vocabularyTab || !fluencyTab) {
    console.error('Tab elements not found');
    return;
  }
  
  if (!generalTabBody || !grammarTabBody || !vocabularyTabBody || !fluencyTabBody) {
    console.error('Tab content elements not found');
    return;
  }
  
  // Function to handle tab clicks
  function switchTab(activeTab, activeContent) {
    // Remove selected class from all tabs
    [generalTab, grammarTab, vocabularyTab, fluencyTab].forEach(tab => {
      tab.classList.remove('tab-selected');
    });
    
    // Hide all content sections
    [generalTabBody, grammarTabBody, vocabularyTabBody, fluencyTabBody].forEach(content => {
      content.style.display = 'none';
    });
    
    // Activate selected tab and content
    activeTab.classList.add('tab-selected');
    activeContent.style.display = 'block';
    
    console.log('Switched to tab:', activeTab.querySelector('.label').textContent);
  }
  
  // Add click event listeners to tabs with debugging
  generalTab.addEventListener('click', function() {
    switchTab(generalTab, generalTabBody);
  });
  
  // Load grammar data on grammar tab click
  grammarTab.addEventListener('click', function() {
    switchTab(grammarTab, grammarTabBody);
    
    // If the main.js is loaded, it will handle data loading via setupTabListeners
    if (typeof loadGrammarData === 'function' && typeof grammarData !== 'undefined' && !grammarData && !isLoading) {
      loadGrammarData();
    }
  });
  
  // Load vocabulary data on vocabulary tab click
  vocabularyTab.addEventListener('click', function() {
    switchTab(vocabularyTab, vocabularyTabBody);
    
    // If the main.js is loaded, it will handle data loading via setupTabListeners
    if (typeof loadVocabularyData === 'function' && typeof vocabularyData !== 'undefined' && !vocabularyData && !isLoading) {
      loadVocabularyData();
    }
  });
  
  fluencyTab.addEventListener('click', function() {
    switchTab(fluencyTab, fluencyTabBody);
  });
  
  // Initialize - make sure general tab is selected and others are hidden
  function initializeTabs() {
    console.log('Initializing tabs');
    // Force general tab to be selected
    generalTab.classList.add('tab-selected');
    
    // Hide all tab bodies explicitly
    grammarTabBody.style.display = 'none';
    vocabularyTabBody.style.display = 'none';
    fluencyTabBody.style.display = 'none';
    
    // Show only general tab body
    generalTabBody.style.display = 'block';
  }
  
  // Initialize tabs
  initializeTabs();
}); 