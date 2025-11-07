const https = require('https');
const { LLMCache } = require('./llm-cache');

class LLMMatcher {
  static cache = null;

  /**
   * Initialize cache
   */
  static async initCache(cacheFilePath = '.llm-cache.json') {
    if (!this.cache) {
      this.cache = new LLMCache(cacheFilePath);
      await this.cache.load();
    }
    return this.cache;
  }

  /**
   * Save cache
   */
  static async saveCache() {
    if (this.cache) {
      await this.cache.save();
    }
  }
  /**
   * Call OpenRouter API to find best matching string
   * @param {string} apiKey - OpenRouter API key
   * @param {string} model - Model identifier
   * @param {string} newString - The new string to find a match for
   * @param {Array<string>} baseStrings - Array of existing strings from base POT
   * @returns {Promise<Object>} - Response with match or error
   */
  static async callOpenRouter(apiKey, model, newString, baseStrings) {
    return new Promise((resolve, reject) => {
      // baseStrings is already batched, use all provided strings
      const limitedBaseStrings = baseStrings;
      
      // Create a compact list to save tokens
      const existingList = limitedBaseStrings.map((s, i) => `${i + 1}. ${s}`).join('\n');
      
      const prompt = `You are a translation string matcher. Find the best existing string to reuse for a new translation.

NEW STRING:
"${newString}"

EXISTING STRINGS:
${existingList}

MATCHING RULES (in priority order):
1. Exact match (case-insensitive)
2. Same meaning with placeholder differences: "Activating %s" ≈ "Activating" 
3. Singular/plural variants: "Settings" ≈ "Setting"
4. Verbose vs concise (same action): "Go to Settings" ≈ "Settings"
5. Synonyms for UI actions: "Show" ≈ "Display", "Edit" ≈ "Modify"
6. Same core words in different order: "Edit Settings" ≈ "Settings Editor"
7. Key terms match: "Header Background Color" could use "Background Color"

DO NOT MATCH:
- Completely different topics or actions
- Different UI contexts (e.g., "Close" button vs "Close the gap")

RESPONSE:
Return ONLY valid JSON with the EXACT text from the existing list:
{"match": "exact text from list"}

If no suitable match exists:
{"match": null}`;

      // Debug logging
      if (process.env.DEBUG_LLM === 'true') {
        console.log('\n🔍 LLM DEBUG - Request for:', newString.substring(0, 50));
        console.log('Model:', model);
        console.log('Base strings in batch:', limitedBaseStrings.length);
        console.log('Prompt length (chars):', prompt.length);
        console.log('Estimated tokens:', Math.ceil(prompt.length / 4));
        console.log('Prompt:\n---\n' + prompt + '\n---\n');
      }

      const data = JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      });

      const options = {
        hostname: 'openrouter.ai',
        port: 443,
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/Codeinwp/action-i18n-string-reviewer',
          'X-Title': 'i18n String Reviewer',
          'Content-Length': data.length
        }
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

                res.on('end', () => {
                  try {
                    if (res.statusCode !== 200) {
                      // Parse error message from body
                      let errorMsg = `HTTP ${res.statusCode}`;
                      try {
                        const errorData = JSON.parse(body);
                        if (errorData.error?.message) {
                          errorMsg = errorData.error.message;
                        } else if (errorData.message) {
                          errorMsg = errorData.message;
                        }
                      } catch (e) {
                        // Body wasn't JSON, use generic message
                      }
                      
                      // Stop execution with error
                      reject(new Error(`API Error ${res.statusCode}: ${errorMsg}`));
                      return;
                    }

            const response = JSON.parse(body);
            const content = response.choices?.[0]?.message?.content?.trim();
            
            // Debug logging
            if (process.env.DEBUG_LLM === 'true') {
              console.log('✅ LLM Response:', content);
            }
            
            if (!content) {
              resolve({ error: 'Empty response' });
              return;
            }

            // Parse JSON response
            try {
              const jsonResponse = JSON.parse(content);
              
              if (jsonResponse.match === null || !jsonResponse.match) {
                resolve({ match: null });
              } else {
                const cleanMatch = jsonResponse.match.trim();
                
                // Validate: the match should exist in the base strings
                const matchExists = limitedBaseStrings.some(s => 
                  s.trim().toLowerCase() === cleanMatch.toLowerCase() || 
                  s.includes(cleanMatch) ||
                  cleanMatch.includes(s)
                );
                
                if (!matchExists && process.env.DEBUG_LLM === 'true') {
                  console.log(`⚠️  Warning: LLM returned string not in list: "${cleanMatch}"`);
                }
                
                resolve({ match: cleanMatch });
              }
            } catch (parseError) {
              // Fallback if JSON parsing fails
              if (process.env.DEBUG_LLM === 'true') {
                console.log('⚠️  Failed to parse JSON response:', content);
              }
              resolve({ error: 'Invalid JSON response' });
            }
          } catch (error) {
            resolve({ error: 'Parse error' });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(30000); // 30 second timeout
      req.write(data);
      req.end();
    });
  }

  /**
   * Find best matching string from base POT for a new string
   * @param {string} newString - The new string to find a match for
   * @param {Array<Object>} baseEntries - Array of POTEntry objects from base POT
   * @param {string} apiKey - OpenRouter API key
   * @param {string} model - Model identifier
   * @returns {Promise<Object>} - { match: 'string' } or { match: null } or { error: 'message' }
   */
  static async findBestMatch(newString, baseEntries, apiKey, model) {
    if (!apiKey || !apiKey.trim()) {
      return { match: null };
    }
    
    // Initialize cache if not already done
    if (!this.cache) {
      await this.initCache();
    }
    
    // Check cache first
    const cached = this.cache.get(newString, model);
    if (cached) {
      if (process.env.DEBUG_LLM === 'true') {
        console.log(`📦 Cache hit for: "${newString.substring(0, 50)}"`);
      }
      return cached.result;
    }
    
    // Validate API key format
    if (!apiKey.startsWith('sk-or-')) {
      console.warn('OpenRouter API key should start with "sk-or-"');
      return { error: 'Invalid key format' };
    }
    
    if (!newString || !newString.trim()) {
      return { match: null };
    }
    
    if (!baseEntries || baseEntries.length === 0) {
      return { match: null };
    }

    try {
      // Extract just the msgid strings from base entries
      const baseStrings = baseEntries
        .map(entry => entry.msgid)
        .filter(msgid => msgid && msgid.trim().length > 0 && msgid.length < 200); // Skip very long strings

      if (baseStrings.length === 0) {
        return { match: null };
      }

      // Process in batches - large batches for better context
      const batchSize = 1000; // Large batches to maximize context
      const maxBatches = 10; // Limit to 10 batches (10000 strings max) to control API costs
      
      for (let i = 0; i < Math.min(maxBatches, Math.ceil(baseStrings.length / batchSize)); i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, baseStrings.length);
        const batch = baseStrings.slice(start, end);
        
        if (process.env.DEBUG_LLM === 'true') {
          console.log(`🔍 Checking batch ${i + 1} (strings ${start + 1}-${end} of ${baseStrings.length})`);
        }
        
        const result = await this.callOpenRouter(apiKey, model, newString, batch);
        
        // If we found a match, cache it and return
        if (result.match) {
          if (process.env.DEBUG_LLM === 'true') {
            console.log(`✅ Found match in batch ${i + 1}`);
          }
          this.cache.set(newString, model, result);
          return result;
        }
        
        // If there was an error, return it (don't cache errors)
        if (result.error) {
          return result;
        }
        
        // Add delay between batches to avoid Cloudflare rate limiting
        if (i < Math.min(maxBatches, Math.ceil(baseStrings.length / batchSize)) - 1) {
          const delayMs = 500; // 500ms delay to avoid rate limits
          if (process.env.DEBUG_LLM === 'true') {
            console.log(`⏳ Waiting ${delayMs}ms before next batch...`);
          }
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        // Otherwise continue to next batch
      }
      
      // No match found in any batch
      const result = { match: null };
      this.cache.set(newString, model, result);
      return result;
    } catch (error) {
      // Re-throw to stop execution
      throw error;
    }
  }
}

module.exports = { LLMMatcher };

