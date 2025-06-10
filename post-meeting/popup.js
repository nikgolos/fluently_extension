// Popup functionality for post-meeting page
// Shows a popup with quick stats when the page loads

class PopupManager {
    constructor() {
        this.overlay = null;
        this.modal = null;
        this.button = null;
        this.loader = null;
        this.isShown = false;
    }

    // Initialize popup functionality
    init() {
        this.overlay = document.getElementById('popupOverlay');
        this.modal = document.getElementById('popupModal');
        this.button = document.getElementById('popupButton');
        this.loader = document.getElementById('popupLoader');

        if (!this.overlay || !this.modal || !this.button) {
            console.error('Popup elements not found in DOM');
            return;
        }

        // Show popup first with loader visible
        this.showPopup();
        
        this.setupEventListeners();
        this.setupStorageListener();
        
        // Load data after showing popup (loader is visible by default)
        this.loadPopupData();
    }

    // Setup event listeners for closing the popup
    setupEventListeners() {
        // Close popup when clicking the "REVIEW MY MISTAKES" button
        this.button.addEventListener('click', () => {
            this.hidePopup();
        });

        // Close popup when clicking outside the modal
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.hidePopup();
            }
        });

        // Close popup on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isShown) {
                this.hidePopup();
            }
        });
    }

    // Setup listener for storage changes to update popup when main page gets API data
    setupStorageListener() {
        // Listen for storage changes (when main page saves API data)
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.transcript_stats) {
                console.log('Storage changed, updating popup data');
                this.loadPopupData();
            }
        });
    }

    // Show popup loader
    showPopupLoader() {
        if (this.loader) {
            this.loader.style.display = 'flex';
        }
    }

    // Hide popup loader
    hidePopupLoader() {
        if (this.loader) {
            this.loader.style.display = 'none';
        }
    }

    // Load data for the popup from storage and API
    async loadPopupData() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const transcriptId = urlParams.get('id');

            if (!transcriptId) {
                console.warn('No transcript ID found, using default popup data');
                this.hidePopupLoader();
                return;
            }

            // Get data from chrome storage
            const result = await new Promise(resolve => {
                chrome.storage.local.get(['transcript_stats'], (result) => {
                    resolve(result);
                });
            });

            const allStats = result.transcript_stats || {};
            const stats = allStats[transcriptId] || {};

            console.log('Popup loading data for transcript:', transcriptId, stats);

            let hasEnglishScore = false;
            let hasBasicStats = false;

            // Update unique words count
            const uniqueWordsElement = document.getElementById('popupUniqueWords');
            if (uniqueWordsElement && stats.unique_words_amount !== undefined) {
                uniqueWordsElement.textContent = stats.unique_words_amount;
                hasBasicStats = true;
            }

            // Update speaking time
            const speakingTimeElement = document.getElementById('popupSpeakingTime');
            if (speakingTimeElement && stats.speaking_time_seconds) {
                // Convert seconds to MM:SS format
                const minutes = Math.floor(stats.speaking_time_seconds / 60);
                const seconds = Math.floor(stats.speaking_time_seconds % 60);
                const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                speakingTimeElement.textContent = formattedTime;
                hasBasicStats = true;
            }

            // Update English score from API
            const englishScoreElement = document.getElementById('popupEnglishScore');
            if (englishScoreElement) {
                if (stats.api_englishScore !== undefined) {
                    // Data exists in storage - load immediately
                    englishScoreElement.textContent = stats.api_englishScore;
                    this.updatePopupBasedOnScore(stats.api_englishScore, stats);
                    hasEnglishScore = true;
                } else {
                    console.log('No English score found, waiting for main page to fetch...');
                }
            }

            // Only hide loader if we have English score OR if we have basic stats and should fetch API
            if (hasEnglishScore) {
                this.hidePopupLoader();
            } else if (hasBasicStats) {
                // We have basic stats but no English score - main page should be fetching it
                // Keep loader visible and wait for storage update
                console.log('Keeping loader visible while waiting for English score');
            } else {
                // No stats at all yet
                console.log('No stats found yet, keeping loader visible');
            }

        } catch (error) {
            console.error('Error loading popup data:', error);
            this.hidePopupLoader();
        }
    }

    // Update popup based on the user's English score and generate message
    updatePopupBasedOnScore(score, stats = {}) {
        const titleElement = document.querySelector('.popup-feedback-title');
        const scoreStatElement = document.querySelector('.popup-stat-score');
        const scoreValueElement = document.querySelector('.popup-stat-value-score');
        const messageElement = document.querySelector('.popup-message-text');
        
        let title = 'Amazing result!';
        let color = '#20AD14';
        
        if (score < 30) {
            title = 'Try to improve!';
            color = '#EA4335';
        } else if (score < 45) {
            title = 'Could be better.';
            color = '#FF9F00';
        } else if (score < 60) {
            title = 'Not bad!';
            color = '#FF9F00';
        } else if (score < 80) {
            title = 'Pretty good!';
            color = '#20AD14';
        } else {
            title = 'Amazing result!';
            color = '#20AD14';
        }
        
        // Update title
        if (titleElement) {
            titleElement.textContent = title;
        }
        
        // Update background color
        if (scoreStatElement) {
            scoreStatElement.style.background = `linear-gradient(to left, ${color}, ${color}), linear-gradient(to left, #ffffff, #ffffff)`;
        }
        
        // Update score text color to match background color
        if (scoreValueElement) {
            scoreValueElement.style.color = color;
        }

        // Get transcript ID to save/load message
        const urlParams = new URLSearchParams(window.location.search);
        const transcriptId = urlParams.get('id');
        
        if (messageElement && transcriptId) {
            // Check if we already have a saved message for this meeting
            chrome.storage.local.get([`popup_message_${transcriptId}`], (result) => {
                const savedMessage = result[`popup_message_${transcriptId}`];
                
                if (savedMessage) {
                    // Use saved message
                    messageElement.textContent = savedMessage;
                } else {
                    // Generate new message and save it
                    const messages = this.generateMessages(score, stats);
                    
                    if (messages.length > 0) {
                        const randomIndex = Math.floor(Math.random() * messages.length);
                        const selectedMessage = messages[randomIndex];
                        messageElement.textContent = selectedMessage;
                        
                        // Save this message for future page loads
                        chrome.storage.local.set({ [`popup_message_${transcriptId}`]: selectedMessage });
                    }
                }
            });
        }
    }

    // Generate messages based on user stats
    generateMessages(englishScore, stats) {
        const messages = [];
        
        // Get user stats - ONLY use real data, no defaults
        const wpm = stats.words_per_minute;
        const grammarScore = stats.api_grammarScore;
        const garbageData = stats.garbage_words;
        const garbagePercentage = garbageData ? garbageData.garbagePercentage : undefined;
        const topGarbageWords = garbageData ? garbageData.topGarbageWords : undefined;
        
        console.log('Generating messages with REAL stats only:', { wpm, grammarScore, garbagePercentage, topGarbageWords, englishScore });
        
        // Check WPM conditions - only if we have real WPM data
        if (wpm !== undefined && wpm < 81) {
            messages.push(
                "If your plan was to put the whole meeting to sleep, you're crushing it. Pls, speak faster 🫠",
                "If you speak that slowly again, I might have to help you leave the meeting 😉",
                "If you speak that slowly again, I might have to help you leave the meeting 😉"
            );
        }
        
        if (wpm !== undefined && wpm > 165) {
            messages.push(
                `You just said ${Math.round(wpm)} words per minute. Are you okay? Chill out next time.`,
                "You speak tooooo fast. Leave space for people to process what you said.",
                "You speak tooooo fast. Leave space for people to process what you said."
            );
        }
        
        // Check grammar score - only if we have real grammar data
        if (grammarScore !== undefined && grammarScore < 40) {
            messages.push(
                "Improve your grammar next time. That's not speaking English - that's bullying it.",
                "Your English was almost correct! But it seems your grammar took the day off..",
                "I'm not angry about your grammar mistakes. I'm just... disappointed 🔫",
                "I'm not angry about your grammar mistakes. I'm just... disappointed 🔫",
                "We've updated our privacy policy! Now I can judge your grammar legally 😉"
            );
        }
        
        // Check garbage percentage - only if we have real garbage data
        if (garbagePercentage !== undefined && garbagePercentage > 5 && topGarbageWords) {
            // Get top garbage word
            let topWord = '';
            let topCount = 0;
            
            for (const [word, count] of Object.entries(topGarbageWords)) {
                if (count > topCount) {
                    topWord = word;
                    topCount = count;
                }
            }
            
            if (topWord && topCount > 0) {
                const garbageMessage1 = `Another "${topWord}" on your call and I might just accidentally mute you permanently. Just saying.`;
                const garbageMessage2 = `You said "${topWord}" ${topCount} times. The word deserves a break. Please stop.🙅`;
                
                // Add each message 3 times (total 6 strings)
                for (let i = 0; i < 3; i++) {
                    messages.push(garbageMessage1, garbageMessage2);
                }
            }
        }
        
        // Check English score - only if we have real English score
        if (englishScore !== undefined) {
            if (englishScore < 30) {
                messages.push(
                    "You know what's cool? Progress. You should try it sometime.",
                    "I'm not mad about your English. Just disappointed. And maybe a little mad. 🔪",
                    "If you're trying to speak English really bad, you're doing an amazing job.",
                    "Speak English like this one more time and see what happens. I dare you 🔫",
                    "Trust me - on the English calls your mute button is your best friend 😉"
                );
            } else if (englishScore < 50) {
                messages.push(
                    "Speak English like this one more time and see what happens. I dare you 🔫",
                    "I'm not mad about your English. Just disappointed. And maybe a little mad. 🔪"
                );
            } else if (englishScore > 60) {
                messages.push(
                    "Well done! You are allowed to make one more Google Meet call 🎉",
                    "Well done! You are allowed to make one more Google Meet call 🎉",
                    "Congratulations! You almost sounded fluent in that last call. Almost."
                );
            }
            
            if (englishScore > 79) {
                messages.push(
                    "Congrats! Your English was impressive. Your family is safe… for now. 😉",
                    "Congrats! Your English was impressive. Your family is safe… for now. 😉",
                    "Great job! Your colleagues have voted to remove you from the 'auto-mute' list 🥳",
                    "Congratulations! You almost sounded fluent in that last call. Almost.",
                    "Well done! You are allowed to make one more Google Meet call 🎉",
                    "Well done! You are allowed to make one more Google Meet call 🎉"
                );
            }
        }
        
        // If no messages were added, add default message
        if (messages.length === 0) {
            messages.push("Your English was almost fluent in that last call. Almost. Pls, imporove next time. 🔫");
        }
        
        // Log the complete messages array after all calculations
        console.log('Complete messages array after calculations:', messages);
        
        return messages;
    }

    // Show the popup with animation
    showPopup() {
        if (this.overlay && !this.isShown) {
            this.overlay.classList.add('show');
            this.isShown = true;
            
            // Prevent scrolling when popup is open
            document.body.style.overflow = 'hidden';
        }
    }

    // Hide the popup with animation
    hidePopup() {
        if (this.overlay && this.isShown) {
            this.overlay.classList.remove('show');
            this.isShown = false;
            
            // Restore scrolling
            document.body.style.overflow = '';
            
            // Focus on the main content after popup closes
            const mainContent = document.querySelector('.general');
            if (mainContent) {
                mainContent.focus();
            }
        }
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const popupManager = new PopupManager();
    popupManager.init();
});

// Export for use in other scripts if needed
window.PopupManager = PopupManager; 