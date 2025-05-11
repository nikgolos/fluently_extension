// Main application script
// Connects all components and handles UI updates

// Global variables for storing data
let transcriptText = '';
let grammarData = null;
let vocabularyData = null;
let statsData = null;
let isLoading = false;

// Initialize the application
async function initApp() {
    showLoader();
    
    try {
        // Load transcript data from file
        transcriptText = await TestDataLoader.loadTranscript();
        
        // Add event listeners to tabs
        setupTabListeners();
        
        // Initialize grammar tab with data from API
        await loadGrammarData();
    } catch (error) {
        console.error('Error initializing app:', error);
        hideLoader();
    }
}

// Show loader overlay
function showLoader() {
    isLoading = true;
    
    // Create loader if it doesn't exist
    if (!document.querySelector('.loader-overlay')) {
        const loaderOverlay = document.createElement('div');
        loaderOverlay.className = 'loader-overlay';
        
        const loaderSpinner = document.createElement('div');
        loaderSpinner.className = 'loader-spinner';
        
        const loaderText = document.createElement('div');
        loaderText.className = 'loader-text';
        loaderText.textContent = 'Analyzing your English...';
        
        loaderOverlay.appendChild(loaderSpinner);
        loaderOverlay.appendChild(loaderText);
        document.body.appendChild(loaderOverlay);
    } else {
        document.querySelector('.loader-overlay').style.display = 'flex';
    }
}

// Hide loader overlay
function hideLoader() {
    isLoading = false;
    const loader = document.querySelector('.loader-overlay');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Setup tab event listeners
function setupTabListeners() {
    const grammarTab = document.querySelector('.grammar-tab');
    
    // Add click listener to grammar tab to ensure data is loaded
    grammarTab.addEventListener('click', async () => {
        if (!grammarData && !isLoading) {
            await loadGrammarData();
        }
    });
}

// Load grammar data from API
async function loadGrammarData() {
    try {
        // Show loading state
        showLoader();
        
        // Show loading indicator in grammar cards section
        const grammarCards = document.querySelector('.grammar-cards');
        grammarCards.innerHTML = '<div class="loading">Loading grammar analysis...</div>';
        
        // Get grammar data from API
        grammarData = await apiService.getGrammarAnalysis(transcriptText);
        
        // Process and display grammar data
        displayGrammarData(grammarData);
        
        // Update badge count
        const mistakesCount = grammarData.grammar.mistakes.length;
        updateGrammarBadgeCount(mistakesCount);
        
        // Update paragraph text based on mistakes count
        updateGrammarParagraph(mistakesCount);
        
        // Hide loader
        hideLoader();
    } catch (error) {
        console.error('Error loading grammar data:', error);
        const grammarCards = document.querySelector('.grammar-cards');
        grammarCards.innerHTML = '<div class="error">Error loading grammar analysis. Please try again.</div>';
        hideLoader();
    }
}

// Display grammar errors in the UI
function displayGrammarData(data) {
    // Get grammar cards container
    const grammarCards = document.querySelector('.grammar-cards');
    grammarCards.innerHTML = '';
    
    // Check if data is in expected format
    if (!data || !data.grammar || !data.grammar.mistakes || !Array.isArray(data.grammar.mistakes) || data.grammar.mistakes.length === 0) {
        grammarCards.innerHTML = '<div class="no-errors">No grammar mistakes found. Great job!</div>';
        return;
    }
    
    const { mistakes } = data.grammar;
    console.log(`Displaying ${mistakes.length} grammar mistakes`);
    
    // Group mistakes by category
    const categorizedMistakes = {};
    
    mistakes.forEach(mistake => {
        // Use 'Other' as default category if category is missing
        const category = mistake.category || 'Other';
        
        if (!categorizedMistakes[category]) {
            categorizedMistakes[category] = [];
        }
        categorizedMistakes[category].push(mistake);
    });
    
    // Log categories and counts for debugging
    Object.keys(categorizedMistakes).forEach(category => {
        console.log(`Category: ${category}, Count: ${categorizedMistakes[category].length}`);
    });
    
    // Create a card for each category
    Object.keys(categorizedMistakes).forEach(category => {
        const card = createGrammarCard(category, categorizedMistakes[category]);
        grammarCards.appendChild(card);
    });
}

// Create a grammar card for a specific category
function createGrammarCard(category, mistakes) {
    // Create card container
    const card = document.createElement('div');
    card.className = 'grammar-card';
    
    // Create text section
    const textSection = document.createElement('div');
    textSection.className = 'text-section';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'h-3-header';
    header.textContent = category;
    
    // Create text container
    const text = document.createElement('div');
    text.className = 'text';
    
    // Create description
    const description = document.createElement('div');
    description.className = 'your-errors-in-using-verb-tenses-or-forms';
    description.textContent = `Your errors in ${category.toLowerCase()}:`;
    
    // Append elements
    text.appendChild(description);
    textSection.appendChild(header);
    textSection.appendChild(text);
    card.appendChild(textSection);
    
    // Create grammar errors container
    const errorsContainer = document.createElement('div');
    errorsContainer.className = 'grammar-errors';
    
    // Add each mistake
    mistakes.forEach(mistake => {
        const errorElement = createGrammarError(mistake);
        errorsContainer.appendChild(errorElement);
    });
    
    card.appendChild(errorsContainer);
    
    return card;
}

// Create a single grammar error element
function createGrammarError(mistake) {
    // Create error container
    const errorContainer = document.createElement('div');
    errorContainer.className = 'grammar-error';
    
    // Create text element
    const textElement = document.createElement('div');
    textElement.className = 'grammar-error-text';
    
    // Compare error and correct strings to highlight differences
    const comparisonHTML = TextComparator.compareStrings(mistake.error, mistake.correct);
    textElement.innerHTML = comparisonHTML;
    
    // Create info icon with tooltip
    const infoCircle = document.createElement('div');
    infoCircle.className = 'info-circle-fill-1';
    infoCircle.innerHTML = '<img class="group" src="src/group0.svg" />';
    
    // Add tooltip data attribute for custom tooltip
    infoCircle.dataset.tooltip = mistake.explanation;
    
    // Append elements
    errorContainer.appendChild(textElement);
    errorContainer.appendChild(infoCircle);
    
    return errorContainer;
}

// Update grammar badge count
function updateGrammarBadgeCount(count) {
    const badge = document.querySelector('.grammar-tab .badge-green .badge-label');
    if (badge) {
        badge.textContent = count;
        
        // Update badge color based on count
        const badgeContainer = badge.parentElement;
        if (count > 0) {
            badgeContainer.classList.remove('badge-green');
            badgeContainer.classList.add('badge-red');
        } else {
            badgeContainer.classList.remove('badge-red');
            badgeContainer.classList.add('badge-green');
        }
    }
}

// Update the grammar paragraph text based on mistakes count
function updateGrammarParagraph(mistakesCount) {
    const paragraph = document.querySelector('.grammar-header .paragraph');
    if (paragraph) {
        if (mistakesCount === 0) {
            paragraph.textContent = 'Great job! No grammar errors found in your speech.';
        } else if (mistakesCount <= 2) {
            paragraph.textContent = `Found ${mistakesCount} minor grammar issues. Fix them to improve your score.`;
        } else {
            paragraph.textContent = `Fix your ${mistakesCount} grammar mistakes to improve your score.`;
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp); 