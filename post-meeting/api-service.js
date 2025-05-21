// API Service for Duo Extension
// Handles all API requests to the backend

class ApiService {
    constructor(baseUrl = 'https://duo-extension-backend-c967e08eb592.herokuapp.com') {
        this.baseUrl = baseUrl;
    }

    // Method to get or set userID
    async getOrSetUserID() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['userID'], (result) => {
                let currentUserID = result.userID;
                if (currentUserID) {
                    console.log('Found userID in storage:', currentUserID);
                    resolve(currentUserID);
                } else {
                    const timestamp = Date.now();
                    const randomNumber = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                    currentUserID = `${timestamp}-${randomNumber}`;
                    chrome.storage.local.set({ userID: currentUserID }, () => {
                        console.log('Generated and saved new userID:', currentUserID);
                        resolve(currentUserID);
                    });
                }
            });
        });
    }

    // Generic method to make API requests
    async makeRequest(endpoint, method = 'GET', data = null) {
        const userID = await this.getOrSetUserID();
        console.log('[API CALL] Current userID:', userID);
        let requestData = data ? { ...data } : {}; // Clone data or create new object

        // Add userID to the request data
        requestData.userID = userID;

        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData), // Always stringify requestData, even for GET
        };

        // For GET requests, if the original data was null, body might not be appropriate.
        // However, to consistently send userID, we'll include it in the body for all methods.
        // If specific GET endpoints cannot accept a body, this might need adjustment
        // or userID could be added as a query parameter for GET.
        // For now, we proceed with including it in the body.

        try {
            console.log(`Making ${method} request to ${url}`, requestData);
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log(`API response from ${endpoint}:`, result);
            return result;
        } catch (error) {
            console.error('API request error:', error);
            throw error;
        }
    }

    // Get grammar analysis from the backend
    async getGrammarAnalysis(text) {
        try {
            const response = await this.makeRequest('/english_grammar', 'POST', { text });
            
            // Normalize the response to ensure proper structure
            if (!response.grammar || !response.grammar.mistakes) {
                console.warn('API response missing expected grammar.mistakes structure:', response);
                
                // If the API returned mistakes in a different format, try to normalize it
                if (response.mistakes && Array.isArray(response.mistakes)) {
                    console.log('Found mistakes array at root level, normalizing response');
                    return { grammar: { mistakes: response.mistakes } };
                }
                
                // If we find a different structure with potential mistakes, try to extract them
                const possibleMistakes = this.findMistakesInResponse(response);
                if (possibleMistakes.length > 0) {
                    console.log('Extracted mistakes from non-standard response format');
                    return { grammar: { mistakes: possibleMistakes } };
                }
                
                // If we couldn't find any mistakes in the response
                console.warn('Could not find mistakes in API response, returning empty array');
                return { grammar: { mistakes: [] } };
            }
            
            return response;
        } catch (error) {
            console.error('Failed to get grammar analysis:', error);
            // Return an empty result on error
            return { grammar: { mistakes: [] } };
        }
    }

    // Helper method to try to find mistakes in a non-standard response format
    findMistakesInResponse(response) {
        const mistakes = [];
        
        // Function to recursively search for mistake-like objects in the response
        const findMistakeObjects = (obj, path = '') => {
            if (!obj || typeof obj !== 'object') return;
            
            // Check if this object looks like a mistake
            if (obj.error && obj.correct && (obj.category || obj.explanation)) {
                mistakes.push({
                    category: obj.category || 'Other',
                    error: obj.error,
                    correct: obj.correct,
                    explanation: obj.explanation || 'Grammar issue detected'
                });
                return;
            }
            
            // Recursively search in nested objects and arrays
            for (const key in obj) {
                const newPath = path ? `${path}.${key}` : key;
                
                if (Array.isArray(obj[key])) {
                    obj[key].forEach((item, index) => {
                        findMistakeObjects(item, `${newPath}[${index}]`);
                    });
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    findMistakeObjects(obj[key], newPath);
                }
            }
        };
        
        findMistakeObjects(response);
        return mistakes;
    }

    // Get vocabulary suggestions from the backend
    async getVocabularyAnalysis(text) {
        try {
            const response = await this.makeRequest('/english_vocabulary', 'POST', { text });
            console.log('Raw vocabulary response:', response);
            
            // Normalize the response to ensure proper structure
            if (!response.vocabulary || 
                (!response.vocabulary.synonyms && 
                 !response.vocabulary.rephrasing && 
                 !response.vocabulary.vocabulary_elevation && 
                 !response.vocabulary.native_phrasing)) {
                console.warn('API response missing expected vocabulary structure:', response);
                
                // Try to normalize the response if it has a different structure
                const normalizedResponse = this.normalizeVocabularyResponse(response);
                if (normalizedResponse) {
                    console.log('Normalized vocabulary response structure');
                    return normalizedResponse;
                }
                
                // If we couldn't normalize, return empty structure
                console.warn('Could not find vocabulary suggestions in API response, returning empty arrays');
                return { vocabulary: { synonyms: [], rephrasing: [] } };
            }
            
            // If the response uses vocabulary_elevation and native_phrasing fields instead of synonyms and rephrasing
            if (response.vocabulary.vocabulary_elevation || response.vocabulary.native_phrasing) {
                const normalized = {
                    vocabulary: {
                        synonyms: response.vocabulary.vocabulary_elevation || [],
                        rephrasing: response.vocabulary.native_phrasing || []
                    }
                };
                console.log('Normalized vocabulary field names:', normalized);
                return normalized;
            }
            
            return response;
        } catch (error) {
            console.error('Failed to get vocabulary analysis:', error);
            // Return an empty result on error
            return { vocabulary: { synonyms: [], rephrasing: [] } };
        }
    }
    
    // Helper method to try to normalize a non-standard vocabulary response
    normalizeVocabularyResponse(response) {
        // If the response has synonyms, rephrasing, vocabulary_elevation, or native_phrasing at the root level
        if (response.synonyms || response.rephrasing || 
            response.vocabulary_elevation || response.native_phrasing) {
            console.log('Found vocabulary data at root level, normalizing');
            return {
                vocabulary: {
                    synonyms: response.synonyms || response.vocabulary_elevation || [],
                    rephrasing: response.rephrasing || response.native_phrasing || []
                }
            };
        }
        
        // Look for any arrays that might contain vocabulary suggestions
        for (const key in response) {
            if (Array.isArray(response[key])) {
                // Check if this array contains objects that look like synonym suggestions
                const potentialSynonyms = response[key].filter(item => 
                    item.original && item.to_replace && Array.isArray(item.suggestions));
                    
                // Check if this array contains objects that look like rephrasing suggestions
                const potentialRephrasing = response[key].filter(item => 
                    item.original && item.native_version);
                
                if (potentialSynonyms.length > 0 || potentialRephrasing.length > 0) {
                    console.log('Found potential vocabulary suggestions in', key);
                    return {
                        vocabulary: {
                            synonyms: potentialSynonyms,
                            rephrasing: potentialRephrasing
                        }
                    };
                }
            }
            
            // If this is an object, check if it has vocabulary_elevation or native_phrasing fields
            if (typeof response[key] === 'object' && response[key] !== null) {
                if (response[key].vocabulary_elevation || response[key].native_phrasing) {
                    console.log('Found vocabulary_elevation/native_phrasing in', key);
                    return {
                        vocabulary: {
                            synonyms: response[key].vocabulary_elevation || [],
                            rephrasing: response[key].native_phrasing || []
                        }
                    };
                }
            }
        }
        
        return null;
    }

    // Get English stats from the backend
    async getEnglishStats(text) {
        return this.makeRequest('/english_stats', 'POST', { text });
    }
}

// Export the API service
const apiService = new ApiService(); 