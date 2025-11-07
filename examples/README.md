# Example POT Files

This directory contains example POT files for testing the i18n String Reviewer action.

## Files

- `base.pot` - Simulates the POT file from the base branch
- `target.pot` - Simulates the POT file from the target/PR branch

## Expected Changes

When comparing `base.pot` to `target.pot`, the action should detect:

### Added Strings (3)
1. "Profile" (navigation context)
2. "Operation completed"
3. "Payment Method"
4. "Card Number" (payment form context)

### Removed Strings (2)
1. "An error occurred"

### Changed Strings (5)
1. "Please log in to continue" → "Please sign in to continue"
2. "You have %d items" (plural) → "You have %d items in your cart"
3. "Submit" translator comment changed
4. "Your changes have been saved" → "Your changes have been saved successfully"
5. "Name" → "Full Name"
6. "Email" → "Email Address"

## Testing Locally

You can test the comparison script with these files:

```bash
python ../compare_pot.py \
  --base base.pot \
  --target target.pot \
  --output output.json \
  --markdown output.md
```

Then check the generated files:
- `output.json` - JSON report with all changes
- `output.md` - Human-readable Markdown report

