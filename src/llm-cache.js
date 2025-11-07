const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cache = require('@actions/cache');

class LLMCache {
  constructor(cacheFilePath = '.llm-cache.json') {
    this.cacheFilePath = cacheFilePath;
    this.cache = {};
    this.modified = false;
  }

  /**
   * Generate a cache key from the new string and model
   */
  static generateKey(newString, model) {
    const hash = crypto.createHash('md5').update(`${newString}:${model}`).digest('hex');
    return hash;
  }

  /**
   * Generate GitHub Actions cache key based on model
   */
  static getActionsCacheKey(model) {
    return `llm-cache-${model}-v1`;
  }

  /**
   * Load cache from file (and optionally from GitHub Actions cache)
   */
  async load() {
    // Try to restore from GitHub Actions cache first
    if (process.env.GITHUB_ACTIONS === 'true') {
      try {
        const cacheKey = LLMCache.getActionsCacheKey('default');
        const restoreKeys = [
          'llm-cache-',  // Match any model cache
        ];
        
        const restoredKey = await cache.restoreCache([this.cacheFilePath], cacheKey, restoreKeys);
        if (restoredKey) {
          console.log(`📦 Restored cache from GitHub Actions: ${restoredKey}`);
        }
      } catch (error) {
        // Cache restore failed, continue with local file
        console.log('ℹ️  No GitHub Actions cache found, starting fresh');
      }
    }

    // Load from local file
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf8');
        this.cache = JSON.parse(data);
        console.log(`📦 Loaded ${Object.keys(this.cache).length} cached LLM results`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to load LLM cache from file:', error.message);
      this.cache = {};
    }
  }

  /**
   * Save cache to file (and optionally to GitHub Actions cache)
   */
  async save() {
    if (!this.modified) {
      return; // No changes, skip save
    }

    // Save to local file first
    try {
      const data = JSON.stringify(this.cache, null, 2);
      fs.writeFileSync(this.cacheFilePath, data, 'utf8');
      console.log(`💾 Saved ${Object.keys(this.cache).length} LLM results to cache`);
    } catch (error) {
      console.warn('⚠️  Failed to save LLM cache to file:', error.message);
      return;
    }

    // Save to GitHub Actions cache if available
    if (process.env.GITHUB_ACTIONS === 'true') {
      try {
        const cacheKey = LLMCache.getActionsCacheKey('default');
        await cache.saveCache([this.cacheFilePath], cacheKey);
        console.log(`💾 Saved cache to GitHub Actions: ${cacheKey}`);
      } catch (error) {
        // Cache save failed, but local file is saved
        console.log('ℹ️  Could not save to GitHub Actions cache (may already exist)');
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

