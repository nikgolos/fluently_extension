// Transcript Stats Calculator
// This module calculates statistics for meeting transcripts

// Function to fix overlapping timestamps in transcript
function fixTranscriptTimestamps(transcriptText) {
  if (!transcriptText) return transcriptText;
  
  console.log("Fixing overlapping timestamps in transcript...");
  
  // Extract all timestamp pairs with their positions
  const startTimeRegex = /\[S:(\d+\.\d+)s\]/g;
  const endTimeRegex = /\[E:(\d+\.\d+)s\]/g;
  
  // Store all timestamps with their positions
  const timestamps = [];
  let match;
  
  // Find all start timestamps
  while ((match = startTimeRegex.exec(transcriptText)) !== null) {
    timestamps.push({
      type: 'start',
      time: parseFloat(match[1]),
      position: match.index,
      length: match[0].length,
      fullMatch: match[0]
    });
  }
  
  // Find all end timestamps
  while ((match = endTimeRegex.exec(transcriptText)) !== null) {
    timestamps.push({
      type: 'end',
      time: parseFloat(match[1]),
      position: match.index,
      length: match[0].length,
      fullMatch: match[0]
    });
  }
  
  // Sort by position in the original text
  timestamps.sort((a, b) => a.position - b.position);
  
  console.log("Found timestamps:", timestamps.length);
  
  // Find pairs and check for overlaps
  const pairs = [];
  const problematicPairs = [];
  
  for (let i = 0; i < timestamps.length - 1; i++) {
    // Check if we have a start-end pair
    if (timestamps[i].type === 'start' && timestamps[i+1].type === 'end') {
      const pair = {
        start: timestamps[i],
        end: timestamps[i+1],
        startTime: timestamps[i].time,
        endTime: timestamps[i+1].time
      };
      
      pairs.push(pair);
      
      // Check if the next start time (if exists) is before current end time
      if (i+2 < timestamps.length && timestamps[i+2].type === 'start') {
        const nextStart = timestamps[i+2];
        if (nextStart.time < pair.endTime) {
          console.log(`Found problematic overlap: End [${pair.endTime}] followed by Start [${nextStart.time}]`);
          problematicPairs.push({
            currentPair: pair,
            nextStart: nextStart
          });
        }
      }
    }
  }
  
  console.log("Total timestamp pairs:", pairs.length);
  console.log("Problematic pairs:", problematicPairs.length);
  
  if (problematicPairs.length === 0) {
    console.log("No problematic overlaps found, transcript is clean.");
    return transcriptText;
  }
  
  // Remove problematic pairs from the transcript
  // We need to remove them from end to start to not mess up positions
  problematicPairs.sort((a, b) => b.currentPair.start.position - a.currentPair.start.position);
  
  let cleanedTranscript = transcriptText;
  
  for (const problem of problematicPairs) {
    const { currentPair, nextStart } = problem;
    
    // Remove both timestamps and preserve text between them
    const startPos = currentPair.start.position;
    const endPos = currentPair.end.position + currentPair.end.length;
    
    // Extract the text between the timestamps (including timestamps)
    const textToReplace = cleanedTranscript.substring(startPos, endPos);
    const textBetweenTimestamps = cleanedTranscript.substring(
      startPos + currentPair.start.length, 
      endPos - currentPair.end.length
    ).trim();
    
    console.log(`Removing overlapping pair: "${textToReplace}" (keeping text: "${textBetweenTimestamps}")`);
    
    // Replace the entire range with just the text between timestamps
    cleanedTranscript = cleanedTranscript.substring(0, startPos) + 
                      (textBetweenTimestamps ? ' ' + textBetweenTimestamps + ' ' : ' ') + 
                      cleanedTranscript.substring(endPos);
  }
  
  // Normalize spaces
  cleanedTranscript = cleanedTranscript.replace(/\s+/g, ' ').trim();
  
  console.log("Original transcript length:", transcriptText.length);
  console.log("Cleaned transcript length:", cleanedTranscript.length);
  
  // If something went wrong and we removed all text, return the original
  if (cleanedTranscript.length < 10 && transcriptText.length > 10) {
    console.warn("Cleaning removed too much text, returning original transcript");
    return transcriptText;
  }
  
  return cleanedTranscript;
}

// Main function to calculate transcript statistics
function calculateTranscriptStats(transcript) {
  if (!transcript || !transcript.text) {
    console.error('Invalid transcript provided for stats calculation');
    return {
      unique_words_amount: 0,
      total_words: 0,
      words_per_minute: 0,
      meeting_length: '00h 00m 00s',
      speaking_time: '00h 00m 00s'
    };
  }

  console.log("Calculating stats for transcript:", transcript.id);
  console.log("Transcript text sample:", transcript.text.slice(0, 100) + "...");
  
  // First, fix any overlapping timestamps for calculation purposes only
  const originalText = transcript.text;
  const fixedText = fixTranscriptTimestamps(originalText);
  
  // Log if timestamps were fixed
  if (fixedText !== originalText) {
    console.log("Transcript timestamps were fixed for calculation purposes.");
    console.log("Original length:", originalText.length, "Fixed length:", fixedText.length);
  }

  // Calculate unique words and total words using the fixed text
  const { uniqueWordsCount, totalWords } = calculateWordStats(fixedText);
  
  // Validate the word counts
  console.log("Validating word counts:", { 
    totalWords, 
    uniqueWordsCount, 
    textLength: fixedText.length,
    hasTimestamps: fixedText.includes('[S:') && fixedText.includes('[E:')
  });
  
  // Calculate Meeting Duration and speaking time using the fixed text
  const { meetingLength, speakingTime, speakingTimeSeconds } = calculateTimeStats(fixedText);
  
  // Calculate words per minute using the corrected speaking time
  let wpm = 0;
  if (speakingTimeSeconds > 0 && totalWords > 0) {
    wpm = parseFloat(((totalWords / speakingTimeSeconds) * 60 * 1.1).toFixed(1));
    console.log(`WPM calculation: (${totalWords} words / ${speakingTimeSeconds} seconds) * 60 = ${wpm}`);
  } else if (totalWords > 0) {
    // If for some reason we have words but no valid speaking time, estimate based on 1 word per second
    const estimatedSeconds = Math.max(totalWords, 1);
    wpm = parseFloat(((totalWords / estimatedSeconds) * 60).toFixed(1));
    console.log(`Estimated WPM: (${totalWords} words / ${estimatedSeconds} estimated seconds) * 60 = ${wpm}`);
  }
  
  // Verify all values are valid
  if (isNaN(wpm)) wpm = 0;
  if (wpm < 0) wpm = 0;
  
  const stats = {
    transcript_id: transcript.id,
    session_id: transcript.sessionId,
    meeting_id: transcript.meetingId,
    unique_words_amount: uniqueWordsCount,
    total_words: totalWords,
    words_per_minute: wpm,
    meeting_length: meetingLength,
    speaking_time: speakingTime,
    speaking_time_seconds: speakingTimeSeconds,
    timestamp: new Date().toISOString(),
    timestamps_fixed_for_calculation: fixedText !== originalText
  };
  
  console.log("Final calculated stats:", stats);
  
  // Calculate garbage word stats
  return calculateGarbageWordStats(fixedText)
    .then(garbageStats => {
      // Add garbage stats to the overall stats
      stats.garbage_words = garbageStats;
      
      const fluencyScoreResult = calculateFluencyScore(wpm, garbageStats.garbagePercentage);
      stats.fluency_score = fluencyScoreResult.fluencyScore;
      console.log(`Added fluency_score to stats: ${stats.fluency_score} (WPM Penalty: ${fluencyScoreResult.wpmPenalty}, Garbage Penalty: ${fluencyScoreResult.garbagePenalty})`);
      
      // Store the stats
      saveTranscriptStats(stats, transcript.id);
      
      return stats;
    })
    .catch(error => {
      console.error("Error calculating garbage word stats:", error);
      
      // Store the stats we have even if garbage stats failed
      saveTranscriptStats(stats, transcript.id);
      
      return stats;
    });
}

// Calculate Meeting Duration and speaking time from transcript
function calculateTimeStats(text) {
  // Extract all timestamp pairs
  const startTimeRegex = /\[S:(\d+\.\d+)s\]/g;
  const endTimeRegex = /\[E:(\d+\.\d+)s\]/g;
  
  const startTimes = [];
  const endTimes = [];
  
  // Store the original indices to keep track of pairs
  const timeSegments = [];
  
  let match;
  let startTimeMatches = [];
  while ((match = startTimeRegex.exec(text)) !== null) {
    const startTime = parseFloat(match[1]);
    startTimes.push(startTime);
    startTimeMatches.push(match[0]);
    
    // Store the start position for matching with end times
    timeSegments.push({
      start: startTime,
      end: null,
      index: timeSegments.length
    });
  }
  
  let endTimeMatches = [];
  let endIndex = 0;
  while ((match = endTimeRegex.exec(text)) !== null) {
    const endTime = parseFloat(match[1]);
    endTimes.push(endTime);
    endTimeMatches.push(match[0]);
    
    // Associate with the corresponding start time if possible
    if (endIndex < timeSegments.length) {
      timeSegments[endIndex].end = endTime;
      endIndex++;
    }
  }

  
  if (startTimes.length === 0 || endTimes.length === 0) {
    console.warn("No speaking times found in transcript");
    return {
      meetingLength: '00h 00m 00s',
      speakingTime: '00h 00m 00s',
      speakingTimeSeconds: 0
    };
  }
  
  // Filter out invalid segments (where end time is null or start > end)
  const validSegments = timeSegments.filter(segment => 
    segment.end !== null && segment.start < segment.end
  );
  
  console.log("Valid time segments before merging:", validSegments);
  
  // Sort segments by start time
  validSegments.sort((a, b) => a.start - b.start);
  
  // Merge overlapping segments
  const mergedSegments = [];
  if (validSegments.length > 0) {
    let currentSegment = { ...validSegments[0] };
    
    for (let i = 1; i < validSegments.length; i++) {
      const segment = validSegments[i];
      
      // If current segment overlaps with the next one
      if (segment.start <= currentSegment.end) {
        // Extend the current segment if needed
        currentSegment.end = Math.max(currentSegment.end, segment.end);
      } else {
        // No overlap, add the current segment and start a new one
        mergedSegments.push(currentSegment);
        currentSegment = { ...segment };
      }
    }
    
    // Add the last segment
    mergedSegments.push(currentSegment);
  }
  
  console.log("Merged time segments:", mergedSegments);
  
  // Calculate total speaking time from merged segments
  let totalSpeakingTimeSeconds = 0;
  
  for (const segment of mergedSegments) {
    const duration = segment.end - segment.start;
    totalSpeakingTimeSeconds += duration;
    console.log(`Merged interval: ${segment.start}s to ${segment.end}s = ${duration}s`);
  }
  
  // Calculate Meeting Duration (take the last end time as Meeting Duration)
  const meetingLengthSeconds = Math.max(...endTimes);
  
  console.log("Total speaking time (after merging overlaps):", totalSpeakingTimeSeconds, "seconds");
  console.log("Meeting Duration:", meetingLengthSeconds, "seconds");
  
  return {
    meetingLength: formatTimeDisplay(meetingLengthSeconds),
    speakingTime: formatTimeDisplay(totalSpeakingTimeSeconds),
    speakingTimeSeconds: totalSpeakingTimeSeconds
  };
}

// Format seconds into 00h 00m 00s format
function formatTimeDisplay(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

// Calculate word stats (unique words and total words) in a transcript
function calculateWordStats(text) {
  // First, make sure all timestamp markers are completely removed
  // This regex will match markers like [S:123.4s] and [E:123.4s] or any similar format
  const timestampRegex = /\[\s*[SE]:\s*\d+(?:\.\d+)?s\s*\]/g;
  const cleanedText = text.replace(timestampRegex, ' ');
  
  // Second cleaning pass to ensure no brackets remain and normalize spaces
  const cleanText = cleanedText.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Split by single spaces to properly count words
  const allWords = cleanText.split(' ').filter(word => word.length > 0);
  
  console.log("Total word count:", allWords.length);
  
  // Clean up words for unique counting - preserve contractions like "don't"
  const cleanedWords = allWords.map(word => {
    // Convert to lowercase first
    let cleaned = word.toLowerCase();
    
    // Special handling for contractions - preserve the apostrophe in words like "don't"
    if (cleaned.includes("'")) {
      return cleaned;
    }
    
    // Remove punctuation for other words
    return cleaned.replace(/[.,!?;:()"'-]/g, '');
  }).filter(word => word.length > 0);
  
  // Count unique words
  const uniqueWords = new Set(cleanedWords);
  
  console.log("Unique word count:", uniqueWords.size);
  
  return {
    uniqueWordsCount: uniqueWords.size,
    totalWords: allWords.length
  };
}

// Calculate words per minute from a transcript with timestamps
function calculateWordsPerMinute(text, totalWords = null) {
  // Extract all timestamp pairs
  const startTimeRegex = /\[S:(\d+\.\d+)s\]/g;
  const endTimeRegex = /\[E:(\d+\.\d+)s\]/g;
  
  const startTimes = [];
  const endTimes = [];
  
  // Create a copy of the text for debugging
  const debugText = text;
  
  let match;
  while ((match = startTimeRegex.exec(text)) !== null) {
    startTimes.push(parseFloat(match[1]));
  }
  
  while ((match = endTimeRegex.exec(text)) !== null) {
    endTimes.push(parseFloat(match[1]));
  }
  
  // Count words if not provided
  if (totalWords === null) {
    // Count words (excluding timestamp markers)
    const cleanText = text.replace(/\[S:\d+\.\d+s\]|\[E:\d+\.\d+s\]/g, '');
    totalWords = cleanText.split(/\s+/).filter(word => word.length > 0).length;
  }
  
  // Log for debugging
  console.log("Start times:", startTimes);
  console.log("End times:", endTimes);
  console.log("Total words:", totalWords);
  
  // Check for valid pairs
  if (startTimes.length !== endTimes.length) {
    console.warn('Timestamp mismatch - different number of start and end markers:', 
                startTimes.length, endTimes.length);
    // If we have words, use default WPM to avoid showing 0
    if (totalWords > 0) {
      return 60.0;
    }
    return 0;
  }
  
  if (startTimes.length === 0) {
    console.warn('No timestamps found in transcript');
    // If we have words, use default WPM to avoid showing 0
    if (totalWords > 0) {
      return 60.0;
    }
    return 0;
  }
  
  // Calculate total speaking time in seconds
  let totalSpeakingTimeSeconds = 0;
  let validIntervals = 0;
  
  for (let i = 0; i < startTimes.length; i++) {
    // Ensure valid time range
    if (endTimes[i] > startTimes[i]) {
      const interval = endTimes[i] - startTimes[i];
      totalSpeakingTimeSeconds += interval;
      validIntervals++;
      console.log(`Interval ${i+1}: ${startTimes[i]}s to ${endTimes[i]}s = ${interval}s`);
    } else {
      console.warn(`Invalid time interval at position ${i}: start ${startTimes[i]}s, end ${endTimes[i]}s`);
    }
  }
  
  console.log("Total speaking time calculated:", totalSpeakingTimeSeconds, "seconds");
  console.log("Valid intervals:", validIntervals);
  
  // Calculate words per minute
  if (totalSpeakingTimeSeconds > 0) {
    const wpm = (totalWords / totalSpeakingTimeSeconds) * 60;
    console.log(`WPM calculation: (${totalWords} words / ${totalSpeakingTimeSeconds} seconds) * 60 = ${wpm}`);
    return parseFloat(wpm.toFixed(2)); // Round to 2 decimal places
  } else if (totalWords > 0) {
    // This case means we have words but the speaking time calculation resulted in 0
    console.log("Using default WPM (60) because speaking time is 0 but words exist:", totalWords);
    
    // Look at the transcript and try to estimate based on full transcript duration
    if (endTimes.length > 0) {
      const lastTimestamp = Math.max(...endTimes);
      const firstTimestamp = Math.min(...startTimes);
      const totalDuration = lastTimestamp - firstTimestamp;
      
      if (totalDuration > 0) {
        const estimatedWpm = (totalWords / totalDuration) * 60;
        console.log(`Estimated WPM based on total duration: (${totalWords} words / ${totalDuration} seconds) * 60 = ${estimatedWpm}`);
        return parseFloat(estimatedWpm.toFixed(2));
      }
    }
    
    // Fallback to default
    return 60.0;
  } else {
    return 0;
  }
}

// Save transcript stats to storage
function saveTranscriptStats(stats, transcriptId) {
  // Get existing stats
  chrome.storage.local.get(['transcript_stats'], (result) => {
    const allStats = result.transcript_stats || {};
    
    // Add new stats with transcript ID as key
    allStats[transcriptId] = stats;
    
    // Save back to storage
    chrome.storage.local.set({ transcript_stats: allStats }, () => {
      console.log('Transcript stats saved:', stats);
    });
  });
}

// Get stats for a specific transcript
function getTranscriptStats(transcriptId, callback) {
  chrome.storage.local.get(['transcript_stats'], (result) => {
    const allStats = result.transcript_stats || {};
    const stats = allStats[transcriptId] || null;
    callback(stats);
  });
}

// Get all saved transcript stats
function getAllTranscriptStats(callback) {
  chrome.storage.local.get(['transcript_stats'], (result) => {
    const allStats = result.transcript_stats || {};
    callback(allStats);
  });
}

// Function to count garbage/filler words in a transcript
function calculateGarbageWordStats(text) {
  // First, clean the text by removing timestamps
  const timestampRegex = /\[\s*[SE]:\s*\d+(?:\.\d+)?s\s*\]/g;
  const cleanedText = text.replace(timestampRegex, ' ');
  
  // Second cleaning pass to ensure no brackets remain and normalize spaces
  const cleanText = cleanedText.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  
  // Get total word count for percentage calculation
  const totalWords = cleanText.split(' ').filter(word => word.length > 0).length;
  
  // Load the filler words dictionary
  return new Promise((resolve, reject) => {
    fetch(chrome.runtime.getURL('fillers.json'))
      .then(response => response.json())
      .then(data => {
        const fillerDict = data.fillerWords;
        
        // Track all garbage words and their counts
        const garbageWordsCount = {
          total: 0,
          byCategory: {},
          uniqueGarbage: {}
        };
        
        // Initialize count for each category
        for (const category in fillerDict) {
          garbageWordsCount.byCategory[category] = 0;
        }
        
        // Split text into words
        const words = cleanText.split(' ').filter(word => word.length > 0);
        
        // Check each word against the filler dictionary
        for (const word of words) {
          // Clean the word of punctuation
          const cleanWord = word.replace(/[.,!?;:()"'-]/g, '');
          if (cleanWord.length === 0) continue;
          
          // Check each category for matches
          for (const category in fillerDict) {
            if (fillerDict[category].includes(cleanWord)) {
              garbageWordsCount.total++;
              garbageWordsCount.byCategory[category]++;
              
              // For "others" category, track individual word counts
              if (category === 'others') {
                if (!garbageWordsCount.uniqueGarbage[cleanWord]) {
                  garbageWordsCount.uniqueGarbage[cleanWord] = 0;
                }
                garbageWordsCount.uniqueGarbage[cleanWord]++;
              }
              
              break; // Once found in a category, no need to check others
            }
          }
        }
        
        // Convert category totals to the display format
        const topGarbageWords = {};
        
        // Add category totals that meet the threshold (3 or more)
        for (const category in garbageWordsCount.byCategory) {
          const count = garbageWordsCount.byCategory[category];
          if (count >= 3 && category !== 'others') {
            topGarbageWords[category] = count;
          }
        }
        
        // Add individual words from 'others' category that meet the threshold
        const othersWordsArray = Object.entries(garbageWordsCount.uniqueGarbage)
          .filter(([word, count]) => count >= 2) // Only include words with frequency >= 3
          .sort((a, b) => b[1] - a[1]); // Sort by count (descending)
        
        // Take the top 3 words from 'others' category
        const topOthersWords = othersWordsArray.slice(0, 3);
        
        // Add top 'others' words to the result
        topOthersWords.forEach(([word, count]) => {
          topGarbageWords[word] = count;
        });
        
        // Calculate the total of garbage words that appear at least 2 times
        let totalGarbageWordsFrequent = 0;
        
        // Count words from categories (excluding 'others')
        for (const category in garbageWordsCount.byCategory) {
          if (category !== 'others') {
            totalGarbageWordsFrequent += garbageWordsCount.byCategory[category];
          }
        }
        
        // Count only words from 'others' that appear at least 2 times
        Object.values(garbageWordsCount.uniqueGarbage).forEach(count => {
          if (count >= 2) {
            totalGarbageWordsFrequent += count;
          }
        });
        
        // Calculate percentage of frequent garbage words from total words
        const garbagePercentage = totalWords > 0 ? 
          Math.round((totalGarbageWordsFrequent / totalWords) * 100) : 0;
        
        const result = {
          totalGarbageWords: totalGarbageWordsFrequent,
          garbageWordsByCategory: garbageWordsCount.byCategory,
          topGarbageWords: topGarbageWords,
          garbagePercentage: garbagePercentage
        };
        
        console.log("Garbage word stats:", result);
        resolve(result);
      })
      .catch(error => {
        console.error("Error loading or processing filler words:", error);
        // Return empty stats if there's an error
        resolve({
          totalGarbageWords: 0,
          garbageWordsByCategory: {},
          topGarbageWords: {},
          garbagePercentage: 0
        });
      });
  });
}

// Calculate fluency score based on WPM and garbage words percentage
function calculateFluencyScore(wpm, garbagePercentage) {
  
  let wpmPenalty = 0;
  let garbagePenalty = 0;
  
  // Calculate WPM penalty
  if (wpm > 200 || wpm < 40) {
    wpmPenalty = 59;
  } else if (wpm > 185 || wpm < 50) {
    wpmPenalty = 46;
  } else if (wpm > 170 || wpm < 65) {
    wpmPenalty = 33;
  } else if (wpm > 155 || wpm < 90) {
    wpmPenalty = 17;
  } else if (wpm > 145 || wpm < 100) {
    wpmPenalty = 9;
  } else if (wpm > 140 || wpm < 115) {
    wpmPenalty = 4;
  } else {
    wpmPenalty = Math.floor(Math.random() * 5);
  }
  
  // Calculate garbage words penalty
  if (garbagePercentage > 10) {
    garbagePenalty = garbagePercentage * 4;
  } else if (garbagePercentage > 7) {
    garbagePenalty = garbagePercentage * 3.5;
  } else if (garbagePercentage > 4) {
    garbagePenalty = garbagePercentage * 2.5;
  } else if (garbagePercentage > 2.5) {
    garbagePenalty = garbagePercentage * 2;
  } else {
    garbagePenalty = Math.floor(Math.random() * 5);
  }
  
  // Calculate total penalty
  let totalPenalty = Math.round(wpmPenalty + garbagePenalty);

  // Cap penalty at 99
  if (totalPenalty > 99) {
    totalPenalty = 99;
  }
  
  // Calculate fluency score
  const fluencyScore = 100 - totalPenalty;
  
  return {
    fluencyScore,
    wpmPenalty,
    garbagePenalty,
    totalPenalty
  };
}

// Export functions
window.TranscriptStats = {
  calculateTranscriptStats,
  getTranscriptStats,
  getAllTranscriptStats,
  fixTranscriptTimestamps,
  calculateGarbageWordStats,
  calculateFluencyScore
}; 