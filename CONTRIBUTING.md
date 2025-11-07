# Contributing to i18n String Reviewer

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Development Setup

1. **Fork and clone the repository**

```bash
git clone https://github.com/your-username/action-i18n-string-reviewer.git
cd action-i18n-string-reviewer
```

2. **Install dependencies**

```bash
npm install
```

3. **Make your changes**

Edit files in the `src/` directory:
- `src/index.js` - Main entry point and GitHub Actions integration
- `src/comparator.js` - POT file comparison logic
- `src/reporter.js` - Report generation (JSON and Markdown)

4. **Build the action**

```bash
npm run build
```

This compiles your changes into `dist/index.js` using `@vercel/ncc`.

5. **Test your changes**

```bash
# Test with example files
env "INPUT_BASE-POT-FILE=examples/base.pot" \
    "INPUT_TARGET-POT-FILE=examples/target.pot" \
    "INPUT_FAIL-ON-CHANGES=false" \
    "INPUT_COMMENT-ON-PR=false" \
    node dist/index.js
```

## Pull Request Process

1. Ensure your code builds without errors
2. Test with the example POT files
3. Update documentation if needed
4. **Commit both `src/` and `dist/` changes** - the `dist/` directory must be committed
5. Submit a pull request with a clear description of changes

## Code Style

- Use clear, descriptive variable names
- Add comments for complex logic
- Follow existing code formatting
- Use modern JavaScript (ES6+) features

## Adding New Features

When adding new features:

1. Update `src/` files with your changes
2. Rebuild with `npm run build`
3. Update `README.md` with usage examples
4. Add tests if applicable
5. Update `examples/` if needed

## Reporting Bugs

When reporting bugs, please include:

- POT file samples that reproduce the issue
- Expected vs actual behavior
- Error messages or logs
- Your GitHub Actions workflow configuration

## Questions?

Feel free to open an issue for any questions or concerns!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

