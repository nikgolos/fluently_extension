// Popup functionality for post-meeting page
// Shows a popup with quick stats when the page loads

class PopupManager {
    constructor() {
        this.overlay = null;
        this.modal = null;
        this.button = null;
        this.isShown = false;
    }

    // Initialize popup functionality
    init() {
        this.overlay = document.getElementById('popupOverlay');
        this.modal = document.getElementById('popupModal');
        this.button = document.getElementById('popupButton');

        if (!this.overlay || !this.modal || !this.button) {
            console.error('Popup elements not found in DOM');
            return;
        }

        this.setupEventListeners();
        this.loadPopupData();
        this.showPopup();
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

    // Load data for the popup from storage and API
    async loadPopupData() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const transcriptId = urlParams.get('id');

            if (!transcriptId) {
                console.warn('No transcript ID found, using default popup data');
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

            // Update unique words count
            const uniqueWordsElement = document.getElementById('popupUniqueWords');
            if (uniqueWordsElement && stats.unique_words_amount !== undefined) {
                uniqueWordsElement.textContent = stats.unique_words_amount;
            }

            // Update speaking time
            const speakingTimeElement = document.getElementById('popupSpeakingTime');
            if (speakingTimeElement && stats.speaking_time_seconds) {
                // Convert seconds to MM:SS format
                const minutes = Math.floor(stats.speaking_time_seconds / 60);
                const seconds = Math.floor(stats.speaking_time_seconds % 60);
                const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                speakingTimeElement.textContent = formattedTime;
            }

            // Update English score from API
            const englishScoreElement = document.getElementById('popupEnglishScore');
            if (englishScoreElement) {
                if (stats.api_englishScore !== undefined) {
                    englishScoreElement.textContent = stats.api_englishScore;
                    this.updatePopupBasedOnScore(stats.api_englishScore);
                } else {
                    // If no API score yet, show a default value or fetch from API
                    this.fetchEnglishScore(transcriptId, englishScoreElement);
                }
            }

        } catch (error) {
            console.error('Error loading popup data:', error);
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

    // Fetch English score from API if not available in storage
    async fetchEnglishScore(transcriptId, scoreElement) {
        try {
            // Get transcript text from storage
            const transcriptData = await new Promise(resolve => {
                chrome.storage.local.get(['transcripts'], (result) => {
                    const transcripts = result.transcripts || {};
                    resolve(transcripts[transcriptId]);
                });
            });

            if (!transcriptData || !transcriptData.text) {
                console.warn('No transcript text found for API call');
                return;
            }

            // Create API service instance and fetch English stats
            const apiService = new ApiService();
            const response = await apiService.getEnglishStats(transcriptData.text);
            
            if (response && response.general_score !== undefined) {
                const englishScore = Math.round(response.general_score);
                scoreElement.textContent = englishScore;
                this.updatePopupBasedOnScore(englishScore);
                
                // Save the score to storage for future use
                chrome.storage.local.get(['transcript_stats'], (result) => {
                    const allStats = result.transcript_stats || {};
                    if (!allStats[transcriptId]) {
                        allStats[transcriptId] = {};
                    }
                    allStats[transcriptId].api_englishScore = englishScore;
                    chrome.storage.local.set({ transcript_stats: allStats });
                });
            }
        } catch (error) {
            console.error('Error fetching English score from API:', error);
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