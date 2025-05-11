// Text Comparator Utility
// Compares error and correct strings to create formatted HTML

class TextComparator {
    /**
     * Compare two strings word by word and return HTML with highlighted differences
     * @param {string} errorString - The string with errors
     * @param {string} correctString - The corrected string
     * @returns {string} - HTML string with highlighted differences
     */
    static compareStrings(errorString, correctString) {
        // Split strings into arrays of words
        const errorWords = errorString.split(' ');
        const correctWords = correctString.split(' ');
        
        let resultHTML = '';
        let errorIndex = 0;
        let correctIndex = 0;
        
        // Buffer to collect red and green words in a sequence
        let redBuffer = [];
        let greenBuffer = [];
        
        // Function to flush buffers and add to result
        const flushBuffers = () => {
            // Add all red words first
            redBuffer.forEach(word => {
                resultHTML += `<span class="strikethrough-word">${word}</span> `;
            });
            
            // Then add all green words
            greenBuffer.forEach(word => {
                resultHTML += `<span class="added-word">${word}</span> `;
            });
            
            // Clear buffers
            redBuffer = [];
            greenBuffer = [];
        };
        
        // Compare words until we reach the end of both arrays
        while (errorIndex < errorWords.length || correctIndex < correctWords.length) {
            const errorWord = errorIndex < errorWords.length ? errorWords[errorIndex] : null;
            const correctWord = correctIndex < correctWords.length ? correctWords[correctIndex] : null;
            
            // If words are the same, add as normal text and flush any buffers
            if (errorWord === correctWord) {
                flushBuffers();
                resultHTML += `<span class="normal-word">${errorWord}</span> `;
                errorIndex++;
                correctIndex++;
            }
            // If words are different but similar, add to buffers
            else if (errorWord && correctWord && this.areWordsSimilar(errorWord, correctWord)) {
                redBuffer.push(errorWord);
                greenBuffer.push(correctWord);
                errorIndex++;
                correctIndex++;
            }
            // If the correct string has an extra word
            else if (!errorWord || (errorWord !== correctWord && 
                     (correctIndex + 1 < correctWords.length && errorWord === correctWords[correctIndex + 1]))) {
                greenBuffer.push(correctWord);
                correctIndex++;
            }
            // If the error string has an extra word
            else if (!correctWord || (errorWord !== correctWord && 
                     (errorIndex + 1 < errorWords.length && correctWord === errorWords[errorIndex + 1]))) {
                redBuffer.push(errorWord);
                errorIndex++;
            }
            // If words are completely different
            else {
                redBuffer.push(errorWord);
                greenBuffer.push(correctWord);
                errorIndex++;
                correctIndex++;
            }
            
            // If we've reached the end, flush any remaining buffers
            if (errorIndex >= errorWords.length && correctIndex >= correctWords.length) {
                flushBuffers();
            }
        }
        
        return resultHTML.trim();
    }
    
    /**
     * Check if two words are similar (simple implementation)
     * @param {string} word1 
     * @param {string} word2 
     * @returns {boolean}
     */
    static areWordsSimilar(word1, word2) {
        // Simple similarity check for basic cases
        const w1 = word1.toLowerCase();
        const w2 = word2.toLowerCase();
        
        // Check for plurals, tense changes, etc.
        if (w1.startsWith(w2) || w2.startsWith(w1)) {
            return true;
        }
        
        return false;
    }
}

// CSS classes for styling
const textComparatorStyles = `
<style>
.normal-word {
    color: black;
}
.strikethrough-word {
    color: red;
    text-decoration: line-through;
}
.added-word {
    color: green;
}
</style>
`;

// Add styles to document
document.head.insertAdjacentHTML('beforeend', textComparatorStyles); 