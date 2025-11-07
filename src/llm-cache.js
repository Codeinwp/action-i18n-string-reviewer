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
   * Get cache comment identifier
   */
  static getCacheCommentIdentifier() {
    return '<!-- i18n-string-reviewer-llm-cache -->';
  }

  /**
   * Extract cache data from PR comment
   */
  static extractCacheFromComment(commentBody) {
    if (!commentBody) return null;
    
    try {
      // Look for cache data between HTML comment markers
      const startMarker = '<!-- CACHE_DATA_START';
      const endMarker = 'CACHE_DATA_END -->';
      const startIdx = commentBody.indexOf(startMarker);
      const endIdx = commentBody.indexOf(endMarker);
      
      if (startIdx === -1 || endIdx === -1) return null;
      
      // Extract the base64 data
      const dataLine = commentBody.substring(startIdx, endIdx);
      const base64Match = dataLine.match(/<!-- CACHE_DATA_START\s+(.+?)\s+$/);
      if (!base64Match) return null;
      
      // Decode and parse
      const jsonStr = Buffer.from(base64Match[1], 'base64').toString('utf8');
      return JSON.parse(jsonStr);
    } catch (error) {
      console.warn('⚠️  Failed to extract cache from comment:', error.message);
      return null;
    }
  }

  /**
   * Create cache comment body
   */
  static createCacheComment(cacheData) {
    const identifier = LLMCache.getCacheCommentIdentifier();
    const base64Data = Buffer.from(JSON.stringify(cacheData)).toString('base64');
    const timestamp = new Date().toISOString();
    
    return `${identifier}
<!-- 
LLM Cache Data (automatically updated by i18n String Reviewer)
Last updated: ${timestamp}
Cache entries: ${Object.keys(cacheData).length}
-->
<!-- CACHE_DATA_START ${base64Data} CACHE_DATA_END -->`;
  }

  /**
   * Load cache from PR comment or local file
   */
  async load() {
    // Try to load from PR comment first (if in PR context)
    if (this.octokit && this.prContext) {
      try {
        const { owner, repo, pullRequestNumber } = this.prContext;
        
        // Find existing cache comment
        const { data: comments } = await this.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: pullRequestNumber,
        });

        const cacheComment = comments.find(comment => 
          comment.body?.includes(LLMCache.getCacheCommentIdentifier())
        );

        if (cacheComment) {
          const cacheData = LLMCache.extractCacheFromComment(cacheComment.body);
          if (cacheData) {
            this.cache = cacheData;
            this.cacheCommentId = cacheComment.id;
            console.log(`📦 Loaded ${Object.keys(this.cache).length} cached LLM results from PR comment`);
            return;
          }
        }
        
        console.log('ℹ️  No cache found in PR comments, starting fresh');
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
   * Save cache to PR comment and local file
   */
  async save() {
    if (!this.modified) {
      return; // No changes, skip save
    }

    // Save to local file for debugging
    try {
      const data = JSON.stringify(this.cache, null, 2);
      fs.writeFileSync(this.cacheFilePath, data, 'utf8');
      console.log(`💾 Saved ${Object.keys(this.cache).length} LLM results to local file`);
    } catch (error) {
      console.warn('⚠️  Failed to save LLM cache to file:', error.message);
    }

    // Save to PR comment (if in PR context)
    if (this.octokit && this.prContext) {
      try {
        const { owner, repo, pullRequestNumber } = this.prContext;
        const commentBody = LLMCache.createCacheComment(this.cache);

        if (this.cacheCommentId) {
          // Update existing cache comment
          await this.octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: this.cacheCommentId,
            body: commentBody
          });
          console.log(`💾 Updated cache in PR comment (${Object.keys(this.cache).length} entries)`);
        } else {
          // Create new cache comment
          const { data: comment } = await this.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullRequestNumber,
            body: commentBody
          });
          this.cacheCommentId = comment.id;
          console.log(`💾 Created cache comment in PR (${Object.keys(this.cache).length} entries)`);
        }
      } catch (error) {
        console.warn('⚠️  Failed to save cache to PR comment:', error.message);
      }
    }
  }

  /**
   * Get cached result
   */
  get(newString, model) {
    const key = LLMCache.generateKey(newString, model);
    return this.cache[key] || null;
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

