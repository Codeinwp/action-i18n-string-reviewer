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

## Outputs

| Output | Description |
|--------|-------------|
| `added-count` | Number of added strings |
| `removed-count` | Number of removed strings |
| `changed-count` | Number of changed strings |
| `total-changes` | Total number of changes |
| `report` | Detailed Markdown report |

## What Gets Detected

- **Added Strings** ➕ - New translatable strings
- **Removed Strings** ➖ - Deleted translatable strings
- **Changed Strings** 🔄 - Modified plural forms or comments

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

# Test locally
env "INPUT_BASE-POT-FILE=examples/base.pot" \
    "INPUT_TARGET-POT-FILE=examples/target.pot" \
    "INPUT_FAIL-ON-CHANGES=false" \
    node dist/index.js
```

## License

MIT
