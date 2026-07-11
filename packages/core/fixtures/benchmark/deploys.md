Standup, release thread. The bad Friday deploy took the editor down for
forty minutes because rollout was all-or-nothing. We decided every deploy
ships behind a canary flag at five percent for an hour, and rollback is
one command that completes within five minutes. Release notes post to the
changelog automatically.
