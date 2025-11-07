const { LLMMatcher } = require('./llm-matcher');

class Reporter {
  static escapeMarkdown(text) {
    if (!text) return '';
    const charsToEscape = ['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!'];
    let escaped = text;
    for (const char of charsToEscape) {
      escaped = escaped.split(char).join(`\\${char}`);
    }
    return escaped;
  }

  static generateJSONReport(results) {
    const report = {
      added_count: results.addedCount,
      removed_count: results.removedCount,
      changed_count: results.changedCount,
      total_changes: results.totalChanges,
      added: [],
      removed: [],
      changed: []
    };

    // Add added strings
    for (const entry of results.added) {
      const references = this._parseReferences(entry.comments.reference);
      report.added.push({
        msgid: entry.msgid,
        msgid_plural: entry.msgidPlural,
        msgctxt: entry.msgctxt,
        occurrences: references.slice(0, 3)
      });
    }

    // Add removed strings
    for (const entry of results.removed) {
      const references = this._parseReferences(entry.comments.reference);
      report.removed.push({
        msgid: entry.msgid,
        msgid_plural: entry.msgidPlural,
        msgctxt: entry.msgctxt,
        occurrences: references.slice(0, 3)
      });
    }

    // Add changed strings
    for (const { base, target } of results.changed) {
      const changeInfo = {
        msgid: base.msgid,
        msgctxt: base.msgctxt,
        changes: []
      };

      if (base.msgidPlural !== target.msgidPlural) {
        changeInfo.changes.push({
          field: 'msgid_plural',
          old: base.msgidPlural,
          new: target.msgidPlural
        });
      }

      if (base.comments.translator !== target.comments.translator) {
        changeInfo.changes.push({
          field: 'translator_comment',
          old: base.comments.translator,
          new: target.comments.translator
        });
      }

      if (base.comments.extracted !== target.comments.extracted) {
        changeInfo.changes.push({
          field: 'extracted_comment',
          old: base.comments.extracted,
          new: target.comments.extracted
        });
      }

      report.changed.push(changeInfo);
    }

    return report;
  }

  static async generateMarkdownReport(results, baseEntries, openrouterKey, openrouterModel) {
    const lines = [];
    lines.push('## 🌍 i18n String Review Report\n');

    if (results.totalChanges === 0) {
      lines.push('### ✅ No changes detected\n');
      lines.push('The POT files are identical.');
      return lines.join('\n');
    }

    // Convert baseEntries Map to Array for LLM matcher
    // Include both existing base entries AND removed strings (which are already translated)
    const baseEntriesArray = baseEntries ? Array.from(baseEntries.values()) : [];
    
    // Add removed strings to the pool of available strings for matching
    // These are valuable because they're already translated even though they're no longer in the code
    if (results.removed && results.removed.length > 0) {
      console.log(`ℹ️  Including ${results.removed.length} removed strings as potential matches (already translated)`);
      baseEntriesArray.push(...results.removed);
    }

    // Summary table
    lines.push('### 📊 Summary\n');
    lines.push('| Category | Count |');
    lines.push('|----------|-------|');
    lines.push(`| ➕ Added | ${results.addedCount} |`);
    lines.push(`| ➖ Removed | ${results.removedCount} |`);
    lines.push(`| 🔄 Changed | ${results.changedCount} |`);
    lines.push(`| **Total** | **${results.totalChanges}** |\n`);

    // Added strings table
    if (results.added.length > 0) {
      // First, collect all entries with their LLM suggestions
      const entriesWithData = [];
      let totalWords = 0;
      const limit = Math.min(results.added.length, 100);
      
      for (let i = 0; i < limit; i++) {
        const entry = results.added[i];
        const wordCount = this._countWords(entry.msgid) + this._countWords(entry.msgidPlural);
        totalWords += wordCount;
        
        // Get LLM suggestion if enabled
        let suggestedMatch = '-';
        let hasSuggestion = false;
        if (openrouterKey && baseEntriesArray.length > 0) {
          try {
            const matchResult = await LLMMatcher.findBestMatch(
              entry.msgid,
              baseEntriesArray,
              openrouterKey,
              openrouterModel
            );
            
            if (matchResult.error) {
              suggestedMatch = `LLM Error: ${matchResult.error}`;
            } else if (matchResult.match) {
              suggestedMatch = matchResult.match; // Full string, not truncated
              hasSuggestion = true;
            } else {
              suggestedMatch = '*No close match*'; // Italics to distinguish from actual suggestions
            }
            
            // Small delay between string checks to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            throw error; // Re-throw to stop the action
          }
        }
        
        entriesWithData.push({
          entry,
          wordCount,
          suggestedMatch,
          hasSuggestion
        });
      }
      
      // Sort: entries with suggestions first, then the rest
      entriesWithData.sort((a, b) => {
        if (a.hasSuggestion && !b.hasSuggestion) return -1;
        if (!a.hasSuggestion && b.hasSuggestion) return 1;
        return 0;
      });
      
      // Now render the table
      lines.push('<details>');
      lines.push(`<summary><strong>➕ Added Strings (${results.added.length})</strong> - Click to expand</summary>\n`);
      lines.push('| String | Location | Words | Suggested Match |');
      lines.push('|--------|----------|-------|-----------------|');
      
      for (const data of entriesWithData) {
        const entry = data.entry;
        const msgid = this._truncate(entry.msgid, 50);
        const references = this._parseReferences(entry.comments.reference);
        const location = references.length > 0 ? this._truncate(references[0], 30) : '-';
        
        lines.push(`| ${msgid} | ${location} | ${data.wordCount} | ${data.suggestedMatch} |`);
      }

      // Add remaining words from items beyond limit
      for (let i = limit; i < results.added.length; i++) {
        const entry = results.added[i];
        totalWords += this._countWords(entry.msgid) + this._countWords(entry.msgidPlural);
      }

      if (results.added.length > 100) {
        lines.push(`| ... | ... | *and ${results.added.length - 100} more* | ... |`);
      }

      // Footer with total
      lines.push(`| **Total** | | **${totalWords}** | |`);

      lines.push('\n</details>\n');
    }

    // Removed strings table
    if (results.removed.length > 0) {
      lines.push('<details>');
      lines.push(`<summary><strong>➖ Removed Strings (${results.removed.length})</strong> - Click to expand</summary>\n`);
      lines.push('| String | Location |');
      lines.push('|--------|----------|');

      const limit = Math.min(results.removed.length, 100);
      for (let i = 0; i < limit; i++) {
        const entry = results.removed[i];
        const msgid = this._truncate(entry.msgid, 50);
        const references = this._parseReferences(entry.comments.reference);
        const location = references.length > 0 ? this._truncate(references[0], 30) : '-';
        
        lines.push(`| ${msgid} | ${location} |`);
      }

      if (results.removed.length > 100) {
        lines.push(`| ... | *and ${results.removed.length - 100} more* |`);
      }

      lines.push('\n</details>\n');
    }

    // Changed strings table
    if (results.changed.length > 0) {
      // First, collect all entries with their LLM suggestions
      const entriesWithData = [];
      let totalWords = 0;
      const limit = Math.min(results.changed.length, 100);
      
      for (let i = 0; i < limit; i++) {
        const { base, target } = results.changed[i];
        
        // Count words - use target (new) values
        const wordCount = this._countWords(target.msgid) + this._countWords(target.msgidPlural);
        totalWords += wordCount;
        
        // Determine what changed
        const changes = [];
        if (base.msgidPlural !== target.msgidPlural) {
          changes.push(`Plural: ${this._truncate(base.msgidPlural || '(none)', 30)}`);
        }
        if (base.comments.translator !== target.comments.translator) {
          changes.push(`Comment: ${this._truncate(base.comments.translator || '(none)', 30)}`);
        }
        if (base.comments.extracted !== target.comments.extracted) {
          changes.push(`Extracted: ${this._truncate(base.comments.extracted || '(none)', 30)}`);
        }
        
        const existing = changes.length > 0 ? changes[0] : '-';
        
        const newChanges = [];
        if (base.msgidPlural !== target.msgidPlural) {
          newChanges.push(`Plural: ${this._truncate(target.msgidPlural || '(none)', 30)}`);
        }
        if (base.comments.translator !== target.comments.translator) {
          newChanges.push(`Comment: ${this._truncate(target.comments.translator || '(none)', 30)}`);
        }
        if (base.comments.extracted !== target.comments.extracted) {
          newChanges.push(`Extracted: ${this._truncate(target.comments.extracted || '(none)', 30)}`);
        }
        
        const changed = newChanges.length > 0 ? newChanges[0] : '-';
        
        // Get LLM suggestion if enabled
        let suggestedMatch = '-';
        let hasSuggestion = false;
        if (openrouterKey && baseEntriesArray.length > 0) {
          try {
            const matchResult = await LLMMatcher.findBestMatch(
              target.msgid,
              baseEntriesArray,
              openrouterKey,
              openrouterModel
            );
            
            if (matchResult.error) {
              suggestedMatch = `LLM Error: ${matchResult.error}`;
            } else if (matchResult.match) {
              suggestedMatch = matchResult.match; // Full string, not truncated
              hasSuggestion = true;
            } else {
              suggestedMatch = '*No close match*'; // Italics to distinguish from actual suggestions
            }
            
            // Small delay between string checks to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            throw error; // Re-throw to stop the action
          }
        }
        
        entriesWithData.push({
          base,
          target,
          wordCount,
          existing,
          changed,
          suggestedMatch,
          hasSuggestion
        });
      }
      
      // Sort: entries with suggestions first, then the rest
      entriesWithData.sort((a, b) => {
        if (a.hasSuggestion && !b.hasSuggestion) return -1;
        if (!a.hasSuggestion && b.hasSuggestion) return 1;
        return 0;
      });
      
      // Now render the table
      lines.push('<details>');
      lines.push(`<summary><strong>🔄 Changed Strings (${results.changed.length})</strong> - Click to expand</summary>\n`);
      lines.push('| String | Existing | Changed | Words | Suggested Match |');
      lines.push('|--------|----------|---------|-------|-----------------|');
      
      for (const data of entriesWithData) {
        const msgid = this._truncate(data.base.msgid, 40);
        
        lines.push(`| ${msgid} | ${data.existing} | ${data.changed} | ${data.wordCount} | ${data.suggestedMatch} |`);
      }

      // Add remaining words from items beyond limit
      for (let i = limit; i < results.changed.length; i++) {
        const { target } = results.changed[i];
        totalWords += this._countWords(target.msgid) + this._countWords(target.msgidPlural);
      }

      if (results.changed.length > 100) {
        lines.push(`| ... | ... | ... | *and ${results.changed.length - 100} more* | ... |`);
      }

      // Footer with total
      lines.push(`| **Total** | | | **${totalWords}** | |`);

      lines.push('\n</details>\n');
    }

    return lines.join('\n');
  }

  static _truncate(text, maxLength) {
    if (!text) return '';
    const escaped = this.escapeMarkdown(text);
    if (escaped.length <= maxLength) return escaped;
    return escaped.substring(0, maxLength - 3) + '...';
  }

  static _countWords(text) {
    if (!text) return 0;
    // Remove extra whitespace and split by spaces
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  static _parseReferences(referenceString) {
    if (!referenceString) return [];
    
    // Reference string can be like "src/file.php:23\nsrc/other.php:45"
    const lines = referenceString.split('\n').filter(line => line.trim());
    return lines.map(line => line.trim());
  }
}

module.exports = { Reporter };

