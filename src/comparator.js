const fs = require('fs');
const gettextParser = require('gettext-parser');

class POTEntry {
  constructor({ msgid, msgidPlural = '', msgctxt = '', comments = {} }) {
    this.msgid = msgid;
    this.msgidPlural = msgidPlural;
    this.msgctxt = msgctxt;
    this.comments = {
      translator: comments.translator || '',
      extracted: comments.extracted || '',
      reference: comments.reference || '',
      flag: comments.flag || ''
    };
  }

  getKey() {
    return this.msgctxt ? `${this.msgctxt}||${this.msgid}` : this.msgid;
  }

  equals(other) {
    return this.msgid === other.msgid &&
           this.msgidPlural === other.msgidPlural &&
           this.msgctxt === other.msgctxt;
  }

  hasChangedContent(other) {
    // Only check actual string content, ignore comments
    return this.msgidPlural !== other.msgidPlural;
  }
}

class POTComparator {
  constructor(baseFile, targetFile) {
    this.baseFile = baseFile;
    this.targetFile = targetFile;
    this.baseEntries = new Map();
    this.targetEntries = new Map();
    this.added = [];
    this.removed = [];
    this.changed = [];
  }

  loadPOTFiles() {
    try {
      console.log(`Loading base POT file: ${this.baseFile}`);
      const baseContent = fs.readFileSync(this.baseFile, 'utf8');
      const baseParsed = gettextParser.po.parse(baseContent);
      
      console.log(`Loading target POT file: ${this.targetFile}`);
      const targetContent = fs.readFileSync(this.targetFile, 'utf8');
      const targetParsed = gettextParser.po.parse(targetContent);

      // Process base entries
      this._processEntries(baseParsed, this.baseEntries);
      console.log(`✓ Loaded ${this.baseEntries.size} entries from base file`);

      // Process target entries
      this._processEntries(targetParsed, this.targetEntries);
      console.log(`✓ Loaded ${this.targetEntries.size} entries from target file`);

      return true;
    } catch (error) {
      console.error(`❌ Error loading POT files: ${error.message}`);
      throw error;
    }
  }

  _processEntries(parsed, entriesMap) {
    // Get translations from the default context ('')
    const translations = parsed.translations[''] || {};
    
    for (const [msgid, data] of Object.entries(translations)) {
      // Skip the header entry (empty msgid)
      if (!msgid || msgid === '') continue;

      const entry = new POTEntry({
        msgid: msgid,
        msgidPlural: data.msgid_plural || '',
        msgctxt: data.msgctxt || '',
        comments: {
          translator: data.comments?.translator || '',
          extracted: data.comments?.extracted || '',
          reference: data.comments?.reference || '',
          flag: data.comments?.flag || ''
        }
      });

      entriesMap.set(entry.getKey(), entry);
    }

    // Also process other contexts
    for (const [context, translations] of Object.entries(parsed.translations)) {
      if (context === '') continue; // Already processed

      for (const [msgid, data] of Object.entries(translations)) {
        if (!msgid || msgid === '') continue;

        const entry = new POTEntry({
          msgid: msgid,
          msgidPlural: data.msgid_plural || '',
          msgctxt: context,
          comments: {
            translator: data.comments?.translator || '',
            extracted: data.comments?.extracted || '',
            reference: data.comments?.reference || '',
            flag: data.comments?.flag || ''
          }
        });

        entriesMap.set(entry.getKey(), entry);
      }
    }
  }

  compare() {
    const baseKeys = new Set(this.baseEntries.keys());
    const targetKeys = new Set(this.targetEntries.keys());

    // Find added entries
    const addedKeys = [...targetKeys].filter(key => !baseKeys.has(key));
    this.added = addedKeys.map(key => this.targetEntries.get(key));

    // Find removed entries
    const removedKeys = [...baseKeys].filter(key => !targetKeys.has(key));
    this.removed = removedKeys.map(key => this.baseEntries.get(key));

    // Find changed entries
    const commonKeys = [...baseKeys].filter(key => targetKeys.has(key));
    for (const key of commonKeys) {
      const baseEntry = this.baseEntries.get(key);
      const targetEntry = this.targetEntries.get(key);

      if (baseEntry.hasChangedContent(targetEntry)) {
        this.changed.push({ base: baseEntry, target: targetEntry });
      }
    }

    console.log(`\n📊 Comparison Results:`);
    console.log(`   Added: ${this.added.length}`);
    console.log(`   Removed: ${this.removed.length}`);
    console.log(`   Changed: ${this.changed.length}`);
    console.log(`   Total changes: ${this.getTotalChanges()}`);
  }

  getTotalChanges() {
    return this.added.length + this.removed.length + this.changed.length;
  }

  getResults() {
    return {
      added: this.added,
      removed: this.removed,
      changed: this.changed,
      addedCount: this.added.length,
      removedCount: this.removed.length,
      changedCount: this.changed.length,
      totalChanges: this.getTotalChanges()
    };
  }
}

module.exports = { POTComparator, POTEntry };

