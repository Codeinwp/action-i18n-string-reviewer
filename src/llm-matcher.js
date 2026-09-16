const https = require('https');
const { LLMCache } = require('./llm-cache');

class LLMMatcher {
  static cache = null;

  /**
   * Initialize cache
   */
  static async initCache(cacheFilePath = '.llm-cache.json', octokit = null, prContext = null) {
    if (!this.cache) {
      this.cache = new LLMCache(cacheFilePath, octokit, prContext);
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
   * Reasoning models (OpenAI GPT-5.x, o-series) reject sampling parameters
   * such as `temperature` with HTTP 400, and spend part of `max_tokens` on
   * reasoning before the answer. OpenRouter's model list confirms none of the
   * GPT-5.x ids advertise `temperature` (checked 2026-09-16).
   * @param {string} model - Model identifier
   * @returns {boolean}
   */
  static isReasoningModel(model) {
    return /^openai\/(gpt-5|o[1-9])/i.test(model || '');
  }

  /**
   * Strip a Markdown code fence from a model reply. Gemini honours the JSON
   * schema but wraps the object in ```json ... ``` (observed on
   * gemini-2.5-flash and gemini-3.5-flash-lite, 2026-09-16), which made every
   * match fail JSON.parse and surface as "LLM Error: Invalid JSON response".
   * @param {string} content - Raw message content
   * @returns {string}
   */
  static unwrapCodeFence(content) {
    const match = /^\s*```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```\s*$/.exec(content || '');
    return match ? match[1].trim() : (content || '').trim();
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
      
      const prompt = `TASK: Find the best existing string that could replace this new string.

NEW STRING TO MATCH:
"${newString}"

EXISTING STRINGS DATABASE:
${existingList}

MATCHING RULES (Priority Order):

HIGH PRIORITY MATCHES:
1. **Exact match** (case-insensitive) - Perfect duplicates
   Example: "Settings" = "settings" = "SETTINGS"

2. **Placeholder variations** - Same text with/without placeholders
   Example: "Activating %s" ≈ "Activating" ≈ "Activating %1$s plugin"
   Rationale: Placeholder differences don't affect base meaning

3. **Singular/plural forms** - Grammatical number variations
   Example: "Comment" ≈ "Comments", "Setting" ≈ "Settings"
   Rationale: Often interchangeable in UI contexts

MEDIUM PRIORITY MATCHES:
4. **Conciseness variations** - Verbose vs concise same action
   Example: "Go to Settings" ≈ "Settings", "Click to Edit" ≈ "Edit"
   Rationale: Button/link text often gets shortened in refactors

5. **Synonym substitution** - Common UI action synonyms
   Examples:
   - "Show" ≈ "Display" ≈ "View"
   - "Edit" ≈ "Modify" ≈ "Change"
   - "Remove" ≈ "Delete" ≈ "Erase"
   - "Create" ≈ "Add" ≈ "New"
   Rationale: Same user action, different wording

6. **Word order changes** - Same terms, different arrangement
   Example: "Edit Settings" ≈ "Settings Editor" ≈ "Settings to Edit"
   Rationale: Refactoring often changes phrasing but not meaning

LOW PRIORITY MATCHES:
7. **Subset/superset** - One string contains the other meaningfully
   Example: "Background Color" could match "Header Background Color"
   Rationale: More specific string might be usable if context matches

8. **Semantic equivalence** - Different words, same concept
   Example: "No items found" ≈ "Nothing to display" ≈ "Empty list"
   Rationale: Conveys identical information to user

NEVER MATCH:
❌ Different topics entirely ("Close" button vs "Close the gap")
❌ Different UI contexts ("Edit post" vs "Edit comment")
❌ Opposite meanings ("Enable" vs "Disable")
❌ Different data types ("User name" vs "Username field")
❌ Technical vs user-facing ("Debug mode" vs "Developer tools")

RESPONSE FORMAT:
Return ONLY valid JSON with the EXACT text from the existing list:
{"match": "exact text from list"}

If no suitable match exists:
{"match": null}

Remember: Use EXACT text from the existing strings list (line 1-${limitedBaseStrings.length}).`;

      // Debug logging
      if (process.env.DEBUG_LLM === 'true') {
        console.log('\n🔍 LLM DEBUG - Request for:', newString.substring(0, 50));
        console.log('Model:', model);
        console.log('Base strings in batch:', limitedBaseStrings.length);
        console.log('Prompt length (chars):', prompt.length);
        console.log('Estimated tokens:', Math.ceil(prompt.length / 4));
        console.log('Prompt:\n---\n' + prompt + '\n---\n');
      }

      // System prompt defines the role and guidelines
      const systemPrompt = `You are an expert translation string matcher specialized in i18n (internationalization) workflows. Your role is to analyze new translatable strings and find the best existing string that could be reused, helping reduce translation costs and maintain consistency.

CORE PRINCIPLES:
- Prioritize semantic equivalence over exact wording
- Consider UI/UX context and user-facing intent
- Recognize that reusing existing strings preserves translations
- Be conservative: only match when confident the strings serve the same purpose

MATCHING PHILOSOPHY:
Translation strings often evolve through refactoring, but their meaning remains constant. A string like "Edit Settings" might be shortened to "Settings" in a button context, or "Activating %s plugin" might become "Activating %s". These should match because they represent the same translatable concept.

OUTPUT REQUIREMENTS:
- Return ONLY valid JSON
- Use the exact text from the provided existing strings list
- If no suitable match exists, return null`;

      const reasoning = LLMMatcher.isReasoningModel(model);
      const data = JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        // Reasoning models refuse `temperature`; everything else is pinned to 0
        // so the same string matches the same way on every run.
        ...(reasoning ? {} : { temperature: 0 }),
        // The answer is one short JSON object. Reasoning models count their
        // hidden reasoning against this budget, so they get room for it.
        max_tokens: reasoning ? 1000 : 100,
        // Only route to an endpoint that honours response_format (and the
        // other parameters sent), instead of one that ignores the schema.
        provider: {
          require_parameters: true
        },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'string_match',
            // Ask providers with a native strict mode to enforce the schema
            // exactly (OpenRouter structured-outputs docs).
            strict: true,
            schema: {
              type: 'object',
              properties: {
                match: {
                  type: ['string', 'null'],
                  description: 'The exact matching string from the existing strings list, or null if no match found'
                }
              },
              required: ['match'],
              additionalProperties: false
            }
          }
        }
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
          // Byte length, not string length: `data.length` counts UTF-16 units,
          // so any non-ASCII character (an em dash, a middle dot, an accented
          // letter in the new string or the base list) under-declared the body
          // and the server read a truncated JSON document.
          'Content-Length': Buffer.byteLength(data, 'utf8')
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

            // Parse JSON response. Strict structured output should make the
            // reply bare JSON, but a provider that treats the schema as
            // guidance may still fence it — unwrap before parsing.
            try {
              const jsonResponse = JSON.parse(LLMMatcher.unwrapCodeFence(content));
              
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
                
                if (process.env.DEBUG_LLM === 'true') {
                  console.log(`✅ Match found: "${cleanMatch}"`);
                }
                
                if (!matchExists && process.env.DEBUG_LLM === 'true') {
                  console.log(`⚠️  Warning: LLM returned string not in list: "${cleanMatch}"`);
                }
                
                resolve({ match: cleanMatch });
              }
            } catch (parseError) {
              // Fallback if JSON parsing fails
              if (process.env.DEBUG_LLM === 'true') {
                console.log('⚠️  Failed to parse JSON response:', content);
                console.log('⚠️  Parse error:', parseError.message);
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

