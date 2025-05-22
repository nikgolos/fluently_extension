class VADProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    // Initialize variables for adaptive threshold with improved sensitivity
    this.energySamples = [];
    this.lastEnergyLevel = 0;
    this.vadEnergyThreshold = 0.015; // Slightly higher initial threshold to avoid echo triggering
    this.ENERGY_SAMPLE_COUNT = 15; // Increased sample count for better adaptation
    
    // Frequency analysis parameters
    this.sampleRate = 48000; // Default sample rate
    this.voiceFreqLow = 85;  // Lower bound of human voice frequency
    this.voiceFreqHigh = 3000; // Upper bound of typical human voice
    
    // Echo detection parameters
    this.lastFrames = new Array(5).fill(new Float32Array(128)); // Store recent frames for echo pattern detection
    this.echoThreshold = 0.85; // Correlation threshold for echo detection
    this.consecutiveFrames = 0; // Count of consecutive frames with voice
    this.minConsecutiveFrames = 3; // Minimum consecutive frames to confirm voice (not echo)
    
    // Get sample rate from processor options if available
    if (options && options.processorOptions) {
      if (options.processorOptions.sampleRate) {
        this.sampleRate = options.processorOptions.sampleRate;
        console.log(`VAD using sample rate: ${this.sampleRate}`);
      }
    }
  }

  process(inputs, outputs) {
    // Get the input data
    const input = inputs[0][0];
    
    if (input && input.length > 0) {
      // Check for voice activity and post the result back to the main thread
      const hasVoice = this.detectVoiceActivity(input);
      
      // Store current frame for echo detection
      this.lastFrames.shift();
      this.lastFrames.push(input.slice(0));
      
      // Send voice activity status to main thread
      this.port.postMessage({ hasVoice });
    }
    
    // Return true to keep the processor running
    return true;
  }
  
  // Enhanced voice activity detection with frequency analysis and echo rejection
  detectVoiceActivity(audioData) {
    if (!audioData || audioData.length === 0) return false;
    
    // 1. Basic energy calculation
    let energy = 0;
    for (let i = 0; i < audioData.length; i++) {
      energy += Math.abs(audioData[i]);
    }
    energy = energy / audioData.length;
    this.lastEnergyLevel = energy;
    
    // 2. Frequency analysis for voice vs. speaker sound
    const isHumanVoiceFrequency = this.analyzeFrequencyContent(audioData);
    
    // 3. Echo pattern detection
    const isEchoPattern = this.detectEchoPattern(audioData);
    
    // 4. Adaptive threshold calculation
    this.energySamples.push(energy);
    if (this.energySamples.length > this.ENERGY_SAMPLE_COUNT) {
      this.energySamples.shift();
      
      // Sort energy samples to find median and percentiles
      const sortedSamples = [...this.energySamples].sort((a, b) => a - b);
      const medianEnergy = sortedSamples[Math.floor(sortedSamples.length / 2)];
      
      // Set threshold dynamically based on recent energy levels
      // Use higher threshold when we detect potential echo patterns
      const multiplier = isEchoPattern ? 1.5 : 1.3;
      this.vadEnergyThreshold = medianEnergy * multiplier;
    }
    
    // 5. Combined decision logic
    const energyAboveThreshold = energy > this.vadEnergyThreshold;
    
    // Only count as voice if:
    // - Energy is above threshold
    // - Frequency pattern matches human voice
    // - Not detected as an echo pattern
    const potentialVoice = energyAboveThreshold && isHumanVoiceFrequency && !isEchoPattern;
    
    // 6. Require consecutive frames of voice for confirmation
    if (potentialVoice) {
      this.consecutiveFrames++;
    } else {
      this.consecutiveFrames = 0;
    }
    
    // Only report voice after several consecutive frames to avoid false positives
    return this.consecutiveFrames >= this.minConsecutiveFrames;
  }
  
  // Simple frequency analysis to detect human voice patterns
  analyzeFrequencyContent(audioData) {
    // Simple zero-crossing rate analysis as a basic frequency estimator
    let zeroCrossings = 0;
    for (let i = 1; i < audioData.length; i++) {
      if ((audioData[i] >= 0 && audioData[i-1] < 0) || 
          (audioData[i] < 0 && audioData[i-1] >= 0)) {
        zeroCrossings++;
      }
    }
    
    // Estimate frequency from zero crossing rate
    const estimatedFreq = (zeroCrossings * this.sampleRate) / (2 * audioData.length);
    
    // Check if frequency is in human voice range
    return estimatedFreq >= this.voiceFreqLow && estimatedFreq <= this.voiceFreqHigh;
  }
  
  // Detect echo patterns by comparing current frame with delayed frames
  detectEchoPattern(currentFrame) {
    // Skip if we don't have enough history
    if (this.lastFrames.length < 3) return false;
    
    // Compare current frame with frames from 2-3 positions back
    // Typical echo delay is around 50-200ms
    for (let backPosition = 2; backPosition <= 3; backPosition++) {
      if (this.lastFrames.length <= backPosition) continue;
      
      const oldFrame = this.lastFrames[this.lastFrames.length - 1 - backPosition];
      
      // Calculate correlation between current frame and past frame
      let correlation = this.calculateCorrelation(currentFrame, oldFrame);
      
      // If correlation is high, this might be an echo
      if (correlation > this.echoThreshold) {
        return true;
      }
    }
    
    return false;
  }
  
  // Calculate correlation between two audio frames
  calculateCorrelation(frame1, frame2) {
    // Use a simplified correlation calculation
    // Only use a portion of the frames for efficiency
    const sampleSize = Math.min(frame1.length, frame2.length, 128);
    
    let sum = 0;
    let energy1 = 0;
    let energy2 = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      sum += frame1[i] * frame2[i];
      energy1 += frame1[i] * frame1[i];
      energy2 += frame2[i] * frame2[i];
    }
    
    // Avoid division by zero
    if (energy1 === 0 || energy2 === 0) return 0;
    
    // Normalized correlation coefficient
    return Math.abs(sum / Math.sqrt(energy1 * energy2));
  }
}

registerProcessor('vad-processor', VADProcessor); 