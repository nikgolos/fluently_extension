// Main application script
// Connects all components and handles UI updates

// Global variables for storing data
let transcriptText = '';
let transcriptId = null; // Store transcriptId globally
let grammarData = null;
let vocabularyData = null;
let statsData = null;
let frontendStats = null; // Store frontend calculated stats
let isLoading = false;

// Function to load and inline the score SVG, adding an ID to the dynamic path
async function loadAndInlineScoreSVG() {
    try {
        const response = await fetch('post-meeting/src/background0.svg');
        if (!response.ok) {
            throw new Error(`Failed to fetch SVG: ${response.statusText}`);
        }
        const svgText = await response.text();
        const container = document.getElementById('scoreTriangleContainer');

        if (container) {
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
            const paths = svgDoc.getElementsByTagName('path');
            let targetPathFound = false;
            for (let path of paths) {
                if (path.getAttribute('d') === "M64.2834 98.2175L82.9834 26.8429L151.733 125.168L64.2834 98.2175Z") {
                    path.setAttribute('id', 'dynamicScoreTriangle');
                    targetPathFound = true;
                    console.log("Target path for dynamicScoreTriangle ID'd.");
                    break;
                }
            }

            if (!targetPathFound) {
                console.warn("Target path for dynamicScoreTriangle not found via specific 'd' attribute. SVG might have changed or 'd' is different.");
                // As a fallback, just insert the original SVG text if path wasn't ID'd
                // This won't make the triangle dynamic but prevents breaking the display
                container.innerHTML = svgText;
            } else {
                const serializer = new XMLSerializer();
                container.innerHTML = serializer.serializeToString(svgDoc.documentElement);
            }
            console.log("Score SVG processed and inlined.");
        } else {
            console.error('scoreTriangleContainer div not found in HTML.');
        }
    } catch (error) {
        console.error('Error loading or inlining SVG:', error);
        // Optionally, provide a fallback visual or message in the container
        const container = document.getElementById('scoreTriangleContainer');
        if (container) {
            container.innerHTML = '<p style="color:red; text-align:center;">Error loading score visual.</p>';
        }
    }
}

// Initialize the application
async function initApp() {
    try {
        // Get transcript ID from the URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        transcriptId = urlParams.get('id'); // Assign to global transcriptId
        
        if (!transcriptId) {
            throw new Error('No transcript ID provided in URL');
        }
        
        // Iniline Score SVG first
        await loadAndInlineScoreSVG();
        
        // Load transcript data from chrome storage
        const transcriptData = await loadTranscriptFromStorage(transcriptId);
        
        if (!transcriptData || typeof transcriptData.text !== 'string') {
            throw new Error('Failed to load transcript data or text is missing/invalid');
        }
        transcriptText = transcriptData.text; // Assign global transcriptText
        
        console.log('Loaded transcript text:', transcriptText.substring(0, 100) + '...');
        console.log('Transcript Formatted Date from storage (for meeting info):', transcriptData.formattedDate);

        // Update meeting info (date and time)
        updateMeetingInfo(transcriptData.formattedDate);
        
        // Add event listeners to tabs
        setupTabListeners();
        
        // --- DATA LOADING AND CACHING LOGIC ---
        console.log("Starting data loading and caching logic for transcriptId:", transcriptId);

        // 1. Fetch initial stored data BEFORE frontend calculations
        let initialStoredDataForTranscript = null;
        await new Promise(resolve => {
            chrome.storage.local.get(['transcript_stats'], (result) => {
                const allStats = result.transcript_stats || {};
                if (allStats[transcriptId]) {
                    initialStoredDataForTranscript = { ...allStats[transcriptId] }; // Shallow copy
                } 
                resolve();
            });
        });

        // 2. Calculate and display frontend-based stats (including Fluency)
        // This might modify storage and sets global `frontendStats`
        await loadAndDisplayFrontendStats();

        // 3. Determine if all necessary API-derived data was present in `initialStoredDataForTranscript`
        let wasApiDataInitiallyComplete = false;
        if (initialStoredDataForTranscript &&
            initialStoredDataForTranscript.api_englishScore !== undefined &&
            initialStoredDataForTranscript.api_fluencyScore !== undefined && // Though often derived from frontend, check if API version was stored
            initialStoredDataForTranscript.api_grammarScore !== undefined &&
            initialStoredDataForTranscript.api_vocabularyScore !== undefined &&
            initialStoredDataForTranscript.api_feedback !== undefined) {
            // Note: we're not requiring api_summary anymore, only checking for api_feedback
            wasApiDataInitiallyComplete = true;
        }

        let wasGrammarDataInitiallyComplete = false;
        if (initialStoredDataForTranscript && initialStoredDataForTranscript.grammarData) {
            wasGrammarDataInitiallyComplete = true;
        }

        let wasVocabularyDataInitiallyComplete = false;
        if (initialStoredDataForTranscript && initialStoredDataForTranscript.vocabularyData) {
            wasVocabularyDataInitiallyComplete = true;
        }

        // 4. Load General Stats (English Score, etc.)
        if (wasApiDataInitiallyComplete) {
            statsData = {
                general_score: initialStoredDataForTranscript.api_englishScore,
                english_score: initialStoredDataForTranscript.api_englishScore,
                fluency_score: initialStoredDataForTranscript.api_fluencyScore, // Use API stored one first
                grammar_score: initialStoredDataForTranscript.api_grammarScore,
                vocabulary_score: initialStoredDataForTranscript.api_vocabularyScore,
                summary: initialStoredDataForTranscript.api_summary || initialStoredDataForTranscript.api_feedback, // Use feedback as fallback
                feedback: initialStoredDataForTranscript.api_feedback
            };
            // If frontend stats has a more up-to-date fluency score, prefer that for display
            if (frontendStats && frontendStats.fluency_score !== undefined) {
                statsData.fluency_score = frontendStats.fluency_score;
            }
            displayGeneralStats(statsData);
        } else {
            await loadGeneralStats(); // This will fetch from API and save (merging)
        }

        // 5. Load Grammar Data
        if (wasGrammarDataInitiallyComplete) {
            grammarData = initialStoredDataForTranscript.grammarData;
            displayGrammarData(grammarData);
        } else {
            await loadGrammarData(); // Will fetch and save (merging)
        }

        // 6. Load Vocabulary Data
        if (wasVocabularyDataInitiallyComplete) {
            vocabularyData = initialStoredDataForTranscript.vocabularyData;
            displayVocabularyData(vocabularyData);
            const suggestionsCount = countVocabularySuggestions(vocabularyData);
            updateVocabularyBadgeCount(suggestionsCount);
            updateVocabularyParagraph(suggestionsCount);
        } else {
            await loadVocabularyData(); // Will fetch and save (merging)
        }
        
        // 7. Final re-save if data was initially complete, to ensure frontend calculations don't wipe API parts.
        // This merges the critical API-derived data back if `loadAndDisplayFrontendStats` overwrote parts of the record.
        if (wasApiDataInitiallyComplete || wasGrammarDataInitiallyComplete || wasVocabularyDataInitiallyComplete) {
            await new Promise(resolve => {
                chrome.storage.local.get(['transcript_stats'], (result) => {
                    const allStatsForSave = result.transcript_stats || {};
                    const currentDataForId = allStatsForSave[transcriptId] || {};
                    let updatedData = { ...currentDataForId };

                    if (wasApiDataInitiallyComplete) {
                        updatedData.api_englishScore = initialStoredDataForTranscript.api_englishScore;
                        updatedData.api_fluencyScore = initialStoredDataForTranscript.api_fluencyScore;
                        updatedData.api_grammarScore = initialStoredDataForTranscript.api_grammarScore;
                        updatedData.api_vocabularyScore = initialStoredDataForTranscript.api_vocabularyScore;
                        if (initialStoredDataForTranscript.api_summary) {
                            updatedData.api_summary = initialStoredDataForTranscript.api_summary;
                        }
                        updatedData.api_feedback = initialStoredDataForTranscript.api_feedback;
                        
                        // Preserve additional fluency stats if they exist
                        if (initialStoredDataForTranscript.garbage_words) {
                            updatedData.garbage_words = initialStoredDataForTranscript.garbage_words;
                        }
                        if (initialStoredDataForTranscript.total_words !== undefined) {
                            updatedData.total_words = initialStoredDataForTranscript.total_words;
                        }
                        if (initialStoredDataForTranscript.words_per_minute !== undefined) {
                            updatedData.words_per_minute = initialStoredDataForTranscript.words_per_minute;
                        }
                        if (initialStoredDataForTranscript.speaking_time_seconds !== undefined) {
                            updatedData.speaking_time_seconds = initialStoredDataForTranscript.speaking_time_seconds;
                        }
                    }
                    if (wasGrammarDataInitiallyComplete) {
                        updatedData.grammarData = initialStoredDataForTranscript.grammarData;
                    }
                    if (wasVocabularyDataInitiallyComplete) {
                        updatedData.vocabularyData = initialStoredDataForTranscript.vocabularyData;
                    }
                    // Also ensure frontend stats that are part of the primary display are there
                    if (frontendStats && frontendStats.fluency_score !== undefined) {
                         updatedData.fluencyScore = frontendStats.fluency_score; // This might be the same as api_fluencyScore or more recent
                    }

                    allStatsForSave[transcriptId] = updatedData;
                    chrome.storage.local.set({ transcript_stats: allStatsForSave }, () => {
                        resolve();
                    });
                });
            });
        }
        // --- END OF DATA LOADING AND CACHING LOGIC ---
        
    } catch (error) {
        console.error('Error initializing app:', error);
        
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
        chrome.storage.local.get([transcriptId, 'transcripts'], function(result) { // More targeted get
            if (chrome.runtime.lastError) {
                return reject(new Error('Error accessing storage: ' + chrome.runtime.lastError.message));
            }
            
            console.log('Chrome storage contents for loadTranscriptFromStorage:', result);
            
            let transcriptObject = null;

            // 1. Check directly by transcriptId key
            if (result[transcriptId] && typeof result[transcriptId] === 'object') {
                transcriptObject = result[transcriptId];
                console.log('Found transcript directly by ID:', transcriptObject);
            }
            // 2. Check within a 'transcripts' object store if not found directly
            else if (result.transcripts && typeof result.transcripts === 'object') {
                if (result.transcripts[transcriptId]) {
                    transcriptObject = result.transcripts[transcriptId];
                    console.log('Found transcript in result.transcripts object store:', transcriptObject);
                } else {
                    // Fallback: If result.transcripts is an array (older format?)
                    if (Array.isArray(result.transcripts)) {
                        const foundInArray = result.transcripts.find(t => t.id === transcriptId || t.sessionId === transcriptId);
                        if (foundInArray) {
                            transcriptObject = foundInArray;
                            console.log('Found transcript in result.transcripts array:', transcriptObject);
                        }
                    }
                }
            }

            if (transcriptObject && typeof transcriptObject.text !== 'undefined') {
                // Ensure formattedDate is present, even if null
                if (typeof transcriptObject.formattedDate === 'undefined') {
                    transcriptObject.formattedDate = null;
                }
                resolve(transcriptObject);
            } else if (typeof result[transcriptId] === 'string') { // Fallback for old format where ID maps directly to text
                 console.warn('Transcript was a string, creating object with null formattedDate');
                 resolve({ text: result[transcriptId], formattedDate: null, id: transcriptId });
            }else {
                reject(new Error(`Transcript with ID ${transcriptId} not found or has no text field.`));
            }
        });
    });
}

// Update meeting info with date and time from transcript ID or storage
function updateMeetingInfo(formattedDateFromStorage) { // transcriptId is no longer the primary source
    try {
        let displayDate = 'Meeting Date & Time'; // Default text
        let meetingDate;

        if (formattedDateFromStorage) {
            console.log('Using formattedDate from storage:', formattedDateFromStorage);
            // Try to parse the date from storage
            try {
                // Try to parse the date (handles various date formats)
                meetingDate = new Date(formattedDateFromStorage);
                if (isNaN(meetingDate.getTime())) {
                    // If we couldn't parse it as a date, try to extract date components from a string format
                    const dateMatch = formattedDateFromStorage.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                    if (dateMatch) {
                        meetingDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
                    } else {
                        throw new Error('Unparseable date format');
                    }
                }
            } catch (error) {
                console.warn('Could not parse storage date, using fallback logic:', error);
                meetingDate = null;
            }
        }
        
        // Fallback logic if formattedDateFromStorage is not parseable or not available
        if (!meetingDate || isNaN(meetingDate.getTime())) {
            console.warn('No valid date from storage, attempting fallback for meeting info.');
            const urlParams = new URLSearchParams(window.location.search);
            const currentTranscriptId = urlParams.get('id');
            
            if (currentTranscriptId && currentTranscriptId.includes('-')) {
                const timestamp = parseInt(currentTranscriptId.split('-')[0]);
                if (!isNaN(timestamp)) {
                    meetingDate = new Date(timestamp);
                }
            }
            if (!meetingDate || isNaN(meetingDate.getTime())) {
                meetingDate = new Date(); // Ultimate fallback to current time
            }
        }
        
        // Always format in the "5 May 2025 at 6:25 PM" format
        const day = meetingDate.getDate();
        const month = meetingDate.toLocaleString('en-US', { month: 'long' });
        const year = meetingDate.getFullYear();
        const hour = meetingDate.getHours() % 12 || 12;
        const minute = meetingDate.getMinutes().toString().padStart(2, '0');
        const ampm = meetingDate.getHours() >= 12 ? 'PM' : 'AM';
        
        displayDate = `${day} ${month} ${year} at ${hour}:${minute} ${ampm}`;
        console.log('Formatted meeting info display date:', displayDate);
        
        const meetingInfoElement = document.querySelector('.meeting-info');
        if (meetingInfoElement) {
            meetingInfoElement.textContent = displayDate;
        }
    } catch (error) {
        console.error('Error updating meeting info:', error);
        const meetingInfoElement = document.querySelector('.meeting-info');
        if (meetingInfoElement) {
            meetingInfoElement.textContent = 'Meeting Date & Time Unavailable'; // Error state text
        }
    }
}

// Function to preprocess transcript text by removing timestamps (same as in content.js)
function preprocessTranscriptText(text) {
  if (!text) return text;
  
  // First, handle consecutive timestamps by replacing them with periods
  // This matches two timestamps in a row (E followed by S, or S followed by E)
  let processedText = text.replace(/\[E:\d+(?:\.\d+)?s\]\s*\[S:\d+(?:\.\d+)?s\]/g, '.');
  
  // Remove any remaining individual timestamps
  processedText = processedText.replace(/\[(?:S|E):\d+(?:\.\d+)?s\]/g, '');
  
  // Clean up extra spaces and normalize spacing around periods
  processedText = processedText.replace(/\s*\.\s*/g, '. ');
  processedText = processedText.replace(/\s+/g, ' ').trim();
  
  return processedText;
}

// Show loader in a specific tab body
function showTabLoader(tabBodySelector) {
    isLoading = true;
    
    const tabBody = document.querySelector(tabBodySelector);
    if (!tabBody) return;
    
    // Create loader if it doesn't exist in this tab
    if (!tabBody.querySelector('.tab-loader')) {
        const loaderContainer = document.createElement('div');
        loaderContainer.className = 'tab-loader';
        loaderContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; width: 100%;';
        
        const loaderSpinner = document.createElement('div');
        loaderSpinner.className = 'loader-spinner';
        loaderSpinner.style.cssText = 'width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;';
        
        const loaderText = document.createElement('div');
        loaderText.className = 'loader-text';
        loaderText.textContent = 'Analyzing...';
        loaderText.style.cssText = 'font-size: 18px; color: #333; font-family: "Google Sans", "Roboto", sans-serif; font-weight: 500;';
        
        loaderContainer.appendChild(loaderSpinner);
        loaderContainer.appendChild(loaderText);
        tabBody.appendChild(loaderContainer);
    } else {
        tabBody.querySelector('.tab-loader').style.display = 'flex';
    }
}

// Hide loader in a specific tab body
function hideTabLoader(tabBodySelector) {
    const tabBody = document.querySelector(tabBodySelector);
    if (!tabBody) return;
    
    const loader = tabBody.querySelector('.tab-loader');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Setup tab event listeners
function setupTabListeners() {
    const grammarTab = document.querySelector('.grammar-tab');
    const vocabularyTab = document.querySelector('.vocabulary-tab');
    
    // Make badges transparent initially until data loads
    const grammarBadge = document.querySelector('.grammar-tab .badge-red, .grammar-tab .badge-green');
    const vocabularyBadge = document.querySelector('.vocabulary-tab .badge-red, .vocabulary-tab .badge-green');
    
    if (grammarBadge) {
        grammarBadge.style.opacity = '1'; // Keep visible but replace content with loader
        grammarBadge.style.backgroundColor = 'transparent'; // Make background transparent
        const badgeLabel = grammarBadge.querySelector('.badge-label');
        if (badgeLabel) {
            // Store original text
            badgeLabel._originalText = badgeLabel.textContent;
            // Replace with small loader
            badgeLabel.innerHTML = '<div class="mini-loader"></div>';
        }
    }
    
    if (vocabularyBadge) {
        vocabularyBadge.style.opacity = '1'; // Keep visible but replace content with loader
        vocabularyBadge.style.backgroundColor = 'transparent'; // Make background transparent
        const badgeLabel = vocabularyBadge.querySelector('.badge-label');
        if (badgeLabel) {
            // Store original text
            badgeLabel._originalText = badgeLabel.textContent;
            // Replace with small loader
            badgeLabel.innerHTML = '<div class="mini-loader"></div>';
        }
    }
    
    // Add CSS for mini-loader if not already present
    if (!document.getElementById('mini-loader-style')) {
        const style = document.createElement('style');
        style.id = 'mini-loader-style';
        style.textContent = `
            .mini-loader {
                width: 8px;
                height: 8px;
                border: 2px solid rgba(9, 87, 208, 0.3);
                border-radius: 50%;
                border-top-color: var(--blue, #0957d0);
                animation: mini-spin 1s linear infinite;
            }
            @keyframes mini-spin {
                to {transform: rotate(360deg);}
            }
        `;
        document.head.appendChild(style);
    }
    
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
        // Show loading state in grammar tab body
        showTabLoader('.grammar-tab-body');
        isLoading = true;
    
        let useStoredData = false;
        let storedGrammarData = null;
        
        await new Promise(resolve => {
            chrome.storage.local.get(['transcript_stats'], (result) => {
                const allStats = result.transcript_stats || {};
                if (allStats[transcriptId] && allStats[transcriptId].grammarData) {
                    console.log('Found stored grammar data for transcriptId:', transcriptId);
                    storedGrammarData = allStats[transcriptId].grammarData;
                    useStoredData = true;
                } else {
                    console.log('No stored grammar data found for transcriptId:', transcriptId);
                }
                resolve();
            });
        });
        
        if (useStoredData) {
            console.log('Using stored grammar data instead of API call');
            grammarData = storedGrammarData;
        } else {
        const cleanText = preprocessTranscriptText(transcriptText);
            const apiGrammarResponse = await apiService.getGrammarAnalysis(cleanText);
            grammarData = apiGrammarResponse; // Use API response
            
            // Save grammar data to transcript_stats, merging with existing data
            await new Promise(resolve => {
                chrome.storage.local.get(['transcript_stats'], (result) => {
                    const allStatsForSave = result.transcript_stats || {};
                    const existingDataForId = allStatsForSave[transcriptId] || {};
                    
                    allStatsForSave[transcriptId] = {
                        ...existingDataForId, // Preserve other data
                        grammarData: apiGrammarResponse // Add/update grammarData
                    };
                    
                    chrome.storage.local.set({ transcript_stats: allStatsForSave }, () => {
                        console.log('Saved grammar data to transcript_stats by merging:', allStatsForSave[transcriptId]);
                        resolve();
                    });
                });
            });
        }
        
        displayGrammarData(grammarData);
        
        hideTabLoader('.grammar-tab-body');
        isLoading = false;
    } catch (error) {
        console.error('Error loading grammar data:', error);
        isLoading = false;
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
    
    // Apply filter to remove capitalization, hyphen, and comma mistakes
    const { mistakes } = data.grammar;
    const filteredMistakes = filterGrammarMistakes(mistakes);
    
    console.log(`Displaying ${filteredMistakes.length} grammar mistakes (filtered from ${mistakes.length} total)`);
    
    // Check if there are any mistakes after filtering
    if (filteredMistakes.length === 0) {
        grammarCards.innerHTML = '<div class="no-errors">No grammar mistakes found. Great job!</div>';
        updateGrammarBadgeCount(0);
        updateGrammarParagraph(0);
        return;
    }
    
    // Calculate number of warnings (35% of filtered mistakes, rounded down)
    const warningsCount = Math.floor(filteredMistakes.length * 0.35);
    console.log(`Calculated warnings count: ${warningsCount} (35% of ${filteredMistakes.length} filtered mistakes)`);
    
    // Split the filtered mistakes into top mistakes and warnings
    const topMistakes = filteredMistakes.slice(0, filteredMistakes.length - warningsCount);
    const warningMistakes = filteredMistakes.slice(filteredMistakes.length - warningsCount);
    
    console.log(`Split mistakes: ${topMistakes.length} for Top Mistakes, ${warningMistakes.length} for Warnings`);
    
    // Create "Top Mistakes" card with remaining mistakes
    const topCard = createGrammarCard("Top Mistakes", topMistakes);
    grammarCards.appendChild(topCard);
    
    // Create "Warnings" card
    const warningsCard = createGrammarCard("Warnings", warningMistakes);
    grammarCards.appendChild(warningsCard);
    
    // Update badge and paragraph with filtered count
    updateGrammarBadgeCount(filteredMistakes.length);
    updateGrammarParagraph(filteredMistakes.length);
}

// Filter grammar mistakes based on explanation text
function filterGrammarMistakes(mistakes) {
    if (!mistakes || !Array.isArray(mistakes)) {
        return [];
    }
    
    // Terms to filter out
    const filterTerms = ['capitaliz', 'hyphen', 'comma', 'conjunction', 'No grammar error', 'no grammar error', 'punctuation', 'question mark', 'repeating', 'repetition', 'full form'];
    
    // Filter out mistakes with explanations containing any of the filter terms
    return mistakes.filter(mistake => {
        if (!mistake.explanation) {
            return true; // Keep mistakes without explanations
        }
        
        const explanation = mistake.explanation.toLowerCase();
        
        // Check if explanation contains any of the filter terms
        for (const term of filterTerms) {
            if (explanation.includes(term)) {
                console.log(`Filtered out mistake: "${mistake.error}" - Explanation: "${mistake.explanation}"`);
                return false;
            }
        }
        
        return true; // Keep mistakes that don't match filter terms
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
    
    // Different description text based on category
    if (category === "Warnings") {
        description.textContent = 'Less critical but still important to fix:';
    } else {
        description.textContent = `Most critical grammar mistakes:`;
    }
    
    // Append elements
    text.appendChild(description);
    textSection.appendChild(header);
    textSection.appendChild(text);
    card.appendChild(textSection);
    
    // Create grammar errors container
    const errorsContainer = document.createElement('div');
    errorsContainer.className = 'grammar-errors';
    
    // Add each mistake if there are any
    if (mistakes && mistakes.length > 0) {
        mistakes.forEach(mistake => {
            const errorElement = createGrammarError(mistake);
            errorsContainer.appendChild(errorElement);
        });
    } else if (category === "Warnings") {
        // Show empty state message for Warnings when no warnings
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'no-errors';
        emptyMessage.style.padding = '10px';
        emptyMessage.textContent = 'No warnings to display.';
        errorsContainer.appendChild(emptyMessage);
    }
    
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
    const badge = document.querySelector('.grammar-tab .badge-green .badge-label, .grammar-tab .badge-red .badge-label');
    if (badge) {
        badge.textContent = count;
        
        // Update badge color based on count
        const badgeContainer = badge.parentElement;
        if (count > 0) {
            badgeContainer.classList.remove('badge-green');
            badgeContainer.classList.add('badge-red');
            badgeContainer.style.backgroundColor = ''; // Remove transparent background
        } else {
            badgeContainer.classList.remove('badge-red');
            badgeContainer.classList.add('badge-green');
            badgeContainer.style.backgroundColor = ''; // Remove transparent background
        }
        
        console.log(`Updated grammar badge to ${count} with appropriate color`);
    }
}

// Update the grammar paragraph text based on mistakes count
function updateGrammarParagraph(mistakesCount) {
    const paragraph = document.querySelector('.grammar-header .paragraph');
    if (paragraph) {
        if (mistakesCount === 0) {
            paragraph.textContent = 'Great job! No grammar mistakes found in your speech.';
        } else {
            paragraph.textContent = 'Fix these grammar mistakes to improve your English score.';
        }
    }
}

// Load vocabulary data from API
async function loadVocabularyData() {
    try {
        // Show loading state in vocabulary tab body
        showTabLoader('.vocabulary-tab-body');
        isLoading = true;
        
        // Check if we have vocabulary data in storage first
        let useStoredData = false;
        let storedVocabularyData = null;
        
        // Get stored data from transcript_stats
        await new Promise(resolve => {
            chrome.storage.local.get(['transcript_stats'], (result) => {
                const allStats = result.transcript_stats || {};
                if (allStats[transcriptId] && allStats[transcriptId].vocabularyData) {
                    console.log('Found stored vocabulary data for transcriptId:', transcriptId);
                    storedVocabularyData = allStats[transcriptId].vocabularyData;
                    useStoredData = true;
                } else {
                    console.log('No stored vocabulary data found for transcriptId:', transcriptId);
                }
                resolve();
            });
        });
        
        if (useStoredData) {
            // Use data from storage
            console.log('Using stored vocabulary data instead of API call');
            vocabularyData = storedVocabularyData;
        } else {
        // Strip timestamps before sending to API
        const cleanText = preprocessTranscriptText(transcriptText);
        
        // Get vocabulary data from API
            const apiVocabularyResponse = await apiService.getVocabularyAnalysis(cleanText);
            vocabularyData = apiVocabularyResponse; // Use API response
            
            // Save vocabulary data to transcript_stats, merging with existing data
            await new Promise(resolve => {
                chrome.storage.local.get(['transcript_stats'], (result) => {
                    const allStatsForSave = result.transcript_stats || {};
                    const existingDataForId = allStatsForSave[transcriptId] || {};
                    
                    allStatsForSave[transcriptId] = {
                        ...existingDataForId, // Preserve other data
                        vocabularyData: apiVocabularyResponse // Add/update vocabularyData
                    };
                    
                    chrome.storage.local.set({ transcript_stats: allStatsForSave }, () => {
                        console.log('Saved vocabulary data to transcript_stats by merging:', allStatsForSave[transcriptId]);
                        resolve();
                    });
                });
            });
        }
        
        // Process and display vocabulary data
        displayVocabularyData(vocabularyData);
        
        // Update badge count
        const suggestionsCount = countVocabularySuggestions(vocabularyData);
        updateVocabularyBadgeCount(suggestionsCount);
        
        // Update paragraph text based on suggestions count
        updateVocabularyParagraph(suggestionsCount);
        
        // Hide loader
        hideTabLoader('.vocabulary-tab-body');
        isLoading = false;
    } catch (error) {
        console.error('Error loading vocabulary data:', error);
        isLoading = false;
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
    header.textContent = 'Synonyms';
    
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
    const badge = document.querySelector('.vocabulary-tab .badge-green .badge-label, .vocabulary-tab .badge-red .badge-label');
    if (badge) {
        badge.textContent = count;
        
        // Update badge color based on count
        const badgeContainer = badge.parentElement;
        if (count > 0) {
            badgeContainer.classList.remove('badge-green');
            badgeContainer.classList.add('badge-red');
            badgeContainer.style.backgroundColor = ''; // Remove transparent background
        } else {
            badgeContainer.classList.remove('badge-red');
            badgeContainer.classList.add('badge-green');
            badgeContainer.style.backgroundColor = ''; // Remove transparent background
        }
        
        console.log(`Updated vocabulary badge to ${count} with appropriate color`);
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
    
    // Add CSS for button hover and press effects
    if (!document.getElementById('button-effects-style')) {
        const style = document.createElement('style');
        style.id = 'button-effects-style';
        style.textContent = `
            .share-button, .return-button {
                cursor: pointer;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .share-button:hover, .return-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            }
            .share-button:active, .return-button:active {
                transform: translateY(0);
                box-shadow: 0 0px 1px rgba(0, 0, 0, 0.1);
            }
        `;
        document.head.appendChild(style);
    }
    
    // Share button handler
    if (shareButton) {
        shareButton.addEventListener('click', () => {
            // Check if session is marked as English before navigating
            chrome.storage.local.get(['transcript_stats'], (result) => {
                const allStats = result.transcript_stats || {};
                const currentStats = allStats[transcriptId];
                
                // Only navigate if we have stats and English scores
                if (currentStats && currentStats.api_englishScore !== undefined) {
                    window.location.href = '../transcripts.html';
                }
            });
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
    let summary = `English Analysis from Duo - ${meetingInfo}\n\n`;
    
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

// Load general stats from API
async function loadGeneralStats() {
    try {
        const generalTabBody = document.querySelector('.general-tab-body');
        const generalHeader = generalTabBody.querySelector('.general-header');
        const generalCardsContainer = generalTabBody.querySelector('.general-cards');

        let originalCardsContent = '';
        if (generalCardsContainer) {
            originalCardsContent = generalCardsContainer.innerHTML;
            generalCardsContainer.innerHTML = '';
        } else {
            console.error(".general-cards container not found for loader.");
            if (generalTabBody && generalHeader) generalTabBody.innerHTML = generalHeader.outerHTML;
            else if (generalTabBody) generalTabBody.innerHTML = '';
        }
        
        showTabLoader(generalCardsContainer ? '.general-tab-body .general-cards' : '.general-tab-body');
        isLoading = true;
        
        let useStoredData = false;
        let storedApiStats = null;
        
        await new Promise(resolve => {
            chrome.storage.local.get(['transcript_stats'], (result) => {
                const allStats = result.transcript_stats || {};
                const currentIdStats = allStats[transcriptId];
                if (currentIdStats && 
                    currentIdStats.api_englishScore !== undefined &&
                    currentIdStats.api_fluencyScore !== undefined &&
                    currentIdStats.api_grammarScore !== undefined &&
                    currentIdStats.api_vocabularyScore !== undefined &&
                    currentIdStats.api_summary !== undefined && 
                    currentIdStats.api_feedback !== undefined) {
                    
                    console.log('Found complete stored API stats for transcriptId:', transcriptId, currentIdStats);
                    storedApiStats = currentIdStats;
                    useStoredData = true;
                } else {
                    console.log('Incomplete or no stored API stats found for transcriptId:', transcriptId);
                }
                resolve();
            });
        });
        
        if (useStoredData) {
            console.log('Using stored API stats instead of API call for general stats');
            statsData = {
                general_score: storedApiStats.api_englishScore,
                english_score: storedApiStats.api_englishScore,
                fluency_score: storedApiStats.api_fluencyScore,
                grammar_score: storedApiStats.api_grammarScore,
                vocabulary_score: storedApiStats.api_vocabularyScore,
                summary: storedApiStats.api_summary,
                feedback: storedApiStats.api_feedback
            };
        } else {
            const cleanText = preprocessTranscriptText(transcriptText);
            const apiResponse = await apiService.getEnglishStats(cleanText);
            console.log('Raw english_stats API response:', apiResponse);
            statsData = apiResponse; // Keep raw API response initially
            
            let calculatedEnglishScore = apiResponse.general_score || apiResponse.english_score || 0;
            if (frontendStats && frontendStats.fluency_score !== undefined) { // Ensure frontendStats is available
                 calculatedEnglishScore = Math.round((frontendStats.fluency_score - calculatedEnglishScore)/4 + calculatedEnglishScore);
            }
            
            let calculatedFluencyScore = (frontendStats && frontendStats.fluency_score !== undefined) ? 
                frontendStats.fluency_score : (apiResponse.fluency_score || 0);
                
            let calculatedGrammarScore = apiResponse.grammar_score || 0;
            let calculatedVocabularyScore = apiResponse.vocabulary_score || 0;
            
            await new Promise(resolve => {
        chrome.storage.local.get(['transcript_stats'], (result) => {
                    const allStatsForSave = result.transcript_stats || {};
                    const existingDataForId = allStatsForSave[transcriptId] || {};
                    
                    allStatsForSave[transcriptId] = {
                        ...existingDataForId, // Preserve other data (frontend, grammarData, vocabData)
                        api_englishScore: calculatedEnglishScore,
                        api_fluencyScore: calculatedFluencyScore,
                        api_grammarScore: calculatedGrammarScore,
                        api_vocabularyScore: calculatedVocabularyScore,
                        api_summary: apiResponse.summary,      // Save summary from API
                        api_feedback: apiResponse.feedback    // Save feedback from API
                    };
                    
                    // Also save additional fluency stats if they were calculated by frontend
                    if (frontendStats) {
                        allStatsForSave[transcriptId].garbage_words = frontendStats.garbage_words;
                        allStatsForSave[transcriptId].total_words = frontendStats.total_words;
                        allStatsForSave[transcriptId].words_per_minute = frontendStats.words_per_minute;
                        allStatsForSave[transcriptId].speaking_time_seconds = frontendStats.speaking_time_seconds;
                    }
                    
                    chrome.storage.local.set({ transcript_stats: allStatsForSave }, () => {
                        console.log('Saved API scores (and summary/feedback) to transcript_stats by merging:', allStatsForSave[transcriptId]);
                        resolve();
                });
            });
        });
            // Update statsData for displayGeneralStats to use the calculated scores
            statsData = {
                general_score: calculatedEnglishScore,
                english_score: calculatedEnglishScore, 
                fluency_score: calculatedFluencyScore,
                grammar_score: calculatedGrammarScore,
                vocabulary_score: calculatedVocabularyScore,
                summary: apiResponse.summary,
                feedback: apiResponse.feedback
            };
        }
        
        if (generalCardsContainer) {
            generalCardsContainer.innerHTML = originalCardsContent;
        } else if (generalTabBody && generalHeader) {
            // Minimal repopulation if structure was altered
        }
        
        displayGeneralStats(statsData);
        
        hideTabLoader(generalCardsContainer ? '.general-tab-body .general-cards' : '.general-tab-body');
        isLoading = false;
    } catch (error) {
        console.error('Error loading general stats:', error);
        // ... (error handling as before) ...
        const generalTabBody = document.querySelector('.general-tab-body');
        const generalCardsContainer = generalTabBody ? generalTabBody.querySelector('.general-cards') : null;

        if (generalCardsContainer) {
            generalCardsContainer.innerHTML = '<div class="error-message" style="text-align:center; padding:20px; color:red;">Error analyzing your speech. Please try again.</div>';
        } else if (generalTabBody) {
            if (!generalTabBody.querySelector('.general-header')) {
                 generalTabBody.innerHTML = `
                    <div class="general-header">
                        <div class="header2">
                            <div class="icon">⭐️</div>
                            <div class="h-2-header">General</div>
                        </div>
                        <div class="frame-565">
                             <div class="paragraph">Error analyzing your speech. Please try again.</div>
                        </div>
                    </div>
                    <div class="general-cards">
                         <div class="error-message" style="text-align:center; padding:20px; color:red;">Please try refreshing.</div>
                    </div>
                `;
            } else {
                 generalTabBody.innerHTML += '<div class="general-cards"><div class="error-message" style="text-align:center; padding:20px; color:red;">Error analyzing your speech. Please try again.</div></div>';
            }
        }
        hideTabLoader(generalCardsContainer ? '.general-tab-body .general-cards' : '.general-tab-body');
        isLoading = false;
    }
}

// Display stats in the General tab
function displayGeneralStats(data) {
    if (!data) {
        console.error('No stats data received');
        return;
    }
    
    console.log('Displaying general stats:', data);
    
    try {
        // Update English score - use general_score from backend
        let englishScore = data.general_score || data.english_score || 0;
        console.log('Using score from backend:', englishScore);
        
        const scoreElement = document.querySelector('.frame-569 .h-3-header');
        if (scoreElement) {
            scoreElement.textContent = `Your English score: ${englishScore}`;
        }
        
        // Update the "out 100" text in a separate element with gray color
        const outOfElement = document.querySelector('.frame-569 .h-3-header2');
        if (outOfElement) {
            outOfElement.textContent = 'out 100';
            outOfElement.style.color = '#5f6368'; // Text-gray color
        }
        
        // Update vocabulary score
        const vocabularyScore = data.vocabulary_score || 0; // Fallback to default
        const vocabularyElement = document.querySelector('.title3 .title-3-span3');
        if (vocabularyElement) {
            vocabularyElement.textContent = `${vocabularyScore}%`;
        }
        
        // Update grammar score
        const grammarScore = data.grammar_score || 0; // Fallback to default
        const grammarElement = document.querySelector('.title2 .title-2-span3');
        if (grammarElement) {
            grammarElement.textContent = `${grammarScore}%`;
        }
        
        // Update fluency score - use frontend calculated score if available
        let fluencyScore = 0;
        if (frontendStats && frontendStats.fluency_score !== undefined) {
            fluencyScore = frontendStats.fluency_score;
            console.log('Using fluency score from frontend calculations:', fluencyScore);
        } else {
            fluencyScore = data.fluency_score || 0; // Fallback to API or default
            console.log('Using fluency score from API or default:', fluencyScore);
        }
        
        const fluencyElement = document.querySelector('.title .title-span3');
        if (fluencyElement) {
            fluencyElement.textContent = `${fluencyScore}%`;
        }
        
        // Apply color-coding logic to the three scores
        applyScoreColors(fluencyScore, grammarScore, vocabularyScore);

        // Update the dynamic score triangle
        updateScoreTriangle(fluencyScore, grammarScore, vocabularyScore);
        
        // Update summary text if available
        if (data.summary) {
            const paragraphElement = document.querySelector('.frame-565 .paragraph');
            if (paragraphElement) {
                paragraphElement.textContent = data.summary;
            }
        } else if (data.feedback) {
            // If no summary but we have feedback, use the feedback for the summary paragraph too
            const paragraphElement = document.querySelector('.frame-565 .paragraph');
            if (paragraphElement) {
                paragraphElement.textContent = data.feedback;
            }
        }

        // Update the feedback text in the pace card
        const feedbackTextElement = document.querySelector('.pace-card .text .reduce-the-number-of-filler-words-and-expand-your-vocabulary-to-achieve-a-better-score');
        if (feedbackTextElement) {
            if (data.feedback && data.feedback.trim() !== '') {
                feedbackTextElement.textContent = data.feedback;
            } else {
                // Fallback text if feedback is not provided or is empty
                feedbackTextElement.textContent = 'Review your detailed stats in other tabs to see how you can improve.';
            }
        }
        
        // Position the triangle according to the user's score
        const scoreIndicator = document.querySelector('.general-tab-body .pace-card .speed-scale .score-indicator');
        if (scoreIndicator) {
            // Calculate the position as a percentage of the scale width
            const positionPercentage = Math.max(0, Math.min(100, englishScore)); // Ensure score is between 0 and 100
            scoreIndicator.style.left = `${positionPercentage}%`;
            // Center the indicator by shifting it back by half its width
            scoreIndicator.style.transform = 'translateX(-50%)';
            console.log(`Set score indicator to: ${positionPercentage}%`);
        }

    } catch (error) {
        console.error('Error updating general stats UI:', error);
    }
}

// Function to apply color-coding to score displays based on the specified rules
function applyScoreColors(fluencyScore, grammarScore, vocabularyScore) {
    console.log('Applying color logic to scores:', { fluencyScore, grammarScore, vocabularyScore });
    
    // Get the elements for each score
    const fluencyElement = document.querySelector('.title .title-span3');
    const grammarElement = document.querySelector('.title2 .title-2-span3');
    const vocabularyElement = document.querySelector('.title3 .title-3-span3');
    
    // Default colors - red
    let fluencyColor = '#FF5252'; // red
    let grammarColor = '#FF5252'; // red
    let vocabularyColor = '#FF5252'; // red
    
    // Create an array of scores with their elements for sorting
    const scores = [
        { score: fluencyScore, name: 'fluency' },
        { score: grammarScore, name: 'grammar' },
        { score: vocabularyScore, name: 'vocabulary' }
    ];
    
    // Rule 1: If ALL 3 scores are <= 30, ALL should be RED
    if (fluencyScore <= 30 && grammarScore <= 30 && vocabularyScore <= 30) {
        console.log('Rule 1: All scores <= 30, setting all to RED');
        // All colors already set to red by default
    }
    // Rule 2: If ONLY 1 score out of 3 > 30, that one should be GREEN
    else if ((fluencyScore > 30 && grammarScore <= 30 && vocabularyScore <= 30) || 
             (fluencyScore <= 30 && grammarScore > 30 && vocabularyScore <= 30) ||
             (fluencyScore <= 30 && grammarScore <= 30 && vocabularyScore > 30)) {
        console.log('Rule 2: Only one score > 30, setting it to GREEN');
        if (fluencyScore > 30) fluencyColor = '#4CAF50'; // green
        if (grammarScore > 30) grammarColor = '#4CAF50'; // green
        if (vocabularyScore > 30) vocabularyColor = '#4CAF50'; // green
    }
    // Rule 3: If 2 or 3 scores > 30
    else {
        // Sort scores from highest to lowest
        scores.sort((a, b) => b.score - a.score);
        
        console.log('Sorted scores:', scores.map(s => `${s.name}: ${s.score}`).join(', '));
        
        // Calculate difference between top 1 and top 2
        const diffTop1Top2 = scores[0].score - scores[1].score;
        
        // Prepare a map to track which scores should be green
        const greenScores = new Set();
        
        if (diffTop1Top2 >= 15) {
            // Only top 1 is GREEN
            console.log('Rule 3a: Top score - second score < 10, only top score is GREEN');
            greenScores.add(scores[0].name);
        } else {
            // Top 1 and top 2 are GREEN
            console.log('Rule 3b: Top score - second score >= 10, top two scores are GREEN');
            greenScores.add(scores[0].name);
            greenScores.add(scores[1].name);
        }
        
        // Apply colors based on the names in the greenScores set
        if (greenScores.has('fluency')) fluencyColor = '#4CAF50';
        if (greenScores.has('grammar')) grammarColor = '#4CAF50';
        if (greenScores.has('vocabulary')) vocabularyColor = '#4CAF50';
    }
    
    // Final override: ALL scores > 70 should be GREEN
    if (fluencyScore > 70) {
        fluencyColor = '#4CAF50'; // green
        console.log('Override: Fluency score > 70, setting to GREEN');
    }
    if (grammarScore > 70) {
        grammarColor = '#4CAF50'; // green
        console.log('Override: Grammar score > 70, setting to GREEN');
    }
    if (vocabularyScore > 70) {
        vocabularyColor = '#4CAF50'; // green
        console.log('Override: Vocabulary score > 70, setting to GREEN');
    }
    
    // Apply the colors to the elements
    if (fluencyElement) fluencyElement.style.color = fluencyColor;
    if (grammarElement) grammarElement.style.color = grammarColor;
    if (vocabularyElement) vocabularyElement.style.color = vocabularyColor;
    
    console.log('Applied colors:', { 
        fluency: fluencyColor, 
        grammar: grammarColor, 
        vocabulary: vocabularyColor 
    });
}

// Function to update the score triangle in the SVG
function updateScoreTriangle(fluencyScore, grammarScore, vocabularyScore) {
    // Visual anchors of the large background triangle, corresponding to label Placements
    const anchor_TOP = { x: 84.6794, y: 3.03113 };         // Visual Top (where "Vocabulary" is labelled)
    const anchor_BOTTOM_LEFT = { x: 4.09192, y: 132.318 }; // Visual Bottom-Left (where "Fluency" is labelled)
    const anchor_BOTTOM_RIGHT = { x: 161.875, y: 132.318 };// Visual Bottom-Right (where "Grammar" is labelled)

    // Calculate Centroid of the large triangle (remains the same)
    const Cx = (anchor_TOP.x + anchor_BOTTOM_LEFT.x + anchor_BOTTOM_RIGHT.x) / 3;
    const Cy = (anchor_TOP.y + anchor_BOTTOM_LEFT.y + anchor_BOTTOM_RIGHT.y) / 3;
    const Centroid = { x: Cx, y: Cy };

    console.log("Score Triangle - Centroid:", Centroid, "Input Scores:", { fluencyScore, grammarScore, vocabularyScore });

    // Normalize scores to be within 0-100 range, providing a default of 0 if undefined
    const normFluencyScore = Math.max(0, Math.min(100, fluencyScore || 0));
    const normGrammarScore = Math.max(0, Math.min(100, grammarScore || 0));
    const normVocabularyScore = Math.max(0, Math.min(100, vocabularyScore || 0));

    // Calculate points for the dynamic triangle based on visual label positions
    // Point for the TOP of the dynamic triangle (corresponds to Vocabulary score and anchor_TOP)
    const pointForVisualTop = {
        x: Centroid.x + (normVocabularyScore / 100) * (anchor_TOP.x - Centroid.x),
        y: Centroid.y + (normVocabularyScore / 100) * (anchor_TOP.y - Centroid.y)
    };

    // Point for the BOTTOM-LEFT of the dynamic triangle (corresponds to Fluency score and anchor_BOTTOM_LEFT)
    const pointForVisualBottomLeft = {
        x: Centroid.x + (normFluencyScore / 100) * (anchor_BOTTOM_LEFT.x - Centroid.x),
        y: Centroid.y + (normFluencyScore / 100) * (anchor_BOTTOM_LEFT.y - Centroid.y)
    };

    // Point for the BOTTOM-RIGHT of the dynamic triangle (corresponds to Grammar score and anchor_BOTTOM_RIGHT)
    const pointForVisualBottomRight = {
        x: Centroid.x + (normGrammarScore / 100) * (anchor_BOTTOM_RIGHT.x - Centroid.x),
        y: Centroid.y + (normGrammarScore / 100) * (anchor_BOTTOM_RIGHT.y - Centroid.y)
    };

    console.log("Score Triangle - Calculated Visual Points: Top(Vocab):");
    console.log(pointForVisualTop);
    console.log("BottomLeft(Fluency):");
    console.log(pointForVisualBottomLeft);
    console.log("BottomRight(Grammar):");
    console.log(pointForVisualBottomRight);

    const scoreTrianglePath = document.getElementById('dynamicScoreTriangle');
    if (scoreTrianglePath) {
        // Construct the new path 'd' attribute string, connecting points in a consistent visual order (Top, Bottom-Left, Bottom-Right)
        const newPathD = `M ${pointForVisualTop.x.toFixed(4)},${pointForVisualTop.y.toFixed(4)} L ${pointForVisualBottomLeft.x.toFixed(4)},${pointForVisualBottomLeft.y.toFixed(4)} L ${pointForVisualBottomRight.x.toFixed(4)},${pointForVisualBottomRight.y.toFixed(4)} Z`;
        scoreTrianglePath.setAttribute('d', newPathD);
        console.log("Score Triangle - Updated path d attribute:", newPathD);
    } else {
        console.error('dynamicScoreTriangle path element not found in the SVG. SVG loading or IDing might have failed.');
    }
}

// Function to load and display stats calculated by transcript_stats.js
async function loadAndDisplayFrontendStats() {
    // First check if we already have fluency data in storage
    let storedFluencyData = null;
    let useStoredFluencyData = false;
    
    await new Promise(resolve => {
        chrome.storage.local.get(['transcript_stats'], (result) => {
            const allStats = result.transcript_stats || {};
            if (allStats[transcriptId] && 
                allStats[transcriptId].api_fluencyScore !== undefined && 
                allStats[transcriptId].garbage_words) {
                console.log('[loadAndDisplayFrontendStats] Found stored fluency data:', allStats[transcriptId]);
                storedFluencyData = allStats[transcriptId];
                useStoredFluencyData = true;
            } else {
                console.log('[loadAndDisplayFrontendStats] No complete fluency data found in storage');
            }
            resolve();
        });
    });
    
    if (useStoredFluencyData) {
        console.log('[loadAndDisplayFrontendStats] Using stored fluency data instead of recalculating');
        // Create a frontendStats object using the stored data
        frontendStats = {
            fluency_score: storedFluencyData.api_fluencyScore,
            garbage_words: storedFluencyData.garbage_words,
            total_words: storedFluencyData.total_words || 0,
            words_per_minute: storedFluencyData.words_per_minute || 0,
            speaking_time_seconds: storedFluencyData.speaking_time_seconds || 0
        };
        
        // Display the fluency data
        displayFluencyData(frontendStats);
        return;
    }
    
    if (typeof calculateTranscriptStats === 'function') {
        console.log("Calculating frontend stats...");
        try {
            // Show loader in Fluency tab while calculating
            showTabLoader('.fluency-tab-body .fluency-cards');
            
            const transcriptObject = {
                id: transcriptId, 
                text: transcriptText,
                sessionId: transcriptId // Assuming sessionId is same as id for this context
            };
            frontendStats = await calculateTranscriptStats(transcriptObject); // capture the result
            console.log("Frontend stats calculated:", frontendStats);
            
            displayFluencyData(frontendStats);
            
            hideTabLoader('.fluency-tab-body .fluency-cards');
        } catch (error) {
            console.error("Error calculating frontend stats:", error);
            hideTabLoader('.fluency-tab-body .fluency-cards');
            // Optionally display an error in the fluency tab
            const fluencyCards = document.querySelector('.fluency-tab-body .fluency-cards');
            if (fluencyCards) {
                fluencyCards.innerHTML = '<div class="error">Error calculating fluency stats.</div>';
            }
        }
    } else {
        console.error('calculateTranscriptStats function not found. Is transcript_stats.js loaded?');
        const fluencyCards = document.querySelector('.fluency-tab-body .fluency-cards');
        if (fluencyCards) {
            fluencyCards.innerHTML = '<div class="error">Fluency analysis unavailable. Script error.</div>';
        }
    }
}

// Function to display fluency data in the UI
function displayFluencyData(stats) {
    if (!stats) {
        console.error("No frontend stats provided to displayFluencyData");
        return;
    }

    // Calculate useless words count, excluding words that appear only once
    let uselessWordsCount = 0;
    let totalWords = stats.total_words || 100; // Fallback to avoid division by zero
    
    // Check if we have garbage words data
    if (stats.garbage_words && stats.garbage_words.topGarbageWords) {
        // Filter and count only words that appear more than once
        const topGarbageWords = stats.garbage_words.topGarbageWords;
        
        // Loop through all top garbage words
        for (const word in topGarbageWords) {
            const count = topGarbageWords[word];
            // Only count words that appear more than once
            if (count > 1) {
                uselessWordsCount += count;
            }
        }
        
        console.log(`Recalculated useless words count (excluding single occurrences): ${uselessWordsCount}`);
    } else {
        // Fallback to the total if topGarbageWords not available
        uselessWordsCount = (stats.garbage_words && stats.garbage_words.totalGarbageWords) || 0;
        console.log(`Using original totalGarbageWords as fallback: ${uselessWordsCount}`);
    }
    
    // Calculate the adjusted percentage
    const garbagePercentage = totalWords > 0 ? Math.round((uselessWordsCount / totalWords) * 100) : 0;
    console.log(`Recalculated garbage percentage: ${garbagePercentage}%`);
    
    const uselessWordsElement = document.querySelector('.fluency-tab-body .fillers-card .text-section .h-3-header');
    if (uselessWordsElement) {
        uselessWordsElement.textContent = `You used ${uselessWordsCount} useless words`;
        console.log(`Updated useless words count display to: ${uselessWordsCount}`);
    } else {
        console.error("Useless words element not found with selector: .fluency-tab-body .fillers-card .text-section .h-3-header");
    }
    
    // Update the garbage percentage text with dynamic label based on percentage
    const uselessWordsPercentText = document.querySelector('.fluency-tab-body .fillers-card .text-section .text');
    if (uselessWordsPercentText) {
        // Determine label class and text based on the garbage percentage
        let labelClass = garbagePercentage <= 1 ? 'green-label' : (garbagePercentage <= 5 ? 'green-label' : 'red-label');
        let labelText = garbagePercentage <= 1 ? 'Excellent!' : (garbagePercentage <= 5 ? 'Great done!' : 'Too much!');
        
        // Build the HTML content, conditionally including the percentage text
        let htmlContent = `<span class="${labelClass}">${labelText}</span>`;
        if (garbagePercentage > 1) {
            htmlContent += ` That is ${garbagePercentage}% of your speech`;
        }
        
        uselessWordsPercentText.innerHTML = htmlContent;
        console.log(`Updated useless words percentage. Label: ${labelText}, Percentage shown: ${garbagePercentage > 1 ? garbagePercentage + '%' : 'Hidden'}`);
    } else {
        console.error("Useless words percentage element not found with selector: .fluency-tab-body .fillers-card .text-section .text");
    }

    // Update Words Per Minute text display (for "You said X words per min")
    let wpmForDisplay = stats.words_per_minute || 0;
    console.log(`Original WPM from transcript_stats.js (for text display calculation): ${wpmForDisplay}`);
    wpmForDisplay = Math.round(wpmForDisplay); // Round to nearest whole number
    console.log(`Final rounded WPM for text display: ${wpmForDisplay}`);
    
    const wpmTextElement = document.querySelector('.fluency-tab-body .pace-card .text-section .h-3-header2');
    if (wpmTextElement) {
        wpmTextElement.textContent = `You said ${wpmForDisplay} words per min`;
        console.log(`Updated Fluency WPM text display to: ${wpmForDisplay}`);
    }

    // Update WPM feedback label and text
    const wpmLabelElement = document.querySelector('.fluency-tab-body .pace-card .text-section .text > span:first-child');
    const wpmFeedbackTextElement = document.querySelector('#wpm-feedback');

    if (wpmLabelElement && wpmFeedbackTextElement) {
        // Clear existing color classes
        wpmLabelElement.classList.remove('red-label', 'green-label');

        if (wpmForDisplay < 100) {
            wpmLabelElement.textContent = "Speed up!";
            wpmLabelElement.classList.add('red-label');
            wpmFeedbackTextElement.textContent = "It's slower than recommended";
            console.log("WPM < 100: Applied 'Speed up!' feedback.");
        } else if (wpmForDisplay >= 100 && wpmForDisplay <= 150) {
            wpmLabelElement.textContent = "Amazing!";
            wpmLabelElement.classList.add('green-label');
            wpmFeedbackTextElement.textContent = "It's right at the recommended level";
            console.log("WPM 100-150: Applied 'Amazing!' feedback.");
        } else { // wpmForDisplay > 150
            wpmLabelElement.textContent = "Slow down!";
            wpmLabelElement.classList.add('red-label');
            wpmFeedbackTextElement.textContent = "It's faster than recommended";
            console.log("WPM > 150: Applied 'Slow down!' feedback.");
        }
    } else {
        if (!wpmLabelElement) console.error("WPM Label element (span for 'Hold on!', 'Speed up!') not found with selector: .fluency-tab-body .pace-card .text-section .text > span:first-child");
        if (!wpmFeedbackTextElement) console.error("WPM Feedback text element (#wpm-feedback) not found.");
    }

    // Position the WPM scale indicator
    const wpmScoreIndicator = document.querySelector('.fluency-tab-body .pace-card .speed-scale .score-indicator');
    
    if (wpmScoreIndicator) {
        const scaleMinWpm = 45;
        const scaleMaxWpm = 195;
        const indicatorMinLeftPx = 4;
        const indicatorMaxLeftPx = 304;

        let leftPositionPx;

        if (wpmForDisplay <= scaleMinWpm) {
            leftPositionPx = indicatorMinLeftPx;
        } else if (wpmForDisplay >= scaleMaxWpm) {
            leftPositionPx = indicatorMaxLeftPx;
        } else {
            const wpmRange = scaleMaxWpm - scaleMinWpm; // 150
            const pixelRange = indicatorMaxLeftPx - indicatorMinLeftPx; // 300
            const wpmOffset = wpmForDisplay - scaleMinWpm;
            leftPositionPx = indicatorMinLeftPx + (wpmOffset / wpmRange) * pixelRange;
        }
        
        // Ensure position is within bounds, just in case calculations go slightly off
        leftPositionPx = Math.max(indicatorMinLeftPx, Math.min(indicatorMaxLeftPx, leftPositionPx));

        wpmScoreIndicator.style.left = `${leftPositionPx}px`;
        wpmScoreIndicator.style.transform = 'translateX(-50%)';
        console.log(`Positioned Fluency WPM indicator for wpmForDisplay ${wpmForDisplay} at left: ${leftPositionPx}px`);
    }

    // Update the Fluency tab paragraph based on useless words percentage and WPM
    const fluencyParagraph = document.querySelector('.fluency-tab-body .header .paragraph');
    if (fluencyParagraph) {
        let paragraphText = '';
        
        // Determine text based on combination of garbage percentage and WPM
        if (garbagePercentage > 5) {
            if (wpmForDisplay >= 100 && wpmForDisplay <= 150) {
                paragraphText = "Try to use less useless words next time";
            } else if (wpmForDisplay > 150) {
                paragraphText = "Try to use less useless words and speak a bit slower next time";
            } else { // WPM < 100
                paragraphText = "Try to use less useless words and speak a bit faster next time";
            }
        } else { // garbagePercentage <= 5
            if (wpmForDisplay >= 100 && wpmForDisplay <= 150) {
                paragraphText = "You demonstrated great fluency skills!";
            } else if (wpmForDisplay > 150) {
                paragraphText = "Try to speak a bit slower next time";
            } else { // WPM < 100
                paragraphText = "Try to speak a bit faster next time";
            }
        }
        
        fluencyParagraph.textContent = paragraphText;
        console.log(`Updated Fluency tab paragraph to: "${paragraphText}"`);
    } else {
        console.error("Fluency paragraph element not found with selector: .fluency-tab-body .header .paragraph");
    }

    // Calculate fluency mistakes count for badge
    let fluencyMistakesCount = 0;
    const hasWpmIssue = wpmForDisplay < 100 || wpmForDisplay > 150;
    const hasGarbageIssue = garbagePercentage > 5;
    
    if (hasWpmIssue && hasGarbageIssue) {
        fluencyMistakesCount = 2; // Both conditions are true
    } else if (hasWpmIssue || hasGarbageIssue) {
        fluencyMistakesCount = 1; // Only one condition is true
    } // else fluencyMistakesCount remains 0
    
    console.log(`Fluency mistakes count: ${fluencyMistakesCount} (WPM issue: ${hasWpmIssue}, Garbage issue: ${hasGarbageIssue})`);
    
    // Update the Fluency tab badge
    const fluencyBadge = document.querySelector('.fluency-tab .badge-label');
    if (fluencyBadge) {
        fluencyBadge.textContent = fluencyMistakesCount;
        
        // Update badge color based on count
        const badgeContainer = fluencyBadge.parentElement;
        if (fluencyMistakesCount > 0) {
            badgeContainer.classList.remove('badge-green');
            badgeContainer.classList.add('badge-red');
        } else {
            badgeContainer.classList.remove('badge-red');
            badgeContainer.classList.add('badge-green');
        }
        console.log(`Updated Fluency tab badge to ${fluencyMistakesCount} mistakes`);
    } else {
        console.error("Fluency badge element not found with selector: .fluency-tab .badge-label");
    }

    // Update the histogram with top garbage words
    const histogramContainer = document.querySelector('.fluency-tab-body .fillers-card .histogram');
    if (histogramContainer) {
        // Clear the existing histogram content
        histogramContainer.innerHTML = '';
        
        // Check if we have garbage words data
        if (stats.garbage_words && stats.garbage_words.topGarbageWords) {
            const topGarbageWords = stats.garbage_words.topGarbageWords;
            
            // Convert the object to an array of [word, count] pairs
            const wordArray = Object.entries(topGarbageWords);
            
            // Sort by count (descending)
            wordArray.sort((a, b) => b[1] - a[1]);
            
            // Take top 3 words (or fewer if less than 3 exist)
            const topWords = wordArray.slice(0, 3);
            
            console.log(`Top ${topWords.length} garbage words:`, topWords);
            
            if (topWords.length > 0) {
                // Calculate total count for all displayed words to determine relative widths
                const totalCount = topWords.reduce((sum, [_, count]) => sum + count, 0);
                console.log(`Total count of top garbage words: ${totalCount}`);
                
                // Create histogram blocks for each top word
                topWords.forEach((wordPair, index) => {
                    const [word, count] = wordPair;
                    
                    // Calculate width percentage based on relative frequency
                    const widthPercentage = topWords.length === 1 ? 100 : Math.round((count / totalCount) * 100);
                    console.log(`Word "${word}" count: ${count}, width: ${widthPercentage}%`);
                    
                    // Create histogram block
                    const histogramBlock = document.createElement('div');
                    histogramBlock.className = 'histogram-block';
                    
                    // Create filler bar (with different heights based on index)
                    const fillerBar = document.createElement('div');
                    fillerBar.className = index === 0 ? 'filler' : 'filler2';
                    fillerBar.style.width = `${widthPercentage}%`; // Set the width based on relative frequency
                    
                    // Create content container
                    const fillerContent = document.createElement('div');
                    fillerContent.className = 'filler-content';
                    
                    // Create word text
                    const supportingText = document.createElement('div');
                    supportingText.className = 'supporting-text';
                    supportingText.textContent = `"${word}"`;
                    
                    // Create count text
                    const supportingText2 = document.createElement('div');
                    supportingText2.className = 'supporting-text2';
                    supportingText2.textContent = `said ${count} ${count === 1 ? 'time' : 'times'}`;
                    
                    // Assemble the elements
                    fillerContent.appendChild(supportingText);
                    fillerContent.appendChild(supportingText2);
                    histogramBlock.appendChild(fillerBar);
                    histogramBlock.appendChild(fillerContent);
                    
                    // Add to container
                    histogramContainer.appendChild(histogramBlock);
                });
            } else {
                // Create a single block with message if no garbage words
                const histogramBlock = document.createElement('div');
                histogramBlock.className = 'histogram-block';
                
                const fillerBar = document.createElement('div');
                fillerBar.className = 'filler';
                // Remove custom height to match regular histogram bars
                fillerBar.style.width = '100%';  // Full width for single message
                
                const fillerContent = document.createElement('div');
                fillerContent.className = 'filler-content';
                
                const supportingText = document.createElement('div');
                supportingText.className = 'supporting-text';
                supportingText.textContent = ''; // Empty string instead of "..."
                
                const supportingText2 = document.createElement('div');
                supportingText2.className = 'supporting-text2';
                supportingText2.textContent = 'No garbage words to show';
                
                fillerContent.appendChild(supportingText);
                fillerContent.appendChild(supportingText2);
                histogramBlock.appendChild(fillerBar);
                histogramBlock.appendChild(fillerContent);
                
                histogramContainer.appendChild(histogramBlock);
            }
            
            console.log('Updated histogram with dynamic garbage word data and proportional widths');
        } else {
            // Fallback if no topGarbageWords data
            histogramContainer.innerHTML = `
                <div class="histogram-block">
                    <div class="filler" style="width: 100%;"></div>
                    <div class="filler-content">
                        <div class="supporting-text">No garbage words data</div>
                    </div>
                </div>
            `;
            console.warn('No topGarbageWords data available for histogram');
        }
    } else {
        console.error("Histogram container not found with selector: .fluency-tab-body .fillers-card .histogram");
    }

    // TODO: Display other fluency stats
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupButtonHandlers();
}); 