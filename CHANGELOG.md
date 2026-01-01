# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-01-01

### Added
- Initial release
- MCP server implementation for JustOneAPI
- Support for Kuaishou video search (`kuaishou_search_video_v2` tool)
- Comprehensive error handling with normalized error codes
- Token masking for security
- Retry mechanism with exponential backoff
- Configurable timeout and retry settings
- Debug logging to stderr
- Support for npx, global installation, and local development
- Compatible with all MCP hosts (Claude Desktop, Cursor, Cline, etc.)

### Security
- Token is never logged in plaintext
- All URLs are sanitized before logging
- Environment variable based configuration

[Unreleased]: https://github.com/yourusername/justoneapi-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/justoneapi-mcp/releases/tag/v1.0.0
