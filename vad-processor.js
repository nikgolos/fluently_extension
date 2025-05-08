class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Initialize variables for adaptive threshold
    this.energySamples = [];
    this.lastEnergyLevel = 0;
    this.vadEnergyThreshold = 0.01;
    this.ENERGY_SAMPLE_COUNT = 10;
  }

  process(inputs, outputs) {
    // Get the input data
    const input = inputs[0][0];
    
    if (input && input.length > 0) {
      // Check for voice activity and post the result back to the main thread
      const hasVoice = this.detectVoiceActivity(input);
      this.port.postMessage({ hasVoice });
    }
    
    // Return true to keep the processor running
    return true;
  }
  
  // Voice activity detection with adaptive threshold
  detectVoiceActivity(audioData) {
    if (!audioData || audioData.length === 0) return false;
    
    // Simple energy-based voice detection
    let energy = 0;
    
    // Calculate energy from audio samples
    for (let i = 0; i < audioData.length; i++) {
      energy += Math.abs(audioData[i]);
    }
    
    energy = energy / audioData.length;
    this.lastEnergyLevel = energy;
    
    // Collect energy samples for adaptive threshold
    this.energySamples.push(energy);
    if (this.energySamples.length > this.ENERGY_SAMPLE_COUNT) {
      this.energySamples.shift();
      
      // Adapt threshold based on recent energy levels
      const avgEnergy = this.energySamples.reduce((sum, val) => sum + val, 0) / this.energySamples.length;
      this.vadEnergyThreshold = avgEnergy * 1.2; // Set threshold slightly above average
    }
    
    // Return true if energy is above threshold (voice detected)
    return energy > this.vadEnergyThreshold;
  }
}

registerProcessor('vad-processor', VADProcessor); 