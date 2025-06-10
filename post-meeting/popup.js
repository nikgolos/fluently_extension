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
                    this.updatePopupBasedOnScore(stats.api_englishScore);
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

    // Update popup based on the user's English score
    updatePopupBasedOnScore(score) {
        const titleElement = document.querySelector('.popup-feedback-title');
        const scoreStatElement = document.querySelector('.popup-stat-score');
        const scoreValueElement = document.querySelector('.popup-stat-value-score');
        
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