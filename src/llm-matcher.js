const https = require('https');

class LLMMatcher {
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
      
      const prompt = `Find matching translation string with same meaning.
NEW: "${newString}"

EXISTING:
${existingList}

Match ONLY if nearly identical meaning. Examples of valid matches:
- "Button Settings" matches "Button Setting"
- "Show Header" matches "Display Header"
- "Primary Color" matches "Primary Colour"

Different topic or unrelated = NO_MATCH.

Reply: Number and text (e.g., "42. Button Setting") OR NO_MATCH`;

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
        max_tokens: 50
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

            if (content === 'NO_MATCH' || content.includes('NO_MATCH')) {
              resolve({ match: null });
            } else {
              // Clean up the response - remove quotes, numbers, and extra text
              let cleanMatch = content.replace(/^["']|["']$/g, '').trim();
              
              // If response includes a number prefix (e.g., "5. Login Customizer"), extract just the string
              const numberMatch = cleanMatch.match(/^\d+\.\s*(.+)/);
              if (numberMatch) {
                cleanMatch = numberMatch[1].trim();
              }
              
              // Remove any trailing explanations or comments (text after period, comma, etc.)
              // But be careful not to break strings that legitimately contain punctuation
              const firstSentenceEnd = cleanMatch.search(/\.\s+[A-Z]/); // Period followed by space and capital
              if (firstSentenceEnd > 0) {
                cleanMatch = cleanMatch.substring(0, firstSentenceEnd).trim();
              }
              
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
        
        // If we found a match, return it immediately
        if (result.match) {
          if (process.env.DEBUG_LLM === 'true') {
            console.log(`✅ Found match in batch ${i + 1}`);
          }
          return result;
        }
        
        // If there was an error, return it
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
      return { match: null };
    } catch (error) {
      // Re-throw to stop execution
      throw error;
    }
  }
}

module.exports = { LLMMatcher };

