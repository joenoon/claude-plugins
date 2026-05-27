# joenoon/claude-plugins

Joe Noon's reusable Claude Code plugins.

## Install

```
/plugin marketplace add joenoon/claude-plugins
/plugin install <plugin-name>@joenoon
```

## Plugins

| Plugin | Description |
|--------|-------------|
| [`phoenix`](plugins/phoenix) | Opinionated patterns for Phoenix/LiveView/Ecto apps on Fly |

(More to come.)

## Per-project enabling

Add to your project's `.claude/settings.json`:

```json
{
  "enabledPlugins": { "phoenix@joenoon": true }
}
```

So different projects can pick different plugins.

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`
2. Add skills under `plugins/<name>/skills/<skill-name>/SKILL.md`
3. Register it in `.claude-plugin/marketplace.json`

## License

MIT — see [LICENSE](LICENSE).
