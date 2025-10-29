/**
 * Utility functions for time formatting in UTC-4 (ET timezone)
 */

/**
 * Convert UTC timestamp to UTC-4 (ET) and format as time string
 * @param isoString - ISO timestamp string (UTC)
 * @param options - Formatting options
 * @returns Formatted time string in UTC-4
 */
export function formatTimeUTC4(
  isoString: string,
  options: {
    includeSeconds?: boolean;
    includeAMPM?: boolean;
    includeET?: boolean;
  } = {}
): string {
  try {
    const date = new Date(isoString);
    
    // Get UTC components
    let hours = date.getUTCHours();
    let minutes = date.getUTCMinutes();
    let seconds = date.getUTCSeconds();
    
    // Convert to UTC-4 by subtracting 4 hours
    hours -= 4;
    // Handle day wrap-around
    if (hours < 0) {
      hours += 24;
    }
    
    const {
      includeSeconds = false,
      includeAMPM = true,
      includeET = false
    } = options;
    
    if (includeAMPM) {
      const hours12 = hours % 12 || 12;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      let result = `${hours12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      if (includeSeconds) {
        result += `:${seconds.toString().padStart(2, '0')}`;
      }
      result += ` ${ampm}`;
      if (includeET) {
        result += ' ET';
      }
      return result;
    } else {
      let result = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      if (includeSeconds) {
        result += `:${seconds.toString().padStart(2, '0')}`;
      }
      if (includeET) {
        result += ' ET';
      }
      return result;
    }
  } catch {
    return isoString;
  }
}

/**
 * Format timestamp relative to now (e.g., "2m ago") or as UTC-4 time if older than 1 hour
 * @param timestamp - ISO timestamp string (UTC)
 * @returns Relative time string or formatted UTC-4 time
 */
export function formatTimestampRelative(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    
    if (diffSecs < 60) {
      return `${diffSecs}s`;
    } else if (diffMins < 60) {
      return `${diffMins}m`;
    } else {
      // For times older than 1 hour, show UTC-4 time
      return formatTimeUTC4(timestamp, { includeAMPM: true, includeET: false });
    }
  } catch {
    return timestamp;
  }
}

