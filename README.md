# 🌍 i18n String Reviewer

A GitHub Action that compares POT (Portable Object Template) files between branches and reports added, removed, and changed translatable strings.

## Usage

```yaml
name: Review i18n Changes

on:
  pull_request:
    paths:
      - '**.pot'

jobs:
  review-strings:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Get base POT file
        run: |
          git show origin/${{ github.base_ref }}:languages/myapp.pot > base.pot
      
      - name: Compare POT files
        uses: ./
        with:
          base-pot-file: 'base.pot'
          target-pot-file: 'languages/myapp.pot'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `base-pot-file` | Yes | - | Path to the base branch POT file |
| `target-pot-file` | Yes | - | Path to the target branch POT file |
| `fail-on-changes` | No | `false` | Fail the action if changes are detected |
| `github-token` | No | `${{ github.token }}` | GitHub token for commenting on PRs |
| `comment-on-pr` | No | `true` | Whether to comment on pull requests |
| `openrouter-key` | No | - | OpenRouter API key for LLM string matching |
| `openrouter-model` | No | `anthropic/claude-3.5-sonnet` | OpenRouter model to use |

## Outputs

| Output | Description |
|--------|-------------|
| `added-count` | Number of added strings |
| `removed-count` | Number of removed strings |
| `changed-count` | Number of changed strings |
| `total-changes` | Total number of changes |
| `report` | Detailed Markdown report |

## LLM-Powered String Matching (Optional)

Enable AI-powered suggestions to find existing strings that could be reused instead of adding new ones:

```yaml
- name: Compare POT files with LLM suggestions
  uses: ./
  with:
    base-pot-file: 'base.pot'
    target-pot-file: 'languages/myapp.pot'
    openrouter-key: ${{ secrets.OPENROUTER_API_KEY }}
    openrouter-model: 'anthropic/claude-3.5-sonnet'
```

When enabled, the action analyzes each added and changed string against all existing base strings to suggest semantically similar alternatives. This helps:
- Avoid duplicate strings with slightly different wording
- Reduce translation costs by reusing existing translations
- Maintain consistency across the application

The **Suggested Match** column will show:
- The best matching existing string if found
- "No close match" if no similar string exists
- "LLM Error: {reason}" if the API call fails

Get your OpenRouter API key at [openrouter.ai](https://openrouter.ai/).

### LLM Result Caching

The action automatically caches LLM results using GitHub Actions cache to avoid redundant API calls. This cache:

- **Persists between workflow runs** - Stored in GitHub's cache infrastructure
- **Saves API costs** - Same strings won't be analyzed twice
- **Speeds up workflow** - Instant results for cached strings  
- **No repository changes** - Cache doesn't pollute git history
- **Automatic expiration** - GitHub automatically manages cache lifecycle (7 days)

The cache works automatically - no configuration needed! On each run:
1. Action restores previous LLM results from GitHub cache
2. New API calls are made only for uncached strings
3. Updated cache is saved back to GitHub

Cache is stored with key `llm-cache-default-v1`. You can clear it by manually deleting caches in your repository settings.

## Report Format

The action generates a detailed report with:

- **Summary Table** - Overview of all changes
- **Added Strings Table** ➕ - New translatable strings with word counts and optional LLM suggestions (collapsible)
- **Removed Strings Table** ➖ - Deleted translatable strings (collapsible)
- **Changed Strings Table** 🔄 - Modified strings with before/after comparison, word counts, and optional LLM suggestions (collapsible)

Added and Changed tables include a **Words** column showing the word count for each string, plus a **Total** footer row summing all words. This helps estimate translation workload.

All detail tables are collapsed by default and can be expanded by clicking. See `examples/SAMPLE_REPORT.md` for a sample report.

## Example with Outputs

```yaml
- name: Compare POT files
  id: compare
  uses: ./
  with:
    base-pot-file: 'base.pot'
    target-pot-file: 'languages/myapp.pot'

- name: Use outputs
  run: |
    echo "Added: ${{ steps.compare.outputs.added-count }}"
    echo "Removed: ${{ steps.compare.outputs.removed-count }}"
    echo "Total changes: ${{ steps.compare.outputs.total-changes }}"
```

## Development

```bash
# Install dependencies
npm install

# Build the action
npm run build

# Test locally (use Node.js script which handles dashes in env vars)
./test-local.js

# Test with custom POT files
./test-local.js path/to/base.pot path/to/target.pot

# Test with LLM enabled
export OPENROUTER_API_KEY="sk-or-v1-your-key"
./test-local.js
```

## License

MIT
