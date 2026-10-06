# Security policy

NetAssign installs a root helper and changes network and firewall
settings, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use
GitHub's private vulnerability reporting instead: *Security → Report a
vulnerability* in this repository. Include the NetAssign version, the
DSM version, and steps to reproduce.

## Scope

In scope:

- **The root helper:** request handling, file handling, privilege
  boundaries.
- **The CGI bridge** (`app/api.cgi`): authentication, authorization,
  input handling.
- Anything that lets a non-administrator, or the package user, make the
  helper do more than the documented actions.

Out of scope:

- issues that require root access in the first place,
- DSM itself.

## Supported versions

Only the latest release receives fixes.
