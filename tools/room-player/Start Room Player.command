#!/bin/zsh
# Double-click from Finder. This does not start or change the online show.
set -e
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22 on this laptop once, then open this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  print 'This room player needs Node.js 22 or newer.'
  read '?Press Return to close.'
  exit 1
fi
print 'Keep this window open during the show. Open the local controls URL below.'
exec node server.mjs
