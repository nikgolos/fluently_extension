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
        // Get transcript ID from the URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const transcriptId = urlParams.get('id');
        
        if (!transcriptId) {
            throw new Error('No transcript ID provided in URL');
        }
        
        // Load transcript data from chrome storage
        transcriptText = await loadTranscriptFromStorage(transcriptId);
        
        if (!transcriptText) {
            throw new Error('Failed to load transcript data');
        }
        
        console.log('Loaded transcript:', transcriptText.substring(0, 100) + '...');
        
        // Update meeting info (date and time)
        updateMeetingInfo(transcriptId);
        
        // Add event listeners to tabs
        setupTabListeners();
        
        // Initialize grammar tab with data from API
        await loadGrammarData();
        hideLoader();
    } catch (error) {
        console.error('Error initializing app:', error);
        hideLoader();
        
        // Show error message
        document.body.innerHTML += `
            <div style="text-align: center; margin: 2rem; color: red;">
                Error loading transcript: ${error.message}
            </div>
        `;
    }
}

// Load transcript from Chrome storage
async function loadTranscriptFromStorage(transcriptId) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(null, function(result) {
            if (chrome.runtime.lastError) {
                return reject(new Error('Error accessing storage: ' + chrome.runtime.lastError.message));
            }
            
            console.log('Chrome storage contents:', result);
            
            // Try to find the transcript in result.transcripts (object format)
            if (result.transcripts) {
                // Check if transcripts is an object with ID as keys
                if (typeof result.transcripts === 'object' && !Array.isArray(result.transcripts)) {
                    const transcript = result.transcripts[transcriptId];
                    if (transcript) {
                        console.log('Found transcript in transcripts object:', transcript);
                        return resolve(transcript.text || '');
                    }
                } 
                // Check if transcripts is an array
                else if (Array.isArray(result.transcripts)) {
                    const transcript = result.transcripts.find(t => t.id === transcriptId || t.sessionId === transcriptId);
                    if (transcript) {
                        console.log('Found transcript in transcripts array:', transcript);
                        return resolve(transcript.text || '');
                    }
                }
            }
            
            // Try to find the transcript directly at the root level
            if (result[transcriptId]) {
                console.log('Found transcript at root level:', result[transcriptId]);
                return resolve(result[transcriptId].text || result[transcriptId]);
            }
            
            // If we get here, we haven't found the transcript yet
            // Let's search all storage for anything that might be our transcript
            for (const key in result) {
                if (key.includes(transcriptId) || (typeof result[key] === 'object' && result[key] && result[key].id === transcriptId)) {
                    console.log(`Found potential transcript match in key ${key}:`, result[key]);
                    if (result[key].text) {
                        return resolve(result[key].text);
                    } else if (typeof result[key] === 'string') {
                        return resolve(result[key]);
                    }
                }
            }
            
            return reject(new Error(`Transcript with ID ${transcriptId} not found in storage`));
        });
    });
}

// Update meeting info with date and time from transcript ID or storage
function updateMeetingInfo(transcriptId) {
    try {
        // Try to parse date from transcript ID (if it contains a timestamp)
        let meetingDate;
        
        if (transcriptId.includes('-')) {
            const timestamp = parseInt(transcriptId.split('-')[0]);
            if (!isNaN(timestamp)) {
                meetingDate = new Date(timestamp);
            }
        }
        
        // If we couldn't parse from ID, use current date
        if (!meetingDate || isNaN(meetingDate.getTime())) {
            meetingDate = new Date();
        }
        
        // Format the date and time
        const options = { 
            month: 'numeric', 
            day: 'numeric', 
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        };
        const formattedDateTime = meetingDate.toLocaleDateString('en-US', options);
        
        // Update the meeting info in the UI
        const meetingInfoElement = document.querySelector('.meeting-info');
        if (meetingInfoElement) {
            meetingInfoElement.textContent = formattedDateTime;
        }
    } catch (error) {
        console.error('Error updating meeting info:', error);
    }
}

// Remove timestamps in [HH:MM:SS] format from text
function stripTimestamps(text) {
    return text.replace(/\[\d{2}:\d{2}:\d{2}\]\s?/g, '');
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
    const vocabularyTab = document.querySelector('.vocabulary-tab');
    
    // Add click listener to grammar tab to ensure data is loaded
    grammarTab.addEventListener('click', async () => {
        if (!grammarData && !isLoading) {
            await loadGrammarData();
        }
    });
    
    // Add click listener to vocabulary tab to ensure data is loaded
    vocabularyTab.addEventListener('click', async () => {
        if (!vocabularyData && !isLoading) {
            await loadVocabularyData();
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
        
        // Strip timestamps before sending to API
        const cleanText = stripTimestamps(transcriptText);
        
        // Get grammar data from API
        grammarData = await apiService.getGrammarAnalysis(cleanText);
        
        // Process and display grammar data
        displayGrammarData(grammarData);
        
        // Update badge count
        const mistakesCount = grammarData.grammar && grammarData.grammar.mistakes ? grammarData.grammar.mistakes.length : 0;
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
    infoCircle.innerHTML = '<img class="group" src="post-meeting/src/group0.svg" />';
    
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
            paragraph.textContent = 'Great job! No grammar mistakes found in your speech.';
        } else {
            paragraph.textContent = 'Fix your mistakes with Articles and Verb Forms to improve your score.';
        }
    }
}

// Load vocabulary data from API
async function loadVocabularyData() {
    try {
        // Show loading state
        showLoader();
        
        // Show loading indicator in vocabulary cards section
        const vocabularyCards = document.querySelector('.vocabulary-cards');
        vocabularyCards.innerHTML = '<div class="loading">Loading vocabulary analysis...</div>';
        
        // Strip timestamps before sending to API
        const cleanText = stripTimestamps(transcriptText);
        
        // Get vocabulary data from API
        vocabularyData = await apiService.getVocabularyAnalysis(cleanText);
        
        // Process and display vocabulary data
        displayVocabularyData(vocabularyData);
        
        // Update badge count
        const suggestionsCount = countVocabularySuggestions(vocabularyData);
        updateVocabularyBadgeCount(suggestionsCount);
        
        // Update paragraph text based on suggestions count
        updateVocabularyParagraph(suggestionsCount);
        
        // Hide loader
        hideLoader();
    } catch (error) {
        console.error('Error loading vocabulary data:', error);
        const vocabularyCards = document.querySelector('.vocabulary-cards');
        vocabularyCards.innerHTML = '<div class="error">Error loading vocabulary analysis. Please try again.</div>';
        hideLoader();
    }
}

// Count total vocabulary suggestions
function countVocabularySuggestions(data) {
    if (!data || !data.vocabulary) return 0;
    
    const synonymsCount = data.vocabulary.synonyms ? data.vocabulary.synonyms.length : 0;
    const rephrasingCount = data.vocabulary.rephrasing ? data.vocabulary.rephrasing.length : 0;
    
    return synonymsCount + rephrasingCount;
}

// Display vocabulary data in the UI
function displayVocabularyData(data) {
    // Get vocabulary cards container
    const vocabularyCards = document.querySelector('.vocabulary-cards');
    vocabularyCards.innerHTML = '';
    
    console.log('Processing vocabulary data:', JSON.stringify(data));
    
    // Check if data is in expected format
    if (!data || !data.vocabulary) {
        console.error('Invalid vocabulary data structure, data or data.vocabulary is missing');
        vocabularyCards.innerHTML = '<div class="no-suggestions">No vocabulary suggestions available.</div>';
        return;
    }
    
    // Display synonyms if available
    if (data.vocabulary.synonyms && data.vocabulary.synonyms.length > 0) {
        console.log(`Creating synonyms section with ${data.vocabulary.synonyms.length} items`);
        const synonymsSection = createSynonymsSection(data.vocabulary.synonyms);
        vocabularyCards.appendChild(synonymsSection);
    } else {
        console.log('No synonyms found in data');
    }
    
    // Display rephrasing if available
    if (data.vocabulary.rephrasing && data.vocabulary.rephrasing.length > 0) {
        console.log(`Creating rephrasing section with ${data.vocabulary.rephrasing.length} items`);
        const rephrasingSection = createRephrasingSection(data.vocabulary.rephrasing);
        vocabularyCards.appendChild(rephrasingSection);
    } else {
        console.log('No rephrasing found in data');
    }
    
    // If no suggestions in either category
    if ((!data.vocabulary.synonyms || data.vocabulary.synonyms.length === 0) && 
        (!data.vocabulary.rephrasing || data.vocabulary.rephrasing.length === 0)) {
        console.warn('No vocabulary suggestions found in data');
        vocabularyCards.innerHTML = '<div class="no-suggestions">Great job! Your vocabulary usage is excellent.</div>';
    }
}

// Create the synonyms section
function createSynonymsSection(synonyms) {
    // Create section container
    const section = document.createElement('div');
    section.className = 'synonyms';
    
    // Create header section
    const textSection = document.createElement('div');
    textSection.className = 'text-section';
    
    // Create header text
    const header = document.createElement('div');
    header.className = 'h-3-header';
    header.textContent = 'Vocabulary Elevation';
    
    // Create description
    const text = document.createElement('div');
    text.className = 'text';
    
    const description = document.createElement('div');
    description.className = 'stronger-alternatives-to-the-words-you-used';
    description.textContent = 'Stronger alternatives to the words you used';
    
    // Append description elements
    text.appendChild(description);
    textSection.appendChild(header);
    textSection.appendChild(text);
    section.appendChild(textSection);
    
    // Create synonyms cards container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'synonyms-cards';
    
    // Add each synonym suggestion
    synonyms.forEach(synonym => {
        const card = createSynonymCard(synonym);
        cardsContainer.appendChild(card);
    });
    
    section.appendChild(cardsContainer);
    
    return section;
}

// Create a synonym card
function createSynonymCard(synonym) {
    try {
        console.log('Creating synonym card for:', JSON.stringify(synonym));
        
        // Create card container
        const card = document.createElement('div');
        card.className = 'synonyms-card';
        
        // Create card block
        const cardBlock = document.createElement('div');
        cardBlock.className = 'synonyms-card-block';
        
        // Create original text with highlighted word to replace
        const originalText = document.createElement('div');
        originalText.className = 'a-small-company-but-growing-fast';
        
        // Format the original text with the word to replace highlighted in red
        let originalHTML = '';
        
        if (synonym.original && synonym.to_replace && synonym.original.includes(synonym.to_replace)) {
            // Standard case - we can split the text
            const parts = synonym.original.split(synonym.to_replace);
            
            // First part with opening quote
            originalHTML += '<span><span class="a-small-company-but-growing-fast-span">«';
            originalHTML += parts[0];
            
            // Highlighted word to replace
            originalHTML += '<span class="a-small-company-but-growing-fast-span2">';
            originalHTML += synonym.to_replace;
            originalHTML += '</span>';
            
            // Last part with closing quote
            originalHTML += '<span class="a-small-company-but-growing-fast-span">';
            originalHTML += parts[1] + '»';
            originalHTML += '</span></span>';
        } else {
            // Fallback case - just show the whole text
            console.warn('Could not highlight to_replace in original:', synonym.original, synonym.to_replace);
            originalHTML += '<span><span class="a-small-company-but-growing-fast-span">«';
            originalHTML += synonym.original;
            originalHTML += '»</span></span>';
        }
        
        originalText.innerHTML = originalHTML;
        
        // Create words container
        const wordsContainer = document.createElement('div');
        wordsContainer.className = 'words';
        
        // Add each suggestion word
        if (synonym.suggestions && Array.isArray(synonym.suggestions)) {
            synonym.suggestions.forEach(suggestion => {
                const wordDiv = document.createElement('div');
                wordDiv.className = 'word';
                
                const wordText = document.createElement('div');
                wordText.className = 'boutique'; // Reusing existing class for styling
                wordText.textContent = suggestion;
                
                wordDiv.appendChild(wordText);
                wordsContainer.appendChild(wordDiv);
            });
        } else {
            console.warn('No suggestions array found for synonym:', synonym);
        }
        
        // Append elements to card block
        cardBlock.appendChild(originalText);
        cardBlock.appendChild(wordsContainer);
        card.appendChild(cardBlock);
        
        // Create info icon with tooltip
        const infoCircle = document.createElement('div');
        infoCircle.className = 'info-circle-fill-1';
        infoCircle.innerHTML = '<img class="group" src="post-meeting/src/group0.svg"/>';
        infoCircle.dataset.tooltip = synonym.explanation || 'This alternative vocabulary will make your speech sound more professional.';
        
        card.appendChild(infoCircle);
        
        return card;
    } catch (error) {
        console.error('Error creating synonym card:', error, synonym);
        // Create a simple fallback card
        const fallbackCard = document.createElement('div');
        fallbackCard.className = 'synonyms-card';
        fallbackCard.innerHTML = `<div class="error">Error displaying vocabulary suggestion</div>`;
        return fallbackCard;
    }
}

// Create rephrasing section
function createRephrasingSection(rephrasings) {
    // Create section container
    const section = document.createElement('div');
    section.className = 'synonyms'; // Reuse existing styling
    
    // Create header section
    const textSection = document.createElement('div');
    textSection.className = 'text-section';
    
    // Create header text
    const header = document.createElement('div');
    header.className = 'h-3-header';
    header.textContent = 'Rephrasing';
    
    // Create description
    const text = document.createElement('div');
    text.className = 'text';
    
    const description = document.createElement('div');
    description.className = 'stronger-alternatives-to-the-words-you-used';
    description.textContent = 'Native-like alternatives to your phrases';
    
    // Append description elements
    text.appendChild(description);
    textSection.appendChild(header);
    textSection.appendChild(text);
    section.appendChild(textSection);
    
    // Create rephrasing cards container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'synonyms-cards';
    
    // Add each rephrasing suggestion
    rephrasings.forEach(rephrasing => {
        const card = createRephrasingCard(rephrasing);
        cardsContainer.appendChild(card);
    });
    
    section.appendChild(cardsContainer);
    
    return section;
}

// Create a rephrasing card
function createRephrasingCard(rephrasing) {
    try {
        console.log('Creating rephrasing card for:', JSON.stringify(rephrasing));
        
        // Create card container
        const card = document.createElement('div');
        card.className = 'synonyms-card';
        
        // Create card block
        const cardBlock = document.createElement('div');
        cardBlock.className = 'synonyms-card-block';
        
        // Create text container for "You said"
        const youSaidContainer = document.createElement('div');
        youSaidContainer.className = 'you-said';
        
        const youSaidLabel = document.createElement('div');
        youSaidLabel.className = 'rephrasing-label';
        youSaidLabel.textContent = 'You said:';
        
        const originalText = document.createElement('div');
        originalText.className = 'rephrasing-text';
        originalText.textContent = rephrasing.original || 'No original text provided';
        
        youSaidContainer.appendChild(youSaidLabel);
        youSaidContainer.appendChild(originalText);
        
        // Create text container for "Better to say"
        const betterToSayContainer = document.createElement('div');
        betterToSayContainer.className = 'better-to-say';
        
        const betterToSayLabel = document.createElement('div');
        betterToSayLabel.className = 'rephrasing-label';
        betterToSayLabel.textContent = 'Better to say:';
        
        const nativeText = document.createElement('div');
        nativeText.className = 'rephrasing-text native-text';
        nativeText.textContent = rephrasing.native_version || 'No native version provided';
        
        betterToSayContainer.appendChild(betterToSayLabel);
        betterToSayContainer.appendChild(nativeText);
        
        // Append elements to card block
        cardBlock.appendChild(youSaidContainer);
        cardBlock.appendChild(betterToSayContainer);
        card.appendChild(cardBlock);
        
        // Create info icon with tooltip
        const infoCircle = document.createElement('div');
        infoCircle.className = 'info-circle-fill-1';
        infoCircle.innerHTML = '<img class="group" src="post-meeting/src/group0.svg"/>';
        infoCircle.dataset.tooltip = rephrasing.explanation || 'This rephrasing sounds more natural to native speakers.';
        
        card.appendChild(infoCircle);
        
        return card;
    } catch (error) {
        console.error('Error creating rephrasing card:', error, rephrasing);
        // Create a simple fallback card
        const fallbackCard = document.createElement('div');
        fallbackCard.className = 'synonyms-card';
        fallbackCard.innerHTML = `<div class="error">Error displaying rephrasing suggestion</div>`;
        return fallbackCard;
    }
}

// Update vocabulary badge count
function updateVocabularyBadgeCount(count) {
    const badge = document.querySelector('.vocabulary-tab .badge-red .badge-label');
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

// Update the vocabulary paragraph text
function updateVocabularyParagraph(suggestionsCount) {
    const paragraph = document.querySelector('.vocabulary-header .paragraph');
    if (paragraph) {
        if (suggestionsCount === 0) {
            paragraph.textContent = 'Great job! Your vocabulary usage is excellent.';
        } else if (suggestionsCount <= 3) {
            paragraph.textContent = `We found ${suggestionsCount} opportunities to enhance your vocabulary.`;
        } else {
            paragraph.textContent = `Elevate your language with these ${suggestionsCount} vocabulary improvements.`;
        }
    }
}

// Setup button handlers
function setupButtonHandlers() {
    const shareButton = document.querySelector('.share-button');
    const returnButton = document.querySelector('.return-button');
    
    // Share button handler
    if (shareButton) {
        shareButton.addEventListener('click', () => {
            // Create a text summary to share
            const summaryText = createShareableSummary();
            
            // Copy to clipboard
            copyToClipboard(summaryText)
                .then(() => alert('Stats copied to clipboard!'))
                .catch(err => console.error('Failed to copy:', err));
        });
    }
    
    // Return to Google Meet button handler
    if (returnButton) {
        returnButton.addEventListener('click', () => {
            // Try to get the meeting ID from chrome storage or URL
            chrome.storage.local.get(['last_meeting_url'], function(result) {
                const meetingUrl = result.last_meeting_url;
                
                if (meetingUrl && meetingUrl.includes('meet.google.com')) {
                    // Open the meeting URL in the current tab
                    window.location.href = meetingUrl;
                } else {
                    // If we don't have a meeting URL, just go to Google Meet
                    window.location.href = 'https://meet.google.com/';
                }
            });
        });
    }
}

// Create shareable summary text
function createShareableSummary() {
    // Get the meeting info
    const meetingInfo = document.querySelector('.meeting-info').textContent;
    
    // Create the summary text
    let summary = `English Analysis from Fluently - ${meetingInfo}\n\n`;
    
    // Check for grammar mistakes
    const grammarBadge = document.querySelector('.grammar-tab .badge-label');
    const grammarCount = grammarBadge ? parseInt(grammarBadge.textContent) : 0;
    summary += `Grammar Mistakes: ${grammarCount}\n`;
    
    // Check for vocabulary suggestions
    const vocabBadge = document.querySelector('.vocabulary-tab .badge-label');
    const vocabCount = vocabBadge ? parseInt(vocabBadge.textContent) : 0;
    summary += `Vocabulary Suggestions: ${vocabCount}\n`;
    
    // Add fluency data if we have it
    const uselessWords = document.querySelector('.fluency-tab-body .h-3-header');
    if (uselessWords) {
        summary += `${uselessWords.textContent}\n`;
    }
    
    summary += `\nGenerated by Fluently - Your AI English Coach for Google Meet`;
    
    return summary;
}

// Helper function to copy text to clipboard
async function copyToClipboard(text) {
    if (navigator.clipboard) {
        return navigator.clipboard.writeText(text);
    } else {
        // Fallback for browsers without clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (!successful) {
                throw new Error('Failed to copy text');
            }
        } catch (err) {
            document.body.removeChild(textArea);
            throw err;
        }
    }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupButtonHandlers();
}); 