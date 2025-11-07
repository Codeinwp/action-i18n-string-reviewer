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

When enabled, the action analyzes each added and changed string against all existing base strings (including removed strings) to suggest semantically similar alternatives. This helps:
- Avoid duplicate strings with slightly different wording
- Reduce translation costs by reusing existing translations
- Maintain consistency across the application
- **Reuse translations from removed strings** - Even deleted strings are valuable since they're already translated

**Smart Matching**: The action includes removed/deleted strings in its suggestions because those translations already exist. If you're adding "Settings" and previously had "Edit Settings" that was removed, the action will suggest reusing that translation.

The **Suggested Match** column will show:
- The best matching existing string if found (may be from current or removed strings)
- "No close match" if no similar string exists
- "LLM Error: {reason}" if the API call fails

Get your OpenRouter API key at [openrouter.ai](https://openrouter.ai/).

### LLM Result Caching

The action automatically caches LLM results in a hidden PR comment to avoid redundant API calls. This cache:

- **Persists across workflow runs** - Stored in the PR itself
- **Saves API costs** - Same strings won't be analyzed twice  
- **Speeds up workflow** - Instant results for cached strings
- **PR-specific** - Each PR maintains its own cache
- **No extra permissions** - Uses the same PR write access for commenting
- **Automatic cleanup** - Cache is removed when PR is closed/merged

The cache works automatically - no configuration needed! On each run:
1. Action checks for existing cache in PR comments
2. New API calls are made only for uncached strings
3. Updated cache is saved as a hidden HTML comment in the PR

**How it works**: The cache is stored as base64-encoded JSON inside HTML comments that are invisible in the PR's rendered view but updated on each run. This approach is simpler and more reliable than GitHub Actions cache.

**Permissions**: If your repository uses restricted permissions, ensure the workflow has `pull-requests: write` permission:

```yaml
jobs:
  your-job:
    permissions:
      contents: read
      pull-requests: write  # Required for commenting and caching
```

The cache comment is automatically managed by the action and doesn't clutter your PR discussion.

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
