// API Service for Fluently Extension
// Handles all API requests to the backend

class ApiService {
    constructor(baseUrl = 'http://localhost:8000') {
        this.baseUrl = baseUrl;
    }

    // Generic method to make API requests
    async makeRequest(endpoint, method = 'GET', data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data ? JSON.stringify(data) : null,
        };

        try {
            console.log(`Making ${method} request to ${url}`, data);
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
            // For development, fallback to test data if API fails
            console.log('Falling back to test data due to API error');
            return TestDataLoader.simulateGrammarResponse(text);
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
        return this.makeRequest('/english_vocabulary', 'POST', { text });
    }

    // Get English stats from the backend
    async getEnglishStats(text) {
        return this.makeRequest('/english_stats', 'POST', { text });
    }
}

// Export the API service
const apiService = new ApiService(); 