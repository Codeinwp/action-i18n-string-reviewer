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

  static generateMarkdownReport(results) {
    const lines = [];
    lines.push('# 🌍 i18n String Review Report\n');

    if (results.totalChanges === 0) {
      lines.push('## ✅ No changes detected\n');
      lines.push('The POT files are identical.');
      return lines.join('\n');
    }

    // Summary table
    lines.push('## 📊 Summary\n');
    lines.push('| Category | Count |');
    lines.push('|----------|-------|');
    lines.push(`| ➕ Added | ${results.addedCount} |`);
    lines.push(`| ➖ Removed | ${results.removedCount} |`);
    lines.push(`| 🔄 Changed | ${results.changedCount} |`);
    lines.push(`| **Total** | **${results.totalChanges}** |\n`);

    // Added strings
    if (results.added.length > 0) {
      lines.push('## ➕ Added Strings\n');
      lines.push(`**${results.added.length} new string(s) added**\n`);

      const limit = Math.min(results.added.length, 50);
      for (let i = 0; i < limit; i++) {
        const entry = results.added[i];
        lines.push(`### ${i + 1}. ${this.escapeMarkdown(entry.msgid)}\n`);

        if (entry.msgctxt) {
          lines.push(`**Context:** \`${this.escapeMarkdown(entry.msgctxt)}\`\n`);
        }

        if (entry.msgidPlural) {
          lines.push(`**Plural:** ${this.escapeMarkdown(entry.msgidPlural)}\n`);
        }

        const references = this._parseReferences(entry.comments.reference);
        if (references.length > 0) {
          const refsStr = references.slice(0, 3).map(ref => `\`${ref}\``).join(', ');
          lines.push(`**Found in:** ${refsStr}\n`);
        }

        lines.push('');
      }

      if (results.added.length > 50) {
        lines.push(`*... and ${results.added.length - 50} more*\n`);
      }
    }

    // Removed strings
    if (results.removed.length > 0) {
      lines.push('## ➖ Removed Strings\n');
      lines.push(`**${results.removed.length} string(s) removed**\n`);

      const limit = Math.min(results.removed.length, 50);
      for (let i = 0; i < limit; i++) {
        const entry = results.removed[i];
        lines.push(`### ${i + 1}. ${this.escapeMarkdown(entry.msgid)}\n`);

        if (entry.msgctxt) {
          lines.push(`**Context:** \`${this.escapeMarkdown(entry.msgctxt)}\`\n`);
        }

        if (entry.msgidPlural) {
          lines.push(`**Plural:** ${this.escapeMarkdown(entry.msgidPlural)}\n`);
        }

        const references = this._parseReferences(entry.comments.reference);
        if (references.length > 0) {
          const refsStr = references.slice(0, 3).map(ref => `\`${ref}\``).join(', ');
          lines.push(`**Was in:** ${refsStr}\n`);
        }

        lines.push('');
      }

      if (results.removed.length > 50) {
        lines.push(`*... and ${results.removed.length - 50} more*\n`);
      }
    }

    // Changed strings
    if (results.changed.length > 0) {
      lines.push('## 🔄 Changed Strings\n');
      lines.push(`**${results.changed.length} string(s) modified**\n`);

      const limit = Math.min(results.changed.length, 50);
      for (let i = 0; i < limit; i++) {
        const { base, target } = results.changed[i];
        lines.push(`### ${i + 1}. ${this.escapeMarkdown(base.msgid)}\n`);

        if (base.msgctxt) {
          lines.push(`**Context:** \`${this.escapeMarkdown(base.msgctxt)}\`\n`);
        }

        if (base.msgidPlural !== target.msgidPlural) {
          lines.push('**Plural form changed:**');
          lines.push(`- ❌ Old: ${this.escapeMarkdown(base.msgidPlural)}`);
          lines.push(`- ✅ New: ${this.escapeMarkdown(target.msgidPlural)}\n`);
        }

        if (base.comments.translator !== target.comments.translator) {
          lines.push('**Translator comment changed:**');
          lines.push(`- ❌ Old: ${this.escapeMarkdown(base.comments.translator)}`);
          lines.push(`- ✅ New: ${this.escapeMarkdown(target.comments.translator)}\n`);
        }

        if (base.comments.extracted !== target.comments.extracted) {
          lines.push('**Extracted comment changed:**');
          lines.push(`- ❌ Old: ${this.escapeMarkdown(base.comments.extracted)}`);
          lines.push(`- ✅ New: ${this.escapeMarkdown(target.comments.extracted)}\n`);
        }

        lines.push('');
      }

      if (results.changed.length > 50) {
        lines.push(`*... and ${results.changed.length - 50} more*\n`);
      }
    }

    return lines.join('\n');
  }

  static _parseReferences(referenceString) {
    if (!referenceString) return [];
    
    // Reference string can be like "src/file.php:23\nsrc/other.php:45"
    const lines = referenceString.split('\n').filter(line => line.trim());
    return lines.map(line => line.trim());
  }
}

module.exports = { Reporter };

