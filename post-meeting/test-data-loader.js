// Test Data Loader
// Loads test data from files for development and testing

class TestDataLoader {
    /**
     * Load transcript text from file
     * @returns {Promise<string>} - The transcript text
     */
    static async loadTranscript() {
        try {
            console.log('Loading transcript from file...');
            const response = await fetch('./test-data/transcript.txt');
            if (!response.ok) {
                throw new Error(`Failed to load transcript: ${response.status} ${response.statusText}`);
            }
            const text = await response.text();
            console.log('Transcript loaded successfully:', text.substring(0, 100) + '...');
            return text;
        } catch (error) {
            console.error('Error loading transcript:', error);
            
            // Fallback to hardcoded transcript text for testing
            console.log('Using fallback transcript text');
            return `Hello, good morning!
Can you hear me well, yes? Great.

So my name is Alex, and I calling you from EasyPlan. We are a small company but growing fast, and we help businesses like yours to make better planning and organize tasks more good.

I checked your website before the call and I saw you have a team of more than ten people, right? So I think maybe our product can be helpful for you.

EasyPlan is a simple tool to manage projects. You can make task lists, assign to people, and see progress in calendar view. Also we have reminders, so no one forget what they need to do.

The nice thing is, it’s very easy to use. Even someone who never use planning apps before can learn in one or two days.

We already work with more than 500 companies in Europe, mostly in tech and marketing.

Maybe I ask you, how do you manage your work now? You use some software or it’s all by emails and messages?

Ah, Trello. Yes, many people use that. It’s nice tool but sometime becomes too complex when you have many projects, no?

We are more simple than Trello, and also we have better support. Our team reply fast and can help you to setup everything.

And the price is also better. We charge 5 euro for user per month, which is cheaper than most competitors.

We can offer also one-month free trial so you can try without any risk.

If you want, I can send you email with link for trial and short video how it works. Only take 3 minutes to watch.

Also, I can show you live demo this week. Maybe Thursday or Friday? What day is better for you?

We are not pushing anyone, just want to see if we are fit.

Even if you not decide now, we are happy to stay in contact for future.

So… What you think?`;
        }
    }

    /**
     * Simulate API response for grammar analysis (for testing without backend)
     * @param {string} text - The transcript text
     * @returns {Promise<Object>} - Simulated API response
     */
    static simulateGrammarResponse(text) {
        console.log('Simulating grammar response for testing...');
        // Pre-defined grammar mistakes for testing
        return {
            grammar: {
                mistakes: [
                    {
                        category: "Verb Forms",
                        error: "I calling you from EasyPlan",
                        correct: "I am calling you from EasyPlan",
                        explanation: "Use 'am' with 'I' and present continuous (-ing) verbs."
                    },
                    {
                        category: "Word Order & Phrasing",
                        error: "organize tasks more good",
                        correct: "organize tasks better",
                        explanation: "Use 'better' instead of 'more good' for comparative form."
                    },
                    {
                        category: "Articles & Prepositions",
                        error: "Even someone who never use planning apps",
                        correct: "Even someone who has never used planning apps",
                        explanation: "Use 'has never used' for present perfect negative experience."
                    },
                    {
                        category: "Verb Forms",
                        error: "so no one forget",
                        correct: "so no one forgets",
                        explanation: "Use 's' at the end of verbs with third-person singular subjects."
                    }
                ]
            }
        };
    }
}

// Export the test data loader
const testDataLoader = new TestDataLoader(); 