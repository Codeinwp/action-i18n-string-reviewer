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
      // Limit base strings to prevent token limit issues
      const limitedBaseStrings = baseStrings.slice(0, 100);
      
      const prompt = `You are helping to avoid duplicate translation strings. Given a new string and a list of existing strings, find the single best semantic match from the existing strings that could be used instead.

New string: "${newString}"

Existing strings:
${limitedBaseStrings.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

Instructions:
- If you find a semantically similar existing string that could reasonably replace the new string, respond with ONLY that exact string (nothing else).
- If no existing string is similar enough to be a good replacement, respond with exactly: NO_MATCH
- Consider: similar meaning, same context, same tone, similar purpose
- Be strict - only suggest matches that are truly interchangeable

Your response:`;

      const data = JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 200
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
              resolve({ error: `API Error ${res.statusCode}` });
              return;
            }

            const response = JSON.parse(body);
            const content = response.choices?.[0]?.message?.content?.trim();
            
            if (!content) {
              resolve({ error: 'Empty response' });
              return;
            }

            if (content === 'NO_MATCH') {
              resolve({ match: null });
            } else {
              // Clean up the response - remove quotes if present
              const cleanMatch = content.replace(/^["']|["']$/g, '');
              resolve({ match: cleanMatch });
            }
          } catch (error) {
            resolve({ error: 'Parse error' });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ error: 'Network error' });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Timeout' });
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
    if (!apiKey || !newString || !baseEntries || baseEntries.length === 0) {
      return { match: null };
    }

    try {
      // Extract just the msgid strings from base entries
      const baseStrings = baseEntries
        .map(entry => entry.msgid)
        .filter(msgid => msgid && msgid.trim().length > 0);

      if (baseStrings.length === 0) {
        return { match: null };
      }

      const result = await this.callOpenRouter(apiKey, model, newString, baseStrings);
      return result;
    } catch (error) {
      return { error: error.message || 'Unknown error' };
    }
  }
}

module.exports = { LLMMatcher };

