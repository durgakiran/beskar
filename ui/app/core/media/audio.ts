export class AudioService {
    private audioQueue: HTMLAudioElement[] = [];
    private isPlaying = false;
    private lastPlayTime = 0;
    private minDelayBetweenMessages = 3000; // 3 seconds minimum delay between messages
    
    async playMessage(category: string, messageIndex: number = 0, delay: number = 0) {
      const now = Date.now();
      const timeSinceLastPlay = now - this.lastPlayTime;
      
      // If we're within the minimum delay period, add extra delay
      const actualDelay = Math.max(delay, this.minDelayBetweenMessages - timeSinceLastPlay);
      
      if (actualDelay > 0) {
        console.log(`Delaying audio playback by ${actualDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, actualDelay));
      }
      
      const audioPath = `/audio/voice-assistant/${category}-${messageIndex + 1}.mp3`;
      console.log(`Attempting to play audio: ${audioPath}`);
      
      const audio = new Audio(audioPath);
      
      // Add error handling for audio loading
      audio.onerror = (e) => {
        console.error(`Failed to load audio file: ${audioPath}`, e);
        // Remove from queue if it fails to load
        const index = this.audioQueue.indexOf(audio);
        if (index > -1) {
          this.audioQueue.splice(index, 1);
        }
        // Continue with next audio if this one failed
        if (!this.isPlaying) {
          this.playNext();
        }
      };
      
      // Add success logging
      audio.oncanplaythrough = () => {
        console.log(`Audio loaded successfully: ${audioPath}`);
      };
      
      // Add to queue
      this.audioQueue.push(audio);
      
      if (!this.isPlaying) {
        this.playNext();
      }
    }
    
    private playNext() {
      if (this.audioQueue.length === 0) {
        this.isPlaying = false;
        return;
      }
      
      this.isPlaying = true;
      const audio = this.audioQueue.shift()!;
      
      audio.onended = () => {
        console.log('Audio playback completed');
        this.lastPlayTime = Date.now();
        this.playNext();
      };
      
      audio.play().catch((error) => {
        console.error('Failed to play audio:', error);
        // Continue with next audio if this one failed to play
        this.playNext();
      });
    }
    
    stop() {
      this.audioQueue.forEach(audio => audio.pause());
      this.audioQueue = [];
      this.isPlaying = false;
    }
    
    // Method to set minimum delay between messages
    setMinDelay(delayMs: number) {
      this.minDelayBetweenMessages = delayMs;
    }
}
