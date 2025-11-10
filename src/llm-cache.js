const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LLMCache {
  constructor(cacheFilePath = '.llm-cache.json', octokit = null, prContext = null) {
    this.cacheFilePath = cacheFilePath;
    this.cache = {};
    this.modified = false;
    this.octokit = octokit;
    this.prContext = prContext;
  }

  /**
   * Generate a cache key from the new string and model
   */
  static generateKey(newString, model) {
    const hash = crypto.createHash('md5').update(`${newString}:${model}`).digest('hex');
    return hash;
  }

  /**
   * Get report comment identifier
   */
  static getReportCommentIdentifier() {
    return '### 🌍 i18n String Review Report';
  }

  /**
   * Extract cache data from report comment by parsing markdown tables
   */
  static extractCacheFromComment(commentBody) {
    if (!commentBody) return null;
    
    const cache = {};
    let extractedCount = 0;
    
    try {
      // Look for the report identifier
      if (!commentBody.includes(this.getReportCommentIdentifier())) {
        return null;
      }

      // Parse markdown tables to extract String -> Suggested Match mappings
      // We need to find tables and parse them line by line to avoid regex confusion
      
      // Split into lines and process sequentially
      const lines = commentBody.split('\n');
      let inAddedTable = false;
      let inChangedTable = false;
      let tableColumnCount = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Detect table type
        if (line.includes('Added Strings')) {
          inAddedTable = true;
          inChangedTable = false;
          continue;
        } else if (line.includes('Changed Strings')) {
          inChangedTable = true;
          inAddedTable = false;
          continue;
        } else if (line.includes('Removed Strings')) {
          inAddedTable = false;
          inChangedTable = false;
          continue;
        } else if (line === '</details>') {
          inAddedTable = false;
          inChangedTable = false;
          continue;
        }
        
        // Skip non-table lines
        if (!line.startsWith('|') || !line.endsWith('|')) {
          continue;
        }
        
        // Parse table row
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        
        // Skip headers, separators, and footer rows
        if (cells.length === 0 || 
            cells[0].includes('---') || 
            cells[0].includes('String') ||
            cells[0].includes('**Total**') ||
            cells[0] === '...') {
          continue;
        }
        
        // Parse added strings table (4 columns: String | Location | Words | Suggested Match)
        if (inAddedTable && cells.length >= 4) {
          const newString = this._unescapeMarkdown(cells[0]);
          const suggestedMatch = this._unescapeMarkdown(cells[3]);
          
          if (this._isValidMatch(newString, suggestedMatch)) {
            cache[newString] = {
              newString: newString,
              match: suggestedMatch
            };
            extractedCount++;
          }
        }
        
        // Parse changed strings table (5 columns: String | Existing | Changed | Words | Suggested Match)
        else if (inChangedTable && cells.length >= 5) {
          const newString = this._unescapeMarkdown(cells[0]);
          const suggestedMatch = this._unescapeMarkdown(cells[4]);
          
          if (this._isValidMatch(newString, suggestedMatch)) {
            cache[newString] = {
              newString: newString,
              match: suggestedMatch
            };
            extractedCount++;
          }
        }
      }
      
      if (extractedCount > 0) {
        console.log(`📦 Extracted ${extractedCount} cached suggestions from existing report`);
        return cache;
      }
      
      return null;
    } catch (error) {
      console.warn('⚠️  Failed to extract cache from report comment:', error.message);
      return null;
    }
  }

  /**
   * Check if a match is valid and should be cached
   */
  static _isValidMatch(newString, suggestedMatch) {
    if (!suggestedMatch || !newString) return false;
    if (suggestedMatch === '-' || suggestedMatch === '...') return false;
    if (suggestedMatch.startsWith('*')) return false; // Skip *No close match*
    if (suggestedMatch.startsWith('LLM Error')) return false;
    if (suggestedMatch.includes('and ') && suggestedMatch.includes('more')) return false; // Skip "and X more"
    if (newString.length === 0) return false;
    
    return true;
  }

  /**
   * Unescape markdown formatting to get original string
   */
  static _unescapeMarkdown(text) {
    if (!text) return '';
    
    // Remove markdown escaping
    let unescaped = text;
    const charsToUnescape = ['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!'];
    for (const char of charsToUnescape) {
      unescaped = unescaped.split(`\\${char}`).join(char);
    }
    
    // Handle truncation marker
    if (unescaped.endsWith('...')) {
      // This string was truncated in the report, we'll match by prefix
      return unescaped;
    }
    
    return unescaped;
  }

  /**
   * Load cache from existing report comment or local file
   */
  async load() {
    // Try to load from PR report comment first (if in PR context)
    if (this.octokit && this.prContext) {
      try {
        const { owner, repo, pullRequestNumber } = this.prContext;
        
        // Find existing report comment
        const { data: comments } = await this.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: pullRequestNumber,
        });

        const reportComment = comments.find(comment => 
          comment.body?.includes(LLMCache.getReportCommentIdentifier())
        );

        if (reportComment) {
          const extractedCache = LLMCache.extractCacheFromComment(reportComment.body);
          if (extractedCache) {
            // Convert extracted cache to internal format
            this.cache = this._convertExtractedCache(extractedCache);
            console.log(`📦 Loaded ${Object.keys(this.cache).length} cached LLM results from existing report`);
            return;
          }
        }
        
        console.log('ℹ️  No existing report found in PR comments, starting fresh');
      } catch (error) {
        console.warn('⚠️  Failed to load cache from PR comment:', error.message);
      }
    }

    // Fallback to local file
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf8');
        this.cache = JSON.parse(data);
        console.log(`📦 Loaded ${Object.keys(this.cache).length} cached LLM results from file`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to load LLM cache from file:', error.message);
      this.cache = {};
    }
  }

  /**
   * Convert extracted cache (simple format) to internal format (with model keys)
   */
  _convertExtractedCache(extractedCache) {
    const cache = {};
    
    // The extracted cache uses simple string keys, but we need model-specific keys
    // Since we don't know the model from the comment, we'll create entries for common models
    // and also add a model-agnostic lookup
    for (const [newString, data] of Object.entries(extractedCache)) {
      // Store with a generic key that can be looked up regardless of model
      // We'll modify the get() method to do fuzzy matching
      cache[newString] = {
        newString: data.newString,
        result: { match: data.match },
        timestamp: new Date().toISOString(),
        fromReport: true // Flag to indicate this came from report parsing
      };
    }
    
    return cache;
  }

  /**
   * Save cache to local file only (cache is now embedded in the report)
   */
  async save() {
    if (!this.modified) {
      return; // No changes, skip save
    }

    // Save to local file for debugging/local runs only
    try {
      const data = JSON.stringify(this.cache, null, 2);
      fs.writeFileSync(this.cacheFilePath, data, 'utf8');
      console.log(`💾 Saved ${Object.keys(this.cache).length} LLM results to local file`);
    } catch (error) {
      console.warn('⚠️  Failed to save LLM cache to file:', error.message);
    }

    // Note: Cache is now stored within the report comment itself
    // The "Suggested Match" column in the markdown tables serves as the cache
    // No separate cache comment is needed
  }

  /**
   * Get cached result
   * Try both model-specific and model-agnostic lookup (for report-extracted cache)
   */
  get(newString, model) {
    // First try the model-specific key (standard cache)
    const key = LLMCache.generateKey(newString, model);
    if (this.cache[key]) {
      return this.cache[key];
    }
    
    // Try direct string lookup (for cache extracted from reports)
    if (this.cache[newString]) {
      return this.cache[newString];
    }
    
    // Try fuzzy matching for truncated strings
    for (const [cachedKey, cachedValue] of Object.entries(this.cache)) {
      if (cachedValue.fromReport && cachedValue.newString) {
        // Check if the cached string is a truncated version
        if (cachedValue.newString.endsWith('...')) {
          const prefix = cachedValue.newString.slice(0, -3);
          if (newString.startsWith(prefix)) {
            return cachedValue;
          }
        }
        // Or if the new string matches the beginning of cached string
        if (newString.length > 40 && cachedValue.newString.startsWith(newString.substring(0, 40))) {
          return cachedValue;
        }
      }
    }
    
    return null;
  }

  /**
   * Set cached result
   */
  set(newString, model, result) {
    const key = LLMCache.generateKey(newString, model);
    this.cache[key] = {
      newString: newString,
      model: model,
      result: result,
      timestamp: new Date().toISOString()
    };
    this.modified = true;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      totalEntries: Object.keys(this.cache).length,
      modified: this.modified
    };
  }
}

module.exports = { LLMCache };

