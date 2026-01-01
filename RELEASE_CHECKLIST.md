# Release Checklist

## Pre-Publish Steps

### 1. Configuration Review
- [ ] Update `package.json` author field if needed
- [ ] Verify repository URL: `https://github.com/justoneapi/justoneapi-mcp.git`
- [ ] Confirm version number (current: `1.0.0`)
- [ ] Review keywords for npm discoverability

### 2. Code Quality
- [x] Run `npm run lint` - No errors ✅
- [x] Run `npm run format` - Code formatted ✅
- [x] Run `npm run build` - Build successful ✅
- [x] Verify `dist/` output is complete

### 3. Documentation
- [x] README.md is complete and accurate
- [x] CHANGELOG.md reflects current version
- [x] LICENSE file present (MIT)
- [x] CONTRIBUTING.md available
- [x] .env.example with all options

### 4. Testing
- [ ] Test with Claude Desktop locally
  - Build: `npm run build`
  - Update config to use local `dist/index.js`
  - Restart Claude Desktop
  - Test `kuaishou_search_video_v2` tool
- [ ] Verify error handling (try invalid token)
- [ ] Check debug logging works

### 5. Git & GitHub
- [ ] Commit all changes
- [ ] Push to GitHub
- [ ] Verify GitHub Actions CI passes
- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push tag: `git push origin v1.0.0`

## Publish

### npm Login
```bash
npm login
```

### Dry Run (Optional but Recommended)
```bash
npm publish --dry-run
```

Review what will be published:
- Check file list
- Verify package size is reasonable
- Confirm no sensitive files included

### Publish
```bash
npm publish
```

## Post-Publish

### 1. Verify Publication
- [ ] Visit: https://www.npmjs.com/package/justoneapi-mcp
- [ ] Check package page looks correct
- [ ] Verify README displays properly

### 2. Test Installation
```bash
# Test npx
npx -y justoneapi-mcp --help

# Test global installation
npm install -g justoneapi-mcp
justoneapi-mcp --help
npm uninstall -g justoneapi-mcp
```

### 3. Update GitHub
- [ ] Create GitHub Release (v1.0.0)
  - Use CHANGELOG.md content
  - Add installation instructions
  - Mark as latest release
- [ ] Update CHANGELOG.md with release date
- [ ] Create announcement (if applicable)

### 4. Monitor
- [ ] Check npm download stats
- [ ] Monitor GitHub issues
- [ ] Watch for user feedback

## Rollback (If Needed)

If you need to unpublish (within 24 hours):
```bash
npm unpublish justoneapi-mcp@1.0.0
```

⚠️ **Warning**: You can only unpublish within 24 hours and cannot reuse the same version number.

## Future Release Process

For subsequent releases:

1. Update version: `npm version [patch|minor|major]`
2. Update CHANGELOG.md
3. Follow this checklist
4. Publish: `npm publish`

---

**Current Status**: Ready for initial publication (v1.0.0)
